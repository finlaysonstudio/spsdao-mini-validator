import { describe, it, expect } from "vitest";
import { generatePoolClaims } from "./poolClaims.mjs";
import {
  createStateStore,
  FIXTURE_BLOCK_NUM,
  FIXTURE_BLOCK_TIME,
} from "../__fixtures__/helpers.mjs";

describe("generatePoolClaims", () => {
  it("returns empty when no active pools", () => {
    const state = createStateStore();
    // Deactivate the only pool
    const pool = state.pools.getPool("sps_staking")!;
    pool.is_active = false;
    state.pools.setPool(pool);

    const results = generatePoolClaims(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results).toEqual([]);
  });

  it("returns empty when blockNum <= last_reward_block", () => {
    const state = createStateStore();
    const pool = state.pools.getPool("sps_staking")!;
    pool.last_reward_block = FIXTURE_BLOCK_NUM; // equal to current block
    state.pools.setPool(pool);

    const results = generatePoolClaims(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results).toEqual([]);
  });

  it("updates acc_tokens_per_share for active pool", () => {
    const state = createStateStore();
    const poolBefore = state.pools.getPool("sps_staking")!;
    const accBefore = poolBefore.acc_tokens_per_share;

    // Fixture: last_reward_block=99999, blockNum=100001 -> blocksElapsed=2
    const results = generatePoolClaims(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );

    const poolAfter = state.pools.getPool("sps_staking")!;
    expect(poolAfter.acc_tokens_per_share).toBeGreaterThan(accBefore);
    expect(results.length).toBe(1);
  });

  it("updates last_reward_block", () => {
    const state = createStateStore();

    generatePoolClaims(state, FIXTURE_BLOCK_NUM, FIXTURE_BLOCK_TIME);

    const poolAfter = state.pools.getPool("sps_staking")!;
    expect(poolAfter.last_reward_block).toBe(FIXTURE_BLOCK_NUM);
  });

  it("skips pools with 0 totalStaked but still updates last_reward_block", () => {
    const state = createStateStore();
    // Remove all SPSP balances so totalSupply("SPSP") = 0
    state.balances.set("alice", "SPSP", 0);
    state.balances.set("bob", "SPSP", 0);

    const results = generatePoolClaims(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );

    // No claim_pool action emitted
    expect(results).toEqual([]);
    // But last_reward_block still updated
    const pool = state.pools.getPool("sps_staking")!;
    expect(pool.last_reward_block).toBe(FIXTURE_BLOCK_NUM);
  });

  it("generates correct action shape", () => {
    const state = createStateStore();

    const results = generatePoolClaims(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results.length).toBe(1);

    const { action, result } = results[0];
    expect(action.name).toBe("claim_pool");
    expect(action.players).toEqual(["$POOL"]);
    expect(action.trxId).toBe(
      `sl_claim_pool_sps_staking_${FIXTURE_BLOCK_NUM}`,
    );
    expect(action.params).toHaveProperty("pool_name", "sps_staking");
    expect(action.params).toHaveProperty("reward");
    expect(typeof action.params.reward).toBe("number");
    expect(result.success).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].object_type).toBe("staking_pools");
  });
});
