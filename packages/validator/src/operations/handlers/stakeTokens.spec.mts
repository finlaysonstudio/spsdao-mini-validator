import { describe, it, expect } from "vitest";
import { handleStakeTokens, handleStakeTokensMulti } from "./stakeTokens.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleStakeTokens", () => {
  it("converts SPS to SPSP", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "stake_tokens" });
    const action = createParsedAction({
      name: "stake_tokens",
      players: ["alice"],
      params: { token: "SPS", qty: 50 },
    });

    const spsBefore = state.balances.get("alice", "SPS");
    const spspBefore = state.balances.get("alice", "SPSP");

    const result = handleStakeTokens(action, ctx);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(state.balances.get("alice", "SPS")).toBe(spsBefore - 50);
    expect(state.balances.get("alice", "SPSP")).toBe(spspBefore + 50);
  });

  it("returns null for missing params (drops action)", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "stake_tokens",
      players: ["alice"],
      params: {},
    });

    const result = handleStakeTokens(action, ctx);

    expect(result).toBeNull();
  });

  it("returns error 3 for insufficient balance", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "stake_tokens",
      players: ["alice"],
      params: { token: "SPS", qty: 999999 },
    });

    const result = handleStakeTokens(action, ctx);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error?.code).toBe(3);
  });

  it("stakes to a different target when 'to' is provided", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "stake_tokens" });
    const action = createParsedAction({
      name: "stake_tokens",
      players: ["alice"],
      params: { token: "SPS", qty: 10, to: "bob" },
    });

    const bobSpspBefore = state.balances.get("bob", "SPSP");
    const result = handleStakeTokens(action, ctx);

    expect(result!.success).toBe(true);
    expect(state.balances.get("bob", "SPSP")).toBe(bobSpspBefore + 10);
  });
});

describe("handleStakeTokensMulti", () => {
  it("valid multi-stake distributes staked tokens", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "stake_tokens_multi" });
    const action = createParsedAction({
      name: "stake_tokens_multi",
      players: ["alice"],
      params: { token: "SPS", qty: [10, 20], to: ["bob", "alice"] },
    });

    const aliceSpsBefore = state.balances.get("alice", "SPS");
    const bobSpspBefore = state.balances.get("bob", "SPSP");

    const result = handleStakeTokensMulti(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPS")).toBe(aliceSpsBefore - 30);
    expect(state.balances.get("bob", "SPSP")).toBe(bobSpspBefore + 10);
  });

  it("returns error 1 for invalid params", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "stake_tokens_multi",
      players: ["alice"],
      params: { token: "SPS" },
    });

    const result = handleStakeTokensMulti(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 3 for insufficient balance", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "stake_tokens_multi",
      players: ["alice"],
      params: { token: "SPS", qty: [999999], to: ["bob"] },
    });

    const result = handleStakeTokensMulti(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});
