import { config } from "../config.mjs";
import { BlockCache } from "./cache.mjs";
import { getHeadBlockNum } from "./client.mjs";
import type { HiveBlock } from "./types.mjs";

const POLL_INTERVAL_MS = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function* streamBlocks(startBlock: number, stopBlock = 0): AsyncGenerator<{ block: HiveBlock; blockNum: number; headBlock: number }> {
  const cache = new BlockCache(config.blockCacheDir);
  let next = startBlock;
  let headBlock = 0;
  while (true) {
    if (stopBlock && next > stopBlock) return;
    if (next > headBlock) {
      headBlock = await getHeadBlockNum();
      if (next > headBlock) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
    }
    const behind = headBlock - next;
    const batch = Math.max(1, Math.min(config.replayBatchSize, behind + 1));
    const blocks = await Promise.all(Array.from({ length: batch }, (_, i) => cache.get(next + i)));
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block) {
        // block not yet available from this node; back off and retry from here
        next += i;
        await sleep(POLL_INTERVAL_MS);
        headBlock = 0;
        break;
      }
      yield { block, blockNum: next + i, headBlock };
      if (i === blocks.length - 1) next += blocks.length;
    }
  }
}
