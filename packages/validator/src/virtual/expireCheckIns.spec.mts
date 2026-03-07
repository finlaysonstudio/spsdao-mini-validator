import { describe, it, expect } from "vitest";
import { generateExpireCheckIns } from "./expireCheckIns.mjs";
import {
  createStateStore,
  FIXTURE_BLOCK_TIME,
} from "../__fixtures__/helpers.mjs";

describe("generateExpireCheckIns", () => {
  it("returns empty when no expired check-ins", () => {
    const state = createStateStore();
    // Fixture: validator1 checked in at block 99900, interval=28800, window=300
    // maxAge = 28800 + 300 = 29100
    // At block 100001: 100001 - 99900 = 101, which is < 29100
    const results = generateExpireCheckIns(
      state,
      100001,
      FIXTURE_BLOCK_TIME,
    );
    expect(results).toEqual([]);
  });

  it("deactivates validator on expired check-in", () => {
    const state = createStateStore();
    // Set check-in block_num far in the past so it's expired
    // maxAge = 28800 + 300 = 29100
    // Need currentBlock - block_num > 29100
    const checkIn = state.checkIns.get("validator1")!;
    checkIn.block_num = 50000; // 100001 - 50000 = 50001 > 29100
    state.checkIns.set(checkIn);

    const blockNum = 100001;
    const results = generateExpireCheckIns(
      state,
      blockNum,
      FIXTURE_BLOCK_TIME,
    );

    expect(results.length).toBe(1);

    // Validator should be deactivated
    const validator = state.validators.get("validator1")!;
    expect(validator.is_active).toBe(false);
  });

  it("converts RUNNING_LICENSE to ACTIVATED_LICENSE", () => {
    const state = createStateStore();
    // Give validator1 some RUNNING_LICENSE balance
    state.balances.set("validator1", "RUNNING_LICENSE", 1);

    // Expire the check-in
    const checkIn = state.checkIns.get("validator1")!;
    checkIn.block_num = 50000;
    state.checkIns.set(checkIn);

    const blockNum = 100001;
    generateExpireCheckIns(state, blockNum, FIXTURE_BLOCK_TIME);

    // RUNNING_LICENSE should be 0, ACTIVATED_LICENSE should be 1
    expect(state.balances.get("validator1", "RUNNING_LICENSE")).toBe(0);
    expect(state.balances.get("validator1", "ACTIVATED_LICENSE")).toBe(1);
  });

  it("sets check-in status to inactive", () => {
    const state = createStateStore();
    const checkIn = state.checkIns.get("validator1")!;
    checkIn.block_num = 50000;
    state.checkIns.set(checkIn);

    const blockNum = 100001;
    generateExpireCheckIns(state, blockNum, FIXTURE_BLOCK_TIME);

    const updated = state.checkIns.get("validator1")!;
    expect(updated.status).toBe("inactive");
  });
});
