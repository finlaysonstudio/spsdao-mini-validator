import { describe, it, expect } from "vitest";
import { handleClaimStakingRewards } from "./claimStakingRewards.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleClaimStakingRewards", () => {
  it("calculates pending from pool and claims reward", () => {
    const state = createStateStore();
    // alice has SPSP=500, pool acc_tokens_per_share=0.001, reward_debt=0.5
    // totalStaked = 500 (SPSP) + 0 (SPSP-IN) = 500
    // pending = round3(500 * 0.001 - 0.5) = round3(0) = 0 — no reward
    // Let's increase acc_tokens_per_share to make pending > 0
    const pool = state.pools.getPool("sps_staking")!;
    pool.acc_tokens_per_share = 0.01;
    state.pools.setPool(pool);
    // pending = round3(500 * 0.01 - 0.5) = round3(4.5) = 4.5

    const ctx = createActionContext({
      state,
      actionType: "claim_staking_rewards",
    });
    const action = createParsedAction({
      name: "claim_staking_rewards",
      players: ["alice"],
      params: { token: "SPS" },
    });

    const spsBefore = state.balances.get("alice", "SPS");
    const result = handleClaimStakingRewards(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPS")).toBe(spsBefore + 4.5);
  });

  it("returns error 1 for missing token", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "claim_staking_rewards",
      players: ["alice"],
      params: {},
    });

    const result = handleClaimStakingRewards(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 2 for no staked balance", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "claim_staking_rewards",
      players: ["bob"],
      params: { token: "NOTEXIST" },
    });

    const result = handleClaimStakingRewards(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });

  it("returns error 3 for no staking pool found", () => {
    const state = createStateStore();
    // alice has SPSP balance, but no pool for DEC token
    state.balances.add("alice", "DECP", 100);
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "claim_staking_rewards",
      players: ["alice"],
      params: { token: "DEC" },
    });

    const result = handleClaimStakingRewards(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});
