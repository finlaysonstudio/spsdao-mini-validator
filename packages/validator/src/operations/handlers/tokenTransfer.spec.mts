import { describe, it, expect } from "vitest";
import {
  handleTokenTransfer,
  handleTokenTransferMulti,
} from "./tokenTransfer.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleTokenTransfer", () => {
  it("valid transfer moves balance from sender to recipient", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "token_transfer" });
    const action = createParsedAction({
      name: "token_transfer",
      players: ["alice"],
      params: { to: "bob", qty: 100, token: "SPS" },
    });

    const aliceBefore = state.balances.get("alice", "SPS");
    const bobBefore = state.balances.get("bob", "SPS");

    const result = handleTokenTransfer(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPS")).toBe(aliceBefore - 100);
    expect(state.balances.get("bob", "SPS")).toBe(bobBefore + 100);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("returns error 1 for invalid params (missing to)", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "token_transfer",
      players: ["alice"],
      params: { qty: 10, token: "SPS" },
    });

    const result = handleTokenTransfer(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 2 for self-transfer", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "token_transfer",
      players: ["alice"],
      params: { to: "alice", qty: 10, token: "SPS" },
    });

    const result = handleTokenTransfer(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });

  it("returns error 3 for insufficient balance", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "token_transfer",
      players: ["alice"],
      params: { to: "bob", qty: 999999, token: "SPS" },
    });

    const result = handleTokenTransfer(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});

describe("handleTokenTransferMulti", () => {
  it("valid multi-transfer distributes to multiple recipients", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "token_transfer_multi" });
    const action = createParsedAction({
      name: "token_transfer_multi",
      players: ["alice"],
      params: { to: ["bob"], qty: [50], token: "SPS" },
    });

    const aliceBefore = state.balances.get("alice", "SPS");
    const bobBefore = state.balances.get("bob", "SPS");

    const result = handleTokenTransferMulti(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPS")).toBe(aliceBefore - 50);
    expect(state.balances.get("bob", "SPS")).toBe(bobBefore + 50);
  });

  it("returns error 1 for invalid params (mismatched arrays)", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "token_transfer_multi",
      players: ["alice"],
      params: { to: ["bob", "charlie"], qty: [10], token: "SPS" },
    });

    const result = handleTokenTransferMulti(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 3 for insufficient total balance", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "token_transfer_multi",
      players: ["alice"],
      params: { to: ["bob"], qty: [999999], token: "SPS" },
    });

    const result = handleTokenTransferMulti(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});
