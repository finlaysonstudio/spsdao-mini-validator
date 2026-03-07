import { describe, it, expect } from "vitest";
import {
  handleDelegateTokens,
  handleUndelegateTokens,
  handleUndelegateTokensMulti,
  handleReturnTokens,
} from "./delegateTokens.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleDelegateTokens", () => {
  it("subtracts staked, adds OUT/IN, creates delegation record", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "delegate_tokens" });
    const action = createParsedAction({
      name: "delegate_tokens",
      players: ["alice"],
      params: { to: "bob", qty: 50, token: "SPS" },
      trxId: "deleg-trx-001",
    });

    const spspBefore = state.balances.get("alice", "SPSP");

    const result = handleDelegateTokens(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPSP")).toBe(spspBefore - 50);
    expect(state.balances.get("alice", "SPSP-OUT")).toBeGreaterThanOrEqual(50);
    expect(state.balances.get("bob", "SPSP-IN")).toBeGreaterThanOrEqual(50);

    const delegation = state.delegations.get("alice", "bob", "SPS");
    expect(delegation).toBeDefined();
    expect(delegation!.amount).toBeGreaterThanOrEqual(50);
  });

  it("returns error 2 for self-delegation", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "delegate_tokens",
      players: ["alice"],
      params: { to: "alice", qty: 10, token: "SPS" },
    });

    const result = handleDelegateTokens(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });

  it("returns error 3 for insufficient staked balance", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "delegate_tokens",
      players: ["alice"],
      params: { to: "bob", qty: 999999, token: "SPS" },
    });

    const result = handleDelegateTokens(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});

describe("handleUndelegateTokens", () => {
  it("reverses delegation and returns staked tokens to delegator", () => {
    const state = createStateStore();
    // Set up delegation balances: alice has SPSP-OUT, bob has SPSP-IN
    state.balances.add("alice", "SPSP-OUT", 100);
    state.balances.add("bob", "SPSP-IN", 100);
    const ctx = createActionContext({ state, actionType: "undelegate_tokens" });
    const action = createParsedAction({
      name: "undelegate_tokens",
      players: ["alice"],
      params: { from: "bob", qty: 50, token: "SPS" },
    });

    const spspBefore = state.balances.get("alice", "SPSP");
    const result = handleUndelegateTokens(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPSP")).toBe(spspBefore + 50);
  });

  it("returns error 2 for insufficient delegation", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "undelegate_tokens",
      players: ["alice"],
      params: { from: "bob", qty: 999999, token: "SPS" },
    });

    const result = handleUndelegateTokens(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});

describe("handleUndelegateTokensMulti", () => {
  it("undelegates from multiple delegatees", () => {
    const state = createStateStore();
    // Set up delegation balances
    state.balances.add("alice", "SPSP-OUT", 200);
    state.balances.add("bob", "SPSP-IN", 100);
    // Add second delegation
    state.delegations.set({
      delegator: "alice",
      delegatee: "bob",
      token: "SPS",
      amount: 100,
      last_delegation_tx: "tx-setup",
    });
    const ctx = createActionContext({
      state,
      actionType: "undelegate_tokens_multi",
    });
    const action = createParsedAction({
      name: "undelegate_tokens_multi",
      players: ["alice"],
      params: { from: ["bob"], qty: [50], token: "SPS" },
    });

    const result = handleUndelegateTokensMulti(action, ctx);

    expect(result.success).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("returns error 1 for invalid params", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "undelegate_tokens_multi",
      players: ["alice"],
      params: { token: "SPS" },
    });

    const result = handleUndelegateTokensMulti(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });
});

describe("handleReturnTokens", () => {
  it("delegatee returns tokens to delegator", () => {
    const state = createStateStore();
    // Seed already has alice->bob delegation of 100 SPS
    // Set up the IN/OUT balances
    state.balances.add("alice", "SPSP-OUT", 100);
    state.balances.add("bob", "SPSP-IN", 100);
    const ctx = createActionContext({ state, actionType: "return_tokens" });
    const action = createParsedAction({
      name: "return_tokens",
      players: ["bob"],
      params: { to: "alice", qty: 50, token: "SPS" },
    });

    const aliceSpspBefore = state.balances.get("alice", "SPSP");
    const result = handleReturnTokens(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPSP")).toBe(aliceSpspBefore + 50);
  });

  it("returns error 2 for insufficient delegation to return", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "return_tokens",
      players: ["bob"],
      params: { to: "alice", qty: 999999, token: "SPS" },
    });

    const result = handleReturnTokens(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});
