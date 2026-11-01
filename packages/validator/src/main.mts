/**
 * Observer mode: replay Hive blocks from a seed, compute each L2 block hash,
 * log it. Nothing is broadcast; no keys are needed.
 */
import { appendFileSync } from "node:fs";
import { config } from "./config.mjs";
import { BlockProcessor } from "./block/processor.mjs";
import { loadSeed } from "./bootstrap/seed.mjs";
import { streamBlocks } from "./hive/stream.mjs";
import { Services } from "./services.mjs";
import { StateStore } from "./state/index.mjs";
import { error, log } from "./util/log.mjs";

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

async function main() {
  log("observer starting", { seed_file: config.seedFile, head_mode: config.blocksHeadMode, blocks_behind_head: config.blocksBehindHead });
  const state = new StateStore();
  const meta = await loadSeed(state, config.seedFile);
  const svc = new Services(state, { custom_json_id: config.customJsonId, custom_json_prefix: config.customJsonPrefix });
  const processor = new BlockProcessor(svc);

  let prev = meta.l2_block_id;
  let processed = 0;
  const rate = new RollingRate();
  for await (const { block, blockNum, headBlock } of streamBlocks(meta.block_num + 1, config.stopBlock)) {
    const result = processor.process(blockNum, block, prev);
    prev = result.l2_block_id;
    processed++;
    const r = rate.tick();
    const behind = headBlock - blockNum;
    if (behind < 50 || processed % 100 === 0) {
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
  }
  log("observer stopped", { last_block: meta.block_num + processed });
}

main().catch((err) => {
  error("fatal", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});
