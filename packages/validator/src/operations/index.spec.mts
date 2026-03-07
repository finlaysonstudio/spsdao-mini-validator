import { describe, it, expect } from "vitest";
import { processAction } from "./index.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../__fixtures__/helpers.mjs";

describe("processAction", () => {
  it("returns null for unknown action type", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({ name: "nonexistent_action" });
    const result = processAction(action, ctx);
    expect(result).toBeNull();
  });

  it("dispatches token_transfer to handler", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "token_transfer" });
    const action = createParsedAction({
      name: "token_transfer",
      players: ["alice"],
      params: { to: "bob", qty: 10, token: "SPS" },
    });
    const result = processAction(action, ctx);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
  });

  const registeredActions: [string, Record<string, unknown>, string[]][] = [
    ["token_transfer", { to: "bob", qty: 1, token: "SPS" }, ["alice"]],
    [
      "token_transfer_multi",
      { to: ["bob"], qty: [1], token: "SPS" },
      ["alice"],
    ],
    ["token_award", { to: "alice", qty: 1, token: "SPS" }, ["alice"]],
    ["burn", { qty: 1, token: "SPS" }, ["alice"]],
    ["stake_tokens", { token: "SPS", qty: 1 }, ["alice"]],
    [
      "stake_tokens_multi",
      { token: "SPS", qty: [1], to: ["bob"] },
      ["alice"],
    ],
    ["unstake_tokens", { token: "SPS", qty: 1 }, ["alice"]],
    [
      "cancel_unstake_tokens",
      { unstake_tx: "tx_unstake_001" },
      ["alice"],
    ],
    ["delegate_tokens", { to: "bob", qty: 1, token: "SPS" }, ["alice"]],
    ["return_tokens", { to: "alice", qty: 1, token: "SPS" }, ["bob"]],
    ["claim_staking_rewards", { token: "SPS" }, ["alice"]],
    ["shop_purchase", { qty: 1, token: "SPS" }, ["alice"]],
    [
      "approve_validator",
      { account_name: "newvalidator" },
      ["newvalidator"],
    ],
    [
      "unapprove_validator",
      { account_name: "validator1" },
      ["validator1"],
    ],
    [
      "update_validator",
      { account_name: "validator1", post_url: "https://new.url" },
      ["validator1"],
    ],
    [
      "check_in_validator",
      { block_num: 100000, hash: "somehash" },
      ["validator1"],
    ],
    ["activate_license", { qty: 1 }, ["alice"]],
    ["deactivate_license", { qty: 1 }, ["alice"]],
    [
      "validate_block",
      { block_num: 100000, hash: "abc123def456abc123def456abc123def456abc123def456abc123def456abcd" },
      ["validator1"],
    ],
    [
      "price_feed",
      { updates: [{ token: "SPS", price: 0.025 }] },
      ["validator1"],
    ],
    [
      "add_pool",
      { name: "new_pool", token: "SPSP", reward_token: "SPS" },
      ["admin"],
    ],
    ["update_pool", { name: "sps_staking", tokens_per_block: 0.02 }, ["admin"]],
    ["disable_pool", { name: "sps_staking" }, ["admin"]],
    [
      "create_promise",
      { id: "new_promise", type: "escrow" },
      ["alice"],
    ],
    ["fulfill_promise", { id: "promise_001" }, ["bob"]],
    ["fulfill_promise_multi", { ids: ["promise_001"] }, ["bob"]],
    ["complete_promise", { id: "promise_001" }, ["alice"]],
    ["cancel_promise", { id: "promise_001" }, ["alice"]],
    ["reverse_promise", { id: "promise_001" }, ["alice"]],
    [
      "set_authority",
      { account_name: "alice", authorities: { admin: "true" } },
      ["alice"],
    ],
    [
      "config_update",
      { group_name: "validator", name: "min_validators", value: "3" },
      ["admin"],
    ],
  ];

  it.each(registeredActions)(
    "dispatches %s and returns non-null",
    (actionName, params, players) => {
      const state = createStateStore();
      // Delegation-related handlers need SPSP-OUT/SPSP-IN balances
      if (
        ["undelegate_tokens", "undelegate_tokens_multi", "return_tokens"].includes(
          actionName,
        )
      ) {
        state.balances.add("alice", "SPSP-OUT", 200);
        state.balances.add("bob", "SPSP-IN", 200);
      }
      const ctx = createActionContext({ state, actionType: actionName });
      const action = createParsedAction({
        name: actionName,
        players,
        params,
      });
      const result = processAction(action, ctx);
      expect(result).not.toBeNull();
    },
  );

  // Delegation handlers that need SPSP-OUT/SPSP-IN balances set up
  it("dispatches undelegate_tokens and returns non-null", () => {
    const state = createStateStore();
    state.balances.add("alice", "SPSP-OUT", 200);
    state.balances.add("bob", "SPSP-IN", 200);
    const ctx = createActionContext({ state, actionType: "undelegate_tokens" });
    const action = createParsedAction({
      name: "undelegate_tokens",
      players: ["alice"],
      params: { from: "bob", qty: 1, token: "SPS" },
    });
    const result = processAction(action, ctx);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
  });

  it("dispatches undelegate_tokens_multi and returns non-null", () => {
    const state = createStateStore();
    state.balances.add("alice", "SPSP-OUT", 200);
    state.balances.add("bob", "SPSP-IN", 200);
    const ctx = createActionContext({
      state,
      actionType: "undelegate_tokens_multi",
    });
    const action = createParsedAction({
      name: "undelegate_tokens_multi",
      players: ["alice"],
      params: { from: ["bob"], qty: [1], token: "SPS" },
    });
    const result = processAction(action, ctx);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
  });
});
