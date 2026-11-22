/**
 * Hash checker: every CHECK_INTERVAL_SECONDS, compare the newest CHECK_WINDOW
 * lines of the validator's hash log (`block_num l2_block_id`) with the upstream
 * validator's `blocks` table and emit one JSON status line:
 *   status=ok       every compared hash matches and the validator is within CHECK_MAX_LAG blocks of the DB head
 *   status=error    a hash differs (reason=mismatch) or the validator is lagging (reason=lagging)
 *   status=warning  the validator is behind but replaying faster than the chain (reason=catching_up, e.g. after a
 *                   restart), or nothing could be compared (empty log, no overlap, or the DB is unreachable)
 * Connection comes from the usual PG* environment variables.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import pg from "pg";
import { logStatus } from "./util/log.mjs";

const env = (key: string, fallback: string): string => process.env[key] ?? fallback;
const envInt = (key: string, fallback: number): number => {
  const v = process.env[key];
  return v !== undefined ? parseInt(v, 10) : fallback;
};

const hashLog = env("HASH_LOG", "/data/hashes.log");
const intervalMs = envInt("CHECK_INTERVAL_SECONDS", 60) * 1000;
const window = envInt("CHECK_WINDOW", 5000);
const maxLag = envInt("CHECK_MAX_LAG", 100);
const LINE_BYTES = 80; // "block_num sha256\n" is 75 bytes
const CHAIN_BLOCKS_PER_SECOND = 1 / 3;

/** Validator head seen by the previous check, to tell a replay in progress from a stalled validator. */
let previousValidatorHead: number | undefined;
let previousCheckAt: number | undefined;

type Entry = { block_num: number; l2_block_id: string };

/** Last `n` well-formed lines of the hash log, reading only the tail of the file. */
function tailEntries(path: string, n: number): Entry[] {
  const size = statSync(path).size;
  const want = Math.min(size, (n + 1) * LINE_BYTES);
  const buf = Buffer.alloc(want);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, want, size - want);
  } finally {
    closeSync(fd);
  }
  const lines = buf.toString("utf8").split("\n");
  if (want < size) lines.shift(); // partial first line
  const entries: Entry[] = [];
  for (const line of lines) {
    const m = /^(\d+) ([0-9a-f]{64})$/.exec(line);
    if (m) entries.push({ block_num: Number(m[1]), l2_block_id: m[2] });
  }
  return entries.slice(-n);
}

async function check(): Promise<void> {
  let entries: Entry[];
  try {
    entries = tailEntries(hashLog, window);
  } catch (err) {
    logStatus("warning", "hash log unreadable", { reason: "no_log", hash_log: hashLog, error: String(err) });
    return;
  }
  if (entries.length === 0) {
    logStatus("warning", "hash log empty", { reason: "no_log", hash_log: hashLog });
    return;
  }
  // Deduplicate by block (a restarted validator may re-log blocks); the newest line wins.
  const ours = new Map<number, string>();
  for (const e of entries) ours.set(e.block_num, e.l2_block_id);
  const validatorHead = Math.max(...ours.keys());

  const client = new pg.Client();
  let rows: Entry[];
  let dbHead: number;
  try {
    await client.connect();
    const res = await client.query<Entry>("select block_num, l2_block_id from blocks where block_num = any($1::int[])", [[...ours.keys()]]);
    rows = res.rows;
    const head = await client.query<{ head: number | null }>("select max(block_num)::int as head from blocks");
    dbHead = head.rows[0]?.head ?? 0;
  } catch (err) {
    logStatus("warning", "database unreachable", { reason: "db_error", error: err instanceof Error ? err.message : String(err) });
    return;
  } finally {
    await client.end().catch(() => undefined);
  }

  let matching = 0;
  const mismatches: { block_num: number; ours: string; theirs: string }[] = [];
  for (const row of rows) {
    const mine = ours.get(row.block_num)!;
    if (mine === row.l2_block_id) matching++;
    else mismatches.push({ block_num: row.block_num, ours: mine, theirs: row.l2_block_id });
  }
  mismatches.sort((a, b) => a.block_num - b.block_num);
  const lag = dbHead - validatorHead;
  // Catching up = behind, but advancing faster than the chain itself (first check after a start counts too).
  const now = Date.now();
  // A head that moved backwards means the validator restarted and is re-logging from its seed.
  const restarted = previousValidatorHead === undefined || validatorHead < previousValidatorHead;
  const advanced = restarted ? Infinity : (validatorHead - previousValidatorHead!) / ((now - previousCheckAt!) / 1000);
  const catchingUp = lag > maxLag && advanced > 2 * CHAIN_BLOCKS_PER_SECOND;
  previousValidatorHead = validatorHead;
  previousCheckAt = now;
  const fields = {
    compared: rows.length,
    matching,
    mismatching: mismatches.length,
    first_mismatch: mismatches[0] ?? null,
    validator_head: validatorHead,
    db_head: dbHead,
    lag,
    window_blocks: ours.size,
  };
  if (mismatches.length > 0) logStatus("error", "hash mismatch", { reason: "mismatch", ...fields });
  else if (rows.length === 0) logStatus("warning", "no overlap with blocks table", { reason: "no_overlap", ...fields });
  else if (catchingUp) logStatus("warning", "validator catching up", { reason: "catching_up", max_lag: maxLag, ...fields });
  else if (lag > maxLag) logStatus("error", "validator lagging", { reason: "lagging", max_lag: maxLag, ...fields });
  else logStatus("ok", "hashes match", { reason: "ok", ...fields });
}

async function main() {
  logStatus("info", "checker starting", { hash_log: hashLog, interval_seconds: intervalMs / 1000, window, max_lag: maxLag, pg_host: process.env.PGHOST ?? "" });
  while (true) {
    const started = Date.now();
    try {
      await check();
    } catch (err) {
      logStatus("error", "checker failed", { reason: "exception", error: err instanceof Error ? err.stack ?? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, Math.max(1000, intervalMs - (Date.now() - started))));
  }
}

main();
