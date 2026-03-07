import { describe, it, expect } from "vitest";
import { processBlock } from "./pipeline.mjs";
import {
  createStateStore,
  FIXTURE_BLOCK_NUM,
  FIXTURE_PREV_L2_HASH,
  makeHiveBlock,
  makeCustomJsonTx,
} from "./__fixtures__/helpers.mjs";

describe("processBlock", () => {
  it("processes empty block (no transactions) and returns l2Hash and empty blockchain transactions", () => {
    const state = createStateStore();
    const block = makeHiveBlock();

    const result = processBlock(
      block,
      FIXTURE_BLOCK_NUM,
      state,
      FIXTURE_PREV_L2_HASH,
    );

    expect(result.blockNum).toBe(FIXTURE_BLOCK_NUM);
    expect(result.l2Hash).toBeDefined();
    expect(typeof result.l2Hash).toBe("string");
    expect(result.l2Hash.length).toBeGreaterThan(0);
    expect(result.blockchainTransactions).toEqual([]);
    expect(result.prevL2Hash).toBe(FIXTURE_PREV_L2_HASH);
  });

  it("l2Hash is deterministic for same inputs", () => {
    const state1 = createStateStore();
    const state2 = createStateStore();
    const block = makeHiveBlock();

    const result1 = processBlock(
      block,
      FIXTURE_BLOCK_NUM,
      state1,
      FIXTURE_PREV_L2_HASH,
    );
    const result2 = processBlock(
      block,
      FIXTURE_BLOCK_NUM,
      state2,
      FIXTURE_PREV_L2_HASH,
    );

    expect(result1.l2Hash).toBe(result2.l2Hash);
  });

  it("processes block with custom_json transaction", () => {
    const state = createStateStore();
    const { tx, txId } = makeCustomJsonTx(
      "sm_stake_tokens",
      { token: "SPS", qty: 10 },
      { required_posting_auths: ["alice"] },
    );
    const block = makeHiveBlock({
      transactions: [tx],
      transaction_ids: [txId],
    });

    const result = processBlock(
      block,
      FIXTURE_BLOCK_NUM,
      state,
      FIXTURE_PREV_L2_HASH,
    );

    expect(result.blockchainTransactions.length).toBeGreaterThanOrEqual(1);
    expect(result.blockchainTransactions[0].type).toBe("stake_tokens");
  });

  it("virtual ops run before blockchain ops (virtualTransactions come first)", () => {
    const state = createStateStore();
    // The fixture has $NULL with 50 SPS and an active pool, so virtual ops will fire
    const { tx, txId } = makeCustomJsonTx(
      "sm_stake_tokens",
      { token: "SPS", qty: 10 },
      { required_posting_auths: ["alice"] },
    );
    const block = makeHiveBlock({
      transactions: [tx],
      transaction_ids: [txId],
    });

    const result = processBlock(
      block,
      FIXTURE_BLOCK_NUM,
      state,
      FIXTURE_PREV_L2_HASH,
    );

    expect(result.virtualTransactions.length).toBeGreaterThan(0);
    expect(result.allTransactions.length).toBe(
      result.virtualTransactions.length +
        result.blockchainTransactions.length,
    );
    // Virtual transactions are first in allTransactions
    for (let i = 0; i < result.virtualTransactions.length; i++) {
      expect(result.allTransactions[i]).toBe(result.virtualTransactions[i]);
    }
  });

  it("globalIndex is sequential across virtual + blockchain transactions", () => {
    const state = createStateStore();
    const { tx, txId } = makeCustomJsonTx(
      "sm_stake_tokens",
      { token: "SPS", qty: 10 },
      { required_posting_auths: ["alice"] },
    );
    const block = makeHiveBlock({
      transactions: [tx],
      transaction_ids: [txId],
    });

    const result = processBlock(
      block,
      FIXTURE_BLOCK_NUM,
      state,
      FIXTURE_PREV_L2_HASH,
    );

    for (let i = 0; i < result.allTransactions.length; i++) {
      expect(result.allTransactions[i].index).toBe(i);
    }
  });

  it("stores block reference in state", () => {
    const state = createStateStore();
    const block = makeHiveBlock();

    const result = processBlock(
      block,
      FIXTURE_BLOCK_NUM,
      state,
      FIXTURE_PREV_L2_HASH,
    );

    const stored = state.blocks.get(FIXTURE_BLOCK_NUM);
    expect(stored).toBeDefined();
    expect(stored!.block_num).toBe(FIXTURE_BLOCK_NUM);
    expect(stored!.l2_block_id).toBe(result.l2Hash);
  });

  it("tracks create_claimed_account operations in hiveAccounts", () => {
    const state = createStateStore();
    const block = makeHiveBlock({
      transactions: [
        {
          ref_block_num: 0,
          ref_block_prefix: 0,
          expiration: "2024-01-15T12:01:00",
          operations: [
            {
              type: "create_claimed_account_operation",
              value: { new_account_name: "newuser123" },
            },
          ],
          extensions: [],
          signatures: [],
        },
      ],
      transaction_ids: ["trx-create-account"],
    });

    processBlock(block, FIXTURE_BLOCK_NUM, state, FIXTURE_PREV_L2_HASH);

    expect(state.hiveAccounts.has("newuser123")).toBe(true);
  });

  it("returns selectedValidator info", () => {
    const state = createStateStore();
    const block = makeHiveBlock();

    const result = processBlock(
      block,
      FIXTURE_BLOCK_NUM,
      state,
      FIXTURE_PREV_L2_HASH,
    );

    // Fixture has 2 validators with min_validators=2, so selection should work
    expect(result.selectedValidator).toBeDefined();
    expect(typeof result.selectedValidator).toBe("string");
  });

  it("returns activeValidators list with vote percentages", () => {
    const state = createStateStore();
    const block = makeHiveBlock();

    const result = processBlock(
      block,
      FIXTURE_BLOCK_NUM,
      state,
      FIXTURE_PREV_L2_HASH,
    );

    expect(result.activeValidators.length).toBeGreaterThan(0);
    expect(result.activeValidatorCount).toBe(result.activeValidators.length);

    for (const v of result.activeValidators) {
      expect(v).toHaveProperty("account");
      expect(v).toHaveProperty("totalVotes");
      expect(v).toHaveProperty("votePercent");
      expect(typeof v.votePercent).toBe("number");
    }

    // Vote percentages should sum to ~100
    const totalPercent = result.activeValidators.reduce(
      (sum, v) => sum + v.votePercent,
      0,
    );
    expect(totalPercent).toBeCloseTo(100, 0);
  });
});
