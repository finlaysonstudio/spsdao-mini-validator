import { describe, it, expect } from "vitest";
import { generateTokenUnstaking } from "./tokenUnstaking.mjs";
import {
  createStateStore,
  FIXTURE_BLOCK_NUM,
  FIXTURE_BLOCK_TIME,
} from "../__fixtures__/helpers.mjs";

describe("generateTokenUnstaking", () => {
  it("returns empty array when no records are ready", () => {
    const state = createStateStore();
    // The fixture has next_unstake_date in the future (2024-01-22),
    // and FIXTURE_BLOCK_TIME is 2024-01-15, so nothing is ready.
    const results = generateTokenUnstaking(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results).toEqual([]);
  });

  it("processes ready unstaking records", () => {
    const state = createStateStore();
    // Set next_unstake_date to the past so the record is ready
    const record = state.unstaking.get("tx_unstake_001")!;
    expect(record).toBeDefined();
    record.next_unstake_date = new Date("2024-01-10T00:00:00.000Z");
    state.unstaking.set(record);

    const results = generateTokenUnstaking(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results.length).toBe(1);
    expect(results[0].action.name).toBe("token_unstaking");
    expect(results[0].result.success).toBe(true);
  });

  it("credits liquid tokens to player", () => {
    const state = createStateStore();
    const balanceBefore = state.balances.get("alice", "SPS");

    const record = state.unstaking.get("tx_unstake_001")!;
    record.next_unstake_date = new Date("2024-01-10T00:00:00.000Z");
    state.unstaking.set(record);

    generateTokenUnstaking(state, FIXTURE_BLOCK_NUM, FIXTURE_BLOCK_TIME);

    const balanceAfter = state.balances.get("alice", "SPS");
    // quantity=25, quantity_left=75, amount = min(25, 75) = 25
    expect(balanceAfter).toBe(balanceBefore + 25);
  });

  it("deactivates record when quantity_left reaches 0", () => {
    const state = createStateStore();
    const record = state.unstaking.get("tx_unstake_001")!;
    record.next_unstake_date = new Date("2024-01-10T00:00:00.000Z");
    record.quantity_left = 25; // Same as quantity, so it will reach 0
    record.quantity = 25;
    state.unstaking.set(record);

    generateTokenUnstaking(state, FIXTURE_BLOCK_NUM, FIXTURE_BLOCK_TIME);

    const updated = state.unstaking.get("tx_unstake_001")!;
    expect(updated.is_active).toBe(false);
    expect(updated.quantity_left).toBe(0);
  });

  it("schedules next unstake when quantity_left > 0", () => {
    const state = createStateStore();
    const record = state.unstaking.get("tx_unstake_001")!;
    record.next_unstake_date = new Date("2024-01-10T00:00:00.000Z");
    // quantity=25, quantity_left=75 -> after unstake: 75-25=50 > 0
    state.unstaking.set(record);

    generateTokenUnstaking(state, FIXTURE_BLOCK_NUM, FIXTURE_BLOCK_TIME);

    const updated = state.unstaking.get("tx_unstake_001")!;
    expect(updated.is_active).toBe(true);
    expect(updated.quantity_left).toBe(50);
    // Next unstake should be 1 week after blockTime
    const expectedNext = new Date(
      FIXTURE_BLOCK_TIME.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    expect(updated.next_unstake_date.getTime()).toBe(expectedNext.getTime());
  });

  it("generates correct action shape", () => {
    const state = createStateStore();
    const record = state.unstaking.get("tx_unstake_001")!;
    record.next_unstake_date = new Date("2024-01-10T00:00:00.000Z");
    state.unstaking.set(record);

    const results = generateTokenUnstaking(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results.length).toBe(1);

    const { action } = results[0];
    expect(action.name).toBe("token_unstaking");
    expect(action.trxId).toBe(`sl_token_unstaking_${FIXTURE_BLOCK_NUM}`);
    expect(action.players).toEqual(["alice"]);
    expect(action.params).toEqual({
      token: "SPS",
      qty: 25,
      unstake_tx: "tx_unstake_001",
    });
    expect(action.opIndex).toBe(0);
    expect(action.actionIndex).toBe(0);
  });
});
