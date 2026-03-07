import { describe, it, expect } from "vitest";
import { generateClearBurned } from "./clearBurned.mjs";
import {
  createStateStore,
  FIXTURE_BLOCK_NUM,
  FIXTURE_BLOCK_TIME,
} from "../__fixtures__/helpers.mjs";

describe("generateClearBurned", () => {
  it("returns empty when $NULL has no positive balances", () => {
    const state = createStateStore();
    // Zero out the $NULL balance
    state.balances.set("$NULL", "SPS", 0);

    const results = generateClearBurned(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results).toEqual([]);
  });

  it("zeros out $NULL balance for each token", () => {
    const state = createStateStore();
    // Fixture has $NULL with 50 SPS
    expect(state.balances.get("$NULL", "SPS")).toBe(50);

    generateClearBurned(state, FIXTURE_BLOCK_NUM, FIXTURE_BLOCK_TIME);

    expect(state.balances.get("$NULL", "SPS")).toBe(0);
  });

  it("generates burn events with correct data", () => {
    const state = createStateStore();

    const results = generateClearBurned(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results.length).toBe(1);

    const { result } = results[0];
    expect(result.success).toBe(true);
    expect(result.events.length).toBe(2); // balances update + balance_history insert

    const updateEvent = result.events.find(
      (e) => e.event_type === "update" && e.object_type === "balances",
    );
    expect(updateEvent).toBeDefined();
    expect(updateEvent!.data.player).toBe("$NULL");
    expect(updateEvent!.data.token).toBe("SPS");
    expect(updateEvent!.data.balance).toBe("0.000");

    const historyEvent = result.events.find(
      (e) => e.object_type === "balance_history",
    );
    expect(historyEvent).toBeDefined();
    expect(historyEvent!.data.type).toBe("burn");
    expect(historyEvent!.data.block_num).toBe(FIXTURE_BLOCK_NUM);
  });

  it("action shape: name=burn, players=[$BURNED]", () => {
    const state = createStateStore();

    const results = generateClearBurned(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results.length).toBe(1);

    const { action } = results[0];
    expect(action.name).toBe("burn");
    expect(action.players).toEqual(["$BURNED"]);
    expect(action.params).toHaveProperty("token", "SPS");
    expect(action.params).toHaveProperty("qty", 50);
    expect(action.trxId).toBe(`sl_clear_burned_tokens_${FIXTURE_BLOCK_NUM}`);
  });
});
