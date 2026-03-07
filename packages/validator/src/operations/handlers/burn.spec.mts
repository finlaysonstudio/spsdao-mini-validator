import { describe, it, expect } from "vitest";
import { handleBurn } from "./burn.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleBurn", () => {
  it("valid burn subtracts from player and adds to $NULL", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "burn" });
    const action = createParsedAction({
      name: "burn",
      players: ["alice"],
      params: { qty: 10, token: "SPS" },
    });

    const aliceBefore = state.balances.get("alice", "SPS");
    const nullBefore = state.balances.get("$NULL", "SPS");

    const result = handleBurn(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPS")).toBe(aliceBefore - 10);
    expect(state.balances.get("$NULL", "SPS")).toBe(nullBefore + 10);
  });

  it("returns error 1 for invalid params (missing token)", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "burn",
      players: ["alice"],
      params: { qty: 10 },
    });

    const result = handleBurn(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 3 for insufficient balance", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "burn",
      players: ["alice"],
      params: { qty: 999999, token: "SPS" },
    });

    const result = handleBurn(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});
