import { describe, it, expect } from "vitest";
import { generateUpdateMissedBlocks } from "./updateMissedBlocks.mjs";
import {
  createStateStore,
  FIXTURE_BLOCK_NUM,
  FIXTURE_BLOCK_TIME,
} from "../__fixtures__/helpers.mjs";

describe("generateUpdateMissedBlocks", () => {
  it("returns empty when no previous block", () => {
    const state = createStateStore();
    // Query a block number whose previous block does not exist in state
    const results = generateUpdateMissedBlocks(state, 999999, FIXTURE_BLOCK_TIME);
    expect(results).toEqual([]);
  });

  it("returns empty (placeholder) even with previous block", () => {
    const state = createStateStore();
    // Fixture stores block 100000 in state.blocks
    // So blockNum 100001 has previous block 100000
    const results = generateUpdateMissedBlocks(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results).toEqual([]);
  });
});
