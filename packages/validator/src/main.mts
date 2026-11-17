/**
 * Observer mode: replay Hive blocks from a seed (or the newest checkpoint),
 * compute each L2 block hash, log it. Nothing is broadcast; no keys are needed.
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
import { loadSeed } from "./bootstrap/seed.mjs";
import { ReferenceApi } from "./hive/reference.mjs";
import { streamBlocks } from "./hive/stream.mjs";
import { Services } from "./services.mjs";
import { listCheckpoints, loadCheckpoint, pruneCheckpoints, writeCheckpoint } from "./state/checkpoint.mjs";
import { StateStore } from "./state/index.mjs";
import { error, log, logStatus, warn } from "./util/log.mjs";
import { ShadowBroadcaster, ValidatorDuties, type DutyEvent } from "./validator/duties.mjs";

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

/** Upstream pins node:23.3 (V8 float functions differ between releases; see Dockerfile). */
const UPSTREAM_NODE = "v23.3.";

function makeDuties(svc: Services): ValidatorDuties | null {
  if (config.validatorAccounts.length === 0) return null;
  if (config.validatorMode !== "shadow") throw new Error(`VALIDATOR_MODE=${config.validatorMode} is not supported; only "shadow" exists`);
  const emit = ({ status, msg, fields }: DutyEvent) => {
    logStatus(status, msg, { mode: "shadow", ...fields });
    if (config.dutyLog) appendFileSync(config.dutyLog, JSON.stringify({ ts: new Date().toISOString(), status, msg, mode: "shadow", ...fields }) + "\n");
  };
  const duties = new ValidatorDuties({
    svc,
    accounts: config.validatorAccounts,
    broadcaster: new ShadowBroadcaster({ emit, customJsonId: config.customJsonId }),
    emit,
    version: config.validatorVersion,
    validateBlockDelay: config.validateBlockDelay,
    enableCheckIns: config.enableCheckIns,
    checkInRetryBlocks: config.checkInRetryBlocks,
  });
  log("validator duties enabled", { mode: "shadow", accounts: config.validatorAccounts, role: duties.role, validate_block_delay: config.validateBlockDelay, check_ins: config.enableCheckIns, version: config.validatorVersion });
  return duties;
}

async function main() {
  if (!process.version.startsWith(UPSTREAM_NODE)) warn("node version differs from upstream's; float results may not match", { node: process.version, upstream: UPSTREAM_NODE + "x" });
  log("observer starting", {
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
  const duties = makeDuties(svc);

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
    duties?.onBlock({ block_num: blockNum, l2_block_id: result.l2_block_id, validator: result.validator, transactions: result.transactions, head_block: headBlock });

    const atCheckpoint = config.checkpointDir !== "" && blockNum % config.checkpointEvery === 0;
    let ok: boolean | null = null;
    if (ref && (atCheckpoint || blockNum % config.verifyEvery === 0)) {
      ok = await verify(blockNum, result.l2_block_id);
      if (ok === false) process.exit(2);
    }
    if (atCheckpoint && (ok === true || !ref)) {
      const t0 = Date.now();
      const f = writeCheckpoint(config.checkpointDir, state, { block_num: blockNum, l2_block_id: result.l2_block_id, block_id: block.block_id, verified: ok === true });
      pruneCheckpoints(config.checkpointDir, config.checkpointKeep, config.checkpointKeepEvery);
      log("checkpoint written", { block_num: blockNum, file: f, verified: ok === true, seconds: (Date.now() - t0) / 1000 });
    }
  }
  log("observer stopped", { last_block: lastBlock });
}

main().catch((err) => {
  error("fatal", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  process.exit(1);
});
