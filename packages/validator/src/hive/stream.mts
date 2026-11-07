import { config } from "../config.mjs";
import { BlockCache } from "./cache.mjs";
import { CHUNK_SIZE, ChunkCache, chunkStart } from "./chunks.mjs";
import { getHeadBlockNum } from "./client.mjs";
import type { HiveBlock } from "./types.mjs";

import { log } from "../util/log.mjs";

const POLL_INTERVAL_MS = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chunks fetched ahead of the processor, one in flight per RPC node. */
const CHUNK_LOOKAHEAD = Math.max(2, config.rpcNodes.length * 2);

export async function* streamBlocks(startBlock: number, stopBlock = 0): AsyncGenerator<{ block: HiveBlock; blockNum: number; headBlock: number }> {
  const cache = new BlockCache(config.blockCacheDir);
  let next = startBlock;
  let headBlock = 0;

  if (config.chunkCacheDir) {
    // Replay through whole chunks while they are entirely below the head.
    const chunks = new ChunkCache(config.chunkCacheDir);
    headBlock = await getHeadBlockNum();
    const inflight = new Map<number, Promise<HiveBlock[]>>();
    let nodeIdx = 0;
    const want = (start: number) => {
      if (inflight.has(start) || start + CHUNK_SIZE - 1 > headBlock) return;
      if (stopBlock && start > stopBlock) return;
      const node = config.rpcNodes[nodeIdx++ % config.rpcNodes.length];
      const p = chunks.has(start) ? Promise.resolve(chunks.read(start)!) : chunks.fetch(start, node);
      p.catch(() => undefined); // surfaced when awaited
      inflight.set(start, p);
    };
    let lastId: string | null = null;
    while (chunkStart(next) + CHUNK_SIZE - 1 <= headBlock) {
      if (stopBlock && next > stopBlock) return;
      const start = chunkStart(next);
      for (let k = 0; k < CHUNK_LOOKAHEAD; k++) want(start + k * CHUNK_SIZE);
      let blocks: HiveBlock[];
      try {
        blocks = await inflight.get(start)!;
      } catch (err) {
        inflight.delete(start);
        log("chunk fetch failed, retrying", { chunk: start, error: (err as Error).message });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      inflight.delete(start);
      const offset = start === 0 ? 1 : start; // chunk 0 holds blocks 1..999
      for (let n = next; n < start + CHUNK_SIZE; n++) {
        if (stopBlock && n > stopBlock) return;
        const block = blocks[n - offset];
        if (lastId !== null && block.previous !== lastId) throw new Error(`chain discontinuity at block ${n}: previous ${block.previous} != ${lastId}`);
        lastId = block.block_id;
        yield { block, blockNum: n, headBlock };
      }
      next = start + CHUNK_SIZE;
      if (next + CHUNK_SIZE * CHUNK_LOOKAHEAD > headBlock) headBlock = await getHeadBlockNum();
    }
    headBlock = 0;
  }

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
