import { describe, it, expect } from "vitest";
import { handleValidateBlock } from "./validateBlock.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
  FIXTURE_PREV_L2_HASH,
} from "../../__fixtures__/helpers.mjs";

describe("handleValidateBlock", () => {
  it("validates block and distributes reward", () => {
    const state = createStateStore();
    // The seed block_num=100000 has l2_block_id = FIXTURE_PREV_L2_HASH
    const ctx = createActionContext({
      state,
      actionType: "validate_block",
      blockNum: 100001,
    });
    const action = createParsedAction({
      name: "validate_block",
      players: ["validator1"],
      params: {
        block_num: 100000,
        hash: FIXTURE_PREV_L2_HASH,
      },
      trxId: "validate-trx-001",
    });

    const rewardsBefore = state.balances.get("$VALIDATOR_REWARDS", "SPS");
    const v1Before = state.balances.get("validator1", "SPS");

    const result = handleValidateBlock(action, ctx);

    expect(result.success).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);

    // Block record should be updated
    const block = state.blocks.get(100000);
    expect(block?.validator).toBe("validator1");
    expect(block?.validation_tx).toBe("validate-trx-001");

    // Reward should have been distributed
    const rewardsAfter = state.balances.get("$VALIDATOR_REWARDS", "SPS");
    expect(rewardsAfter).toBeLessThan(rewardsBefore);
  });

  it("returns error 1 for missing params", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "validate_block",
      players: ["validator1"],
      params: {},
    });

    const result = handleValidateBlock(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 2 for block too old", () => {
    const state = createStateStore();
    const ctx = createActionContext({
      state,
      blockNum: 200000,
    });
    const action = createParsedAction({
      name: "validate_block",
      players: ["validator1"],
      params: { block_num: 100000, hash: "somehash" },
    });

    const result = handleValidateBlock(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });

  it("returns error 3 for hash mismatch", () => {
    const state = createStateStore();
    const ctx = createActionContext({
      state,
      blockNum: 100001,
    });
    const action = createParsedAction({
      name: "validate_block",
      players: ["validator1"],
      params: { block_num: 100000, hash: "wrong_hash_value" },
    });

    const result = handleValidateBlock(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});
