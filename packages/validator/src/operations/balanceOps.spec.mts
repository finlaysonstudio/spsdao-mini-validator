import { describe, it, expect } from "vitest";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "./balanceOps.mjs";
import type { BalanceContext } from "./balanceOps.mjs";
import { createStateStore } from "../__fixtures__/helpers.mjs";

function makeBalanceContext(
  overrides: Partial<BalanceContext> = {},
): BalanceContext {
  return {
    state: overrides.state ?? createStateStore(),
    blockTime: overrides.blockTime ?? new Date("2024-01-15T12:00:03.000Z"),
    blockNum: overrides.blockNum ?? 100001,
    trxId: overrides.trxId ?? "test-trx-id-001",
    actionType: overrides.actionType ?? "token_transfer",
  };
}

describe("addBalance", () => {
  it("increases balance and returns update + history events", () => {
    const state = createStateStore();
    const ctx = makeBalanceContext({ state });
    const before = state.balances.get("alice", "SPS");

    const result = addBalance(ctx, "alice", "SPS", 50);

    expect(state.balances.get("alice", "SPS")).toBe(before + 50);
    expect(result.updates).toHaveLength(1);
    expect(result.history).toHaveLength(1);
    expect(result.updates[0].object_type).toBe("balances");
    expect(result.updates[0].event_type).toBe("update");
    expect(result.history[0].object_type).toBe("balance_history");
    expect(result.history[0].event_type).toBe("insert");
  });

  it("event data contains correct fields", () => {
    const state = createStateStore();
    const ctx = makeBalanceContext({ state });
    const before = state.balances.get("alice", "SPS");

    const result = addBalance(ctx, "alice", "SPS", 50);

    const updateData = result.updates[0].data;
    expect(updateData.player).toBe("alice");
    expect(updateData.token).toBe("SPS");
    // balance is toFixed(3) string
    expect(updateData.balance).toBe((before + 50).toFixed(3));

    const histData = result.history[0].data;
    expect(histData.player).toBe("alice");
    expect(histData.token).toBe("SPS");
    expect(histData.amount).toBe("50");
    expect(histData.balance_start).toBe(String(before));
    expect(histData.balance_end).toBe((before + 50).toFixed(3));
    expect(histData.block_num).toBe(100001);
    expect(histData.trx_id).toBe("test-trx-id-001");
    expect(histData.type).toBe("token_transfer");
  });

  it("history contains counterparty when provided", () => {
    const ctx = makeBalanceContext();
    const result = addBalance(ctx, "alice", "SPS", 10, "bob");
    expect(result.history[0].data.counterparty).toBe("bob");
  });
});

describe("subtractBalance", () => {
  it("decreases balance and returns events", () => {
    const state = createStateStore();
    const ctx = makeBalanceContext({ state });
    const before = state.balances.get("alice", "SPS");

    const result = subtractBalance(ctx, "alice", "SPS", 100);

    expect(result).not.toBeNull();
    expect(state.balances.get("alice", "SPS")).toBe(before - 100);
    expect(result!.updates).toHaveLength(1);
    expect(result!.history).toHaveLength(1);
  });

  it("returns null for insufficient balance", () => {
    const state = createStateStore();
    const ctx = makeBalanceContext({ state });

    const result = subtractBalance(ctx, "alice", "SPS", 999999);

    expect(result).toBeNull();
  });

  it("does not mutate state on failure", () => {
    const state = createStateStore();
    const ctx = makeBalanceContext({ state });
    const before = state.balances.get("alice", "SPS");

    subtractBalance(ctx, "alice", "SPS", 999999);

    expect(state.balances.get("alice", "SPS")).toBe(before);
  });
});

describe("combineBalanceEvents", () => {
  it("orders: otherEvents first, then all updates, then all history", () => {
    const otherEvent = {
      object_type: "custom",
      event_type: "insert",
      data: { info: "other" },
    };
    const result1 = {
      updates: [
        { object_type: "balances", event_type: "update", data: { player: "a" } },
      ],
      history: [
        {
          object_type: "balance_history",
          event_type: "insert",
          data: { player: "a" },
        },
      ],
    };
    const result2 = {
      updates: [
        { object_type: "balances", event_type: "update", data: { player: "b" } },
      ],
      history: [
        {
          object_type: "balance_history",
          event_type: "insert",
          data: { player: "b" },
        },
      ],
    };

    const combined = combineBalanceEvents([otherEvent], result1, result2);

    expect(combined).toHaveLength(5);
    expect(combined[0].object_type).toBe("custom");
    expect(combined[1].object_type).toBe("balances");
    expect(combined[1].data.player).toBe("a");
    expect(combined[2].object_type).toBe("balances");
    expect(combined[2].data.player).toBe("b");
    expect(combined[3].object_type).toBe("balance_history");
    expect(combined[3].data.player).toBe("a");
    expect(combined[4].object_type).toBe("balance_history");
    expect(combined[4].data.player).toBe("b");
  });
});
