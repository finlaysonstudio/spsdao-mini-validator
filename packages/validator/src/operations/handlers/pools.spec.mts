import { describe, it, expect } from "vitest";
import {
  handleAddPool,
  handleUpdatePool,
  handleDisablePool,
} from "./pools.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleAddPool", () => {
  it("creates a new pool", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "add_pool" });
    const action = createParsedAction({
      name: "add_pool",
      players: ["admin"],
      params: {
        name: "new_pool",
        token: "DECP",
        reward_token: "DEC",
        tokens_per_block: 0.5,
      },
    });

    const result = handleAddPool(action, ctx);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].object_type).toBe("staking_pools");
    expect(result.events[0].event_type).toBe("insert");

    const pool = state.pools.getPool("new_pool");
    expect(pool).toBeDefined();
    expect(pool!.token).toBe("DECP");
    expect(pool!.reward_token).toBe("DEC");
    expect(pool!.tokens_per_block).toBe(0.5);
    expect(pool!.is_active).toBe(true);
  });

  it("returns error 2 for pool already exists", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "add_pool",
      players: ["admin"],
      params: {
        name: "sps_staking",
        token: "SPSP",
        reward_token: "SPS",
      },
    });

    const result = handleAddPool(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });

  it("returns error 1 for missing params", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "add_pool",
      players: ["admin"],
      params: { name: "pool1" },
    });

    const result = handleAddPool(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });
});

describe("handleUpdatePool", () => {
  it("updates tokens_per_block", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "update_pool" });
    const action = createParsedAction({
      name: "update_pool",
      players: ["admin"],
      params: { name: "sps_staking", tokens_per_block: 0.05 },
    });

    const result = handleUpdatePool(action, ctx);

    expect(result.success).toBe(true);
    const pool = state.pools.getPool("sps_staking");
    expect(pool!.tokens_per_block).toBe(0.05);
  });

  it("returns error 2 for pool not found", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "update_pool",
      players: ["admin"],
      params: { name: "nonexistent_pool", tokens_per_block: 0.01 },
    });

    const result = handleUpdatePool(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});

describe("handleDisablePool", () => {
  it("sets pool inactive", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "disable_pool" });
    const action = createParsedAction({
      name: "disable_pool",
      players: ["admin"],
      params: { name: "sps_staking" },
    });

    const result = handleDisablePool(action, ctx);

    expect(result.success).toBe(true);
    const pool = state.pools.getPool("sps_staking");
    expect(pool!.is_active).toBe(false);
  });

  it("returns error 2 for pool not found", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "disable_pool",
      players: ["admin"],
      params: { name: "nonexistent_pool" },
    });

    const result = handleDisablePool(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});
