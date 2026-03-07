import { describe, it, expect } from "vitest";
import {
  handleUnstakeTokens,
  handleCancelUnstakeTokens,
} from "./unstakeTokens.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleUnstakeTokens", () => {
  it("creates unstaking record with 4-period split and subtracts staked token", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "unstake_tokens" });
    const action = createParsedAction({
      name: "unstake_tokens",
      players: ["alice"],
      params: { token: "SPS", qty: 100 },
      trxId: "unstake-trx-001",
    });

    const spspBefore = state.balances.get("alice", "SPSP");
    const result = handleUnstakeTokens(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPSP")).toBe(spspBefore - 100);

    const record = state.unstaking.get("unstake-trx-001");
    expect(record).toBeDefined();
    expect(record!.player).toBe("alice");
    expect(record!.token).toBe("SPS");
    expect(record!.quantity).toBe(25); // 100 / 4
    expect(record!.quantity_left).toBe(100);
    expect(record!.total_qty).toBe(100);
    expect(record!.is_active).toBe(true);
  });

  it("returns error 1 for invalid params", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "unstake_tokens",
      players: ["alice"],
      params: {},
    });

    const result = handleUnstakeTokens(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 3 for insufficient staked balance", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "unstake_tokens",
      players: ["alice"],
      params: { token: "SPS", qty: 999999 },
    });

    const result = handleUnstakeTokens(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});

describe("handleCancelUnstakeTokens", () => {
  it("refunds remaining quantity and marks inactive", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "cancel_unstake_tokens" });
    // seed has tx_unstake_001 with quantity_left=75 for alice
    const action = createParsedAction({
      name: "cancel_unstake_tokens",
      players: ["alice"],
      params: { unstake_tx: "tx_unstake_001" },
    });

    const spspBefore = state.balances.get("alice", "SPSP");
    const result = handleCancelUnstakeTokens(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPSP")).toBe(spspBefore + 75);

    const record = state.unstaking.get("tx_unstake_001");
    expect(record!.is_active).toBe(false);
    expect(record!.quantity_left).toBe(0);
  });

  it("returns error 1 for missing unstake_tx", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "cancel_unstake_tokens",
      players: ["alice"],
      params: {},
    });

    const result = handleCancelUnstakeTokens(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 2 for not found unstaking record", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "cancel_unstake_tokens",
      players: ["alice"],
      params: { unstake_tx: "nonexistent_tx" },
    });

    const result = handleCancelUnstakeTokens(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});
