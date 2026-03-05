import { config } from "../config.mjs";
import { getBlock, getBlocks, getHeadBlockNum } from "./client.mjs";
import type { HiveBlock } from "./types.mjs";

const POLL_INTERVAL_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function* streamBlocks(
  startBlock: number,
): AsyncGenerator<{ block: HiveBlock; blockNum: number; nearHead: boolean }> {
  let nextBlock = startBlock;

  while (true) {
    const headBlock = await getHeadBlockNum();

    if (nextBlock > headBlock) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const behind = headBlock - nextBlock;

    if (behind >= config.replayBatchSize) {
      // Batch fetch during catch-up
      const batchSize = Math.min(config.replayBatchSize, behind + 1);
      const blocks = await getBlocks(nextBlock, batchSize);

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (!block) {
          throw new Error(`Missing block ${nextBlock + i}`);
        }
        yield { block, blockNum: nextBlock + i, nearHead: false };
      }
      nextBlock += blocks.length;
    } else {
      // Near head — fetch one at a time
      const block = await getBlock(nextBlock);
      if (!block) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      yield { block, blockNum: nextBlock, nearHead: true };
      nextBlock++;
    }
  }
}
