/**
 * Seed export: writes the in-memory state as a seed that `loadSeed` (SEED_FILE) reads.
 *
 * Format 2 = the format-1 rows tools/extract-seed.mts writes from Postgres, plus `hash64` rows for
 * the sets this port keeps only as 64-bit hashes (hive account names, closed promises, rental ids),
 * since their strings are not retained. Rows are written in each store's iteration order, so a
 * reload reproduces the same Map order. Next to the seed: `<name>.manifest.json` with block, hash,
 * size and sha256.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createGzip } from "node:zlib";
import type { StateStore } from "../state/index.mjs";
import { formatScaled } from "../util/num.mjs";
import type { SeedMeta } from "./seed.mjs";

export const SEED_FORMAT = 2;
const HASH_CHUNK = 65_536;

export interface SeedManifest {
  block_id: string;
  block_num: number;
  bytes: number;
  counts: Record<string, number>;
  exported_at: string;
  file: string;
  format: number;
  l2_block_id: string;
  node: string;
  sha256: string;
}

export type HashSetName = "hive_accounts" | "promise_closed" | "rental_ids";

/** Little-endian base64 of 32-bit words (independent of host byte order). */
export function packU32(words: number[]): string {
  const buf = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; i++) buf.writeUInt32LE(words[i] >>> 0, i * 4);
  return buf.toString("base64");
}

export function unpackU32(b64: string): number[] {
  const buf = Buffer.from(b64, "base64");
  const out = new Array<number>(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readUInt32LE(i * 4);
  return out;
}

/** Every seed row for the state, in load order. */
export function* seedRows(state: StateStore, meta: SeedMeta): Generator<{ t: string; r: unknown }> {
  yield { t: "meta", r: { ...meta, format: SEED_FORMAT } };
  for (const r of state.blocks.rows()) yield { t: "blocks", r };
  for (const r of state.config.all()) yield { t: "config", r };
  for (const r of state.balances.rows()) yield { t: "balances", r: { player: r.player, token: r.token, balance: formatScaled(r.balance, 3) } };
  yield* hashRows("hive_accounts", state.hiveAccounts.nameHashes());
  for (const [name, authority] of state.hiveAccounts.authorities()) yield { t: "hive_account_authority", r: { name, authority } };
  for (const r of state.validators.all()) yield { t: "validators", r: { ...r, total_votes: formatScaled(r.total_votes, 3) } };
  for (const r of state.votes.rows()) yield { t: "validator_votes", r: { ...r, vote_weight: formatScaled(r.vote_weight, 3) } };
  for (const r of state.checkIns.all()) yield { t: "validator_check_in", r };
  for (const r of state.unstaking.all())
    yield { t: "token_unstaking", r: { ...r, total_qty: formatScaled(r.total_qty, 3), total_unstaked: formatScaled(r.total_unstaked, 3) } };
  for (const r of state.priceHistory.all()) yield { t: "price_history", r: { ...r, token_price: formatScaled(r.token_price, 6) } };
  for (const r of state.rewardDebts.rows()) yield { t: "staking_pool_reward_debt", r: { ...r, reward_debt: formatScaled(r.reward_debt, 3) } };
  for (const r of state.delegations.rows()) yield { t: "active_delegations", r: { ...r, amount: formatScaled(r.amount, 3) } };
  for (const r of state.transferKeys.rows()) yield { t: "token_transfer_keys", r };
  for (const r of state.promises.liveRows()) yield { t: "promise", r };
  yield { t: "promise_closed_tables", r: state.promises.closedTables() };
  yield* hashRows("promise_closed", state.promises.closedEntries());
  yield* hashRows("rental_ids", state.rentals.idHashes());
  for (const r of state.rentals.activeRows()) yield { t: "rental_delegations", r: { ...r, qty: formatScaled(r.qty, 3) } };
}

function* hashRows(set: HashSetName, entries: Iterable<[number, number] | [number, number, number]>): Generator<{ t: string; r: unknown }> {
  let lo: number[] = [];
  let hi: number[] = [];
  let val: number[] = [];
  const flush = (): { t: string; r: unknown } => {
    const r: Record<string, unknown> = { set, lo: packU32(lo), hi: packU32(hi) };
    if (val.length > 0) r.val = packU32(val);
    lo = [];
    hi = [];
    val = [];
    return { t: "hash64", r };
  };
  for (const e of entries) {
    lo.push(e[0]);
    hi.push(e[1]);
    if (e.length === 3) val.push(e[2]);
    if (lo.length === HASH_CHUNK) yield flush();
  }
  if (lo.length > 0) yield flush();
}

/** Write a gzipped seed atomically, then its manifest. Returns the manifest. */
export async function exportSeed(state: StateStore, meta: Omit<SeedMeta, "extracted_at">, path: string): Promise<SeedManifest> {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  const exported_at = new Date().toISOString();
  const counts: Record<string, number> = {};
  const gz = createGzip({ level: 6 });
  const done = new Promise<void>((res, rej) => {
    const ws = createWriteStream(tmp);
    ws.on("finish", () => res());
    ws.on("error", rej);
    gz.on("error", rej);
    gz.pipe(ws);
  });
  for (const row of seedRows(state, { ...meta, extracted_at: exported_at })) {
    counts[row.t] = (counts[row.t] ?? 0) + 1;
    if (!gz.write(JSON.stringify(row) + "\n")) await new Promise((res) => gz.once("drain", res));
  }
  gz.end();
  await done;
  renameSync(tmp, path);
  const manifest: SeedManifest = {
    block_id: meta.block_id,
    block_num: meta.block_num,
    bytes: statSync(path).size,
    counts,
    exported_at,
    file: basename(path),
    format: SEED_FORMAT,
    l2_block_id: meta.l2_block_id,
    node: process.version,
    sha256: await sha256File(path),
  };
  writeFileSync(manifestPath(path), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/**
 * Export into a snapshot directory as `seed-<block>.ndjson.gz` + manifest, point `latest.json` at it,
 * and keep only the newest `keep` exports.
 */
export async function writeSnapshot(dir: string, state: StateStore, meta: Omit<SeedMeta, "extracted_at">, keep: number): Promise<SeedManifest> {
  const manifest = await exportSeed(state, meta, join(dir, `seed-${String(meta.block_num).padStart(10, "0")}.ndjson.gz`));
  const tmp = join(dir, `latest.json.tmp-${process.pid}`);
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  renameSync(tmp, join(dir, "latest.json"));
  const seeds = readdirSync(dir)
    .filter((n) => /^seed-\d+\.ndjson\.gz$/.test(n))
    .sort();
  for (const n of seeds.slice(0, Math.max(0, seeds.length - keep))) {
    rmSync(join(dir, n), { force: true });
    rmSync(manifestPath(join(dir, n)), { force: true });
  }
  return manifest;
}

export const manifestPath = (seedPath: string): string => seedPath.replace(/\.ndjson(\.gz)?$/, "") + ".manifest.json";

export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}
