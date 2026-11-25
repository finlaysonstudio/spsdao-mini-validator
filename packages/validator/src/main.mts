/**
 * Validator: replay Hive blocks from a seed (or the newest checkpoint),
 * compute each L2 block hash, log it. With VALIDATOR_ACCOUNTS set it also performs
 * validator duties, signed with VALIDATOR_KEY and broadcast.
 *
 * With REFERENCE_API set, hashes are compared with an upstream archive node
 * every VERIFY_EVERY blocks; on a mismatch the first divergent block is found
 * by bisection, reported, and the process exits. With CHECKPOINT_DIR set, the
 * full state is written every CHECKPOINT_EVERY blocks (only after the block
 * verified, when a reference is configured) and replay resumes from the
 * newest checkpoint on start.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";
import { BlockProcessor } from "./block/processor.mjs";
import { writeSnapshot } from "./bootstrap/export.mjs";
import { loadSeed } from "./bootstrap/seed.mjs";
import { ReferenceApi } from "./hive/reference.mjs";
import { streamBlocks } from "./hive/stream.mjs";
import { Services } from "./services.mjs";
import { listCheckpoints, loadCheckpoint, pruneCheckpoints, writeCheckpoint } from "./state/checkpoint.mjs";
import { StateStore } from "./state/index.mjs";
import { OperationError } from "./util/errors.mjs";
import { StatusFile } from "./util/status_file.mjs";
import { UPSTREAM_VERSION } from "./version.mjs";
import { error, log, logStatus, warn } from "./util/log.mjs";
import { LiveBroadcaster, parseKeys, resolveSigners } from "./validator/broadcast.mjs";
import { configuredFeeds, HiveEngine, PriceFeedDuty } from "./validator/price_feed.mjs";
import { ValidatorDuties, type DutyEvent } from "./validator/duties.mjs";

/** Blocks per second over the most recent `size` processed blocks. */
class RollingRate {
  private readonly times: number[] = [];
  constructor(private readonly size = 200) {}
  tick(now = Date.now()): number {
    this.times.push(now);
    if (this.times.length > this.size) this.times.shift();
    if (this.times.length < 2) return 0;
    const span = (now - this.times[0]) / 1000;
    return span > 0 ? (this.times.length - 1) / span : 0;
  }
}

async function start(): Promise<{ state: StateStore; block_num: number; l2_block_id: string; verified: boolean }> {
  if (config.checkpointDir) {
    const all = listCheckpoints(config.checkpointDir);
    if (all.length > 0) {
      const b = all[all.length - 1];
      const t0 = Date.now();
      const { state, meta } = loadCheckpoint(config.checkpointDir, b);
      log("checkpoint loaded", { block_num: meta.block_num, l2_block_id: meta.l2_block_id, verified: meta.verified, seconds: (Date.now() - t0) / 1000 });
      return { state, block_num: meta.block_num, l2_block_id: meta.l2_block_id, verified: meta.verified };
    }
  }
  const state = new StateStore();
  const meta = await loadSeed(state, config.seedFile);
  return { state, block_num: meta.block_num, l2_block_id: meta.l2_block_id, verified: true };
}

/** Read the posting keys and drop them from the environment. */
function takeValidatorKeys(): ReturnType<typeof parseKeys> {
  const value = process.env.VALIDATOR_KEY ?? "";
  delete process.env.VALIDATOR_KEY;
  return parseKeys(value);
}

type Duties = { duties: ValidatorDuties; priceFeed: PriceFeedDuty | null };

async function makeDuties(svc: Services): Promise<Duties | null> {
  if (config.validatorAccounts.length === 0) {
    delete process.env.VALIDATOR_KEY;
    return null;
  }
  const emit = ({ status, msg, fields }: DutyEvent) => {
    logStatus(status, msg, fields);
    if (config.dutyLog) appendFileSync(config.dutyLog, JSON.stringify({ ts: new Date().toISOString(), status, msg, ...fields }) + "\n");
  };
  const { keys, invalid } = takeValidatorKeys();
  for (const k of invalid) emit({ status: "error", msg: "validator key skipped", fields: { key_index: k.index, reason: k.reason } });
  const { signers, skipped } = await resolveSigners({ accounts: config.validatorAccounts, keys });
  for (const s of signers) emit({ status: "info", msg: "posting authority verified", fields: { account: s.account, public_key: s.key.publicKey, via: s.via, grantee: s.grantee ?? null } });
  for (const s of skipped) emit({ status: "error", msg: "validator account skipped", fields: { account: s.account, reason: s.reason } });
  if (signers.length === 0) throw new Error("no configured VALIDATOR_KEY can sign for any of VALIDATOR_ACCOUNTS");
  const accounts = signers.map((s) => s.account);
  const broadcaster = new LiveBroadcaster({ emit, signers, customJsonId: config.customJsonId });
  const duties = new ValidatorDuties({
    svc,
    accounts,
    broadcaster,
    emit,
    version: config.validatorVersion,
    validateBlockDelay: config.validateBlockDelay,
    enableCheckIns: config.enableCheckIns,
    checkInRetryBlocks: config.checkInRetryBlocks,
  });
  const feeds = config.enablePriceFeed ? configuredFeeds(config.priceFeed) : [];
  const priceFeed = feeds.length > 0 ? new PriceFeedDuty({ svc, accounts, broadcaster, emit, feeds, engine: new HiveEngine(config.hiveEngineRpcNodes) }) : null;
  log("validator duties enabled", { accounts, role: duties.role, validate_block_delay: config.validateBlockDelay, check_ins: config.enableCheckIns, price_feeds: feeds.map((f) => f.name), version: config.validatorVersion });
  return { duties, priceFeed };
}

async function main() {
  const statusFile = new StatusFile(config.statusFile, {
    info: { upstream_version: UPSTREAM_VERSION, validator_version: config.validatorVersion, role: null, validate_block_delay: config.validateBlockDelay },
  });
  statusFile.start();
  log("validator starting", {
    node: process.version,
    seed_file: config.seedFile,
    checkpoint_dir: config.checkpointDir || null,
    checkpoint_every: config.checkpointDir ? config.checkpointEvery : null,
    reference_api: config.referenceApi || null,
    head_mode: config.blocksHeadMode,
    blocks_behind_head: config.blocksBehindHead,
  });
  const { state, block_num: startBlock, l2_block_id: startHash, verified } = await start();
  const svc = new Services(state, { custom_json_id: config.customJsonId, custom_json_prefix: config.customJsonPrefix });
  const processor = new BlockProcessor(svc);
  const ref = config.referenceApi ? new ReferenceApi(config.referenceApi) : null;
  const duties = await makeDuties(svc);
  statusFile.setInfo({ role: duties ? duties.duties.role : null });

  // Hashes since the last verified block, for bisecting a mismatch.
  let lastVerified = verified ? startBlock : 0;
  const pending = new Map<number, string>();

  /** Compare block n with the reference. Returns false (after reporting) on a mismatch. */
  async function verify(n: number, hash: string): Promise<boolean | null> {
    const r = await ref!.block(n);
    if (!r) {
      warn("reference has no block", { block_num: n });
      return null;
    }
    if (r.l2_block_id === hash) {
      lastVerified = n;
      for (const k of pending.keys()) if (k <= n) pending.delete(k);
      log("verified", { status: "ok", block_num: n, l2_block_id: hash });
      return true;
    }
    // bisect (lastVerified, n] for the first mismatching block
    let lo = lastVerified; // known good (or 0)
    let hi = n; // known bad
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const ours = pending.get(mid);
      const theirs = ours === undefined ? undefined : (await ref!.block(mid))?.l2_block_id;
      if (ours === undefined || theirs === undefined) break;
      if (ours === theirs) lo = mid;
      else hi = mid;
    }
    const first = (await ref!.block(hi))!;
    const report = {
      first_mismatch: hi,
      last_match: lo,
      ours: pending.get(hi) ?? null,
      theirs: first?.l2_block_id ?? null,
      detected_at: n,
      next_step: `npm run diff-block --workspace packages/validator -- ${hi}`,
    };
    if (config.checkpointDir) mkdirSync(config.checkpointDir, { recursive: true });
    if (config.checkpointDir) writeFileSync(join(config.checkpointDir, `mismatch-${hi}.json`), JSON.stringify(report, null, 2) + "\n");
    error("hash mismatch", report);
    return false;
  }

  let prev = startHash;
  let processed = 0;
  let lastBlock = startBlock;
  const rate = new RollingRate();
  for await (const { block, blockNum, headBlock } of streamBlocks(startBlock + 1, config.stopBlock)) {
    const result = processor.process(blockNum, block, prev);
    prev = result.l2_block_id;
    lastBlock = blockNum;
    processed++;
    if (ref) pending.set(blockNum, result.l2_block_id);
    const r = rate.tick();
    const behind = headBlock - blockNum;
    if (behind < 50 || processed % 1000 === 0) {
      log("block", {
        block_num: blockNum,
        l2_block_id: result.l2_block_id,
        txs: result.transactions.length,
        validator: result.validator,
        reward: result.reward === 0 ? 0 : result.reward[0],
        reward_token: result.reward === 0 ? null : result.reward[1],
        head_block: headBlock,
        behind,
        rate: Number(r.toFixed(2)),
        rss_mb: Math.round(process.memoryUsage().rss / 1048576),
      });
    }
    if (config.hashLog) appendFileSync(config.hashLog, `${blockNum} ${result.l2_block_id}\n`);
    statusFile.update({ block_num: blockNum, head_block: headBlock, rate: r });
    duties?.duties.onBlock({ block_num: blockNum, l2_block_id: result.l2_block_id, validator: result.validator, transactions: result.transactions, head_block: headBlock });
    duties?.priceFeed?.onBlock({ block_num: blockNum, head_block: headBlock });

    const atCheckpoint = config.checkpointDir !== "" && blockNum % config.checkpointEvery === 0;
    const atSnapshot = config.snapshotDir !== "" && blockNum % config.snapshotEvery === 0;
    let ok: boolean | null = null;
    if (ref && (atCheckpoint || atSnapshot || blockNum % config.verifyEvery === 0)) {
      ok = await verify(blockNum, result.l2_block_id);
      if (ok === false) process.exit(2);
    }
    if (atCheckpoint && (ok === true || !ref)) {
      const t0 = Date.now();
      const f = writeCheckpoint(config.checkpointDir, state, { block_num: blockNum, l2_block_id: result.l2_block_id, block_id: block.block_id, verified: ok === true });
      pruneCheckpoints(config.checkpointDir, config.checkpointKeep, config.checkpointKeepEvery);
      log("checkpoint written", { block_num: blockNum, file: f, verified: ok === true, seconds: (Date.now() - t0) / 1000 });
    }
    if (atSnapshot && (ok === true || !ref)) {
      const t0 = Date.now();
      const manifest = await writeSnapshot(config.snapshotDir, state, { block_num: blockNum, l2_block_id: result.l2_block_id, block_id: block.block_id }, config.snapshotKeep);
      log("snapshot exported", { block_num: blockNum, file: manifest.file, bytes: manifest.bytes, sha256: manifest.sha256, verified: ok === true, seconds: (Date.now() - t0) / 1000 });
    }
  }
  log("validator stopped", { last_block: lastBlock });
}

main().catch((err) => {
  if (err instanceof OperationError) {
    const cause = err.cause instanceof Error ? err.cause : undefined;
    error(err.unsupported ? "unsupported operation, stopping" : "operation failed, stopping", {
      ...err.context,
      reason: cause?.message ?? String(err.cause),
      error: cause?.stack ?? String(err.cause),
    });
    process.exit(1);
  }
  error("fatal", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  process.exit(1);
});
