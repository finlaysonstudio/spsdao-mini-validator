import { describe, it, expect } from "vitest";
import { BlockStore } from "./blocks.mjs";
import type { BlockRef } from "../types.mjs";

function makeBlock(block_num: number): BlockRef {
  return {
    block_num,
    block_id: `id-${block_num}`,
    prev_block_id: `id-${block_num - 1}`,
    block_time: new Date("2025-01-01"),
    l2_block_id: `l2-${block_num}`,
  };
}

describe("BlockStore", () => {
  it("get returns undefined for unknown block", () => {
    const store = new BlockStore();
    expect(store.get(999)).toBeUndefined();
  });

  it("set/get roundtrip", () => {
    const store = new BlockStore();
    const block = makeBlock(100);
    store.set(block);
    expect(store.get(100)).toEqual(block);
  });

  it("getLatest returns block with highest block_num", () => {
    const store = new BlockStore();
    store.set(makeBlock(10));
    store.set(makeBlock(50));
    store.set(makeBlock(30));

    const latest = store.getLatest();
    expect(latest).toBeDefined();
    expect(latest!.block_num).toBe(50);
  });

  it("getLatest returns undefined when empty", () => {
    const store = new BlockStore();
    expect(store.getLatest()).toBeUndefined();
  });

  it("getAll returns sorted by block_num", () => {
    const store = new BlockStore();
    store.set(makeBlock(30));
    store.set(makeBlock(10));
    store.set(makeBlock(20));

    const all = store.getAll();
    expect(all.map((b) => b.block_num)).toEqual([10, 20, 30]);
  });

  it("retention prunes old blocks", () => {
    const store = new BlockStore(3);
    for (let i = 1; i <= 5; i++) {
      store.set(makeBlock(i));
    }

    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((b) => b.block_num)).toEqual([3, 4, 5]);
  });

  it("retention 0 means no pruning", () => {
    const store = new BlockStore(0);
    for (let i = 1; i <= 10; i++) {
      store.set(makeBlock(i));
    }

    expect(store.getAll()).toHaveLength(10);
  });
});
