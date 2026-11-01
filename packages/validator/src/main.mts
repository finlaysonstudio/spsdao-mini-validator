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
import { log } from "./util/log.mjs";

async function main() {
  log(`SPS mini validator (observer) starting; seed=${config.seedFile}`);
  const state = new StateStore();
  const meta = await loadSeed(state, config.seedFile);
  const svc = new Services(state, { custom_json_id: config.customJsonId, custom_json_prefix: config.customJsonPrefix });
  const processor = new BlockProcessor(svc);

  let prev = meta.l2_block_id;
  let processed = 0;
  const started = Date.now();
  for await (const { block, blockNum, headBlock } of streamBlocks(meta.block_num + 1, config.stopBlock)) {
    const result = processor.process(blockNum, block, prev);
    prev = result.l2_block_id;
    processed++;
    const line = `${blockNum} ${result.l2_block_id} txs=${result.transactions.length} validator=${result.validator ?? "-"}`;
    if (headBlock - blockNum < 50 || processed % 100 === 0) {
      const rate = (processed / ((Date.now() - started) / 1000)).toFixed(1);
      log(`${line} behind=${headBlock - blockNum} rate=${rate}/s rss=${(process.memoryUsage().rss / 1048576).toFixed(0)}MB`);
    }
    if (config.hashLog) appendFileSync(config.hashLog, `${blockNum} ${result.l2_block_id}\n`);
  }
  log(`stopped after block ${meta.block_num + processed}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
