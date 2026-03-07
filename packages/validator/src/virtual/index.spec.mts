import { describe, it, expect } from "vitest";
import { runVirtualOperations } from "./index.mjs";
import {
  createStateStore,
  FIXTURE_BLOCK_NUM,
  FIXTURE_BLOCK_TIME,
} from "../__fixtures__/helpers.mjs";

describe("runVirtualOperations", () => {
  it("returns results with source field from all virtual sources", () => {
    const state = createStateStore();
    // Set up conditions so at least some virtual ops fire:
    // - $NULL has 50 SPS -> clearBurned fires
    // - pool last_reward_block < blockNum -> poolClaims fires
    const results = runVirtualOperations(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty("source");
      expect(r).toHaveProperty("action");
      expect(r).toHaveProperty("result");
      expect(typeof r.source).toBe("string");
    }
  });

  it("executes sources in correct order", () => {
    const state = createStateStore();
    // Make unstaking ready too so we get more sources
    const record = state.unstaking.get("tx_unstake_001")!;
    record.next_unstake_date = new Date("2024-01-10T00:00:00.000Z");
    state.unstaking.set(record);

    const results = runVirtualOperations(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );

    const sources = results.map((r) => r.source);
    // Verify ordering: tokenUnstaking before poolClaims before clearBurned
    const expectedOrder = [
      "tokenUnstaking",
      "poolClaims",
      "clearBurned",
      "expirePromises",
      "expireCheckIns",
      "updateMissedBlocks",
      "transitions",
    ];

    // Each source that appears must appear in the expected order
    let lastIndex = -1;
    for (const src of sources) {
      const idx = expectedOrder.indexOf(src);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = idx;
    }

    // With our setup, at least tokenUnstaking, poolClaims, and clearBurned should fire
    expect(sources).toContain("tokenUnstaking");
    expect(sources).toContain("poolClaims");
    expect(sources).toContain("clearBurned");
  });

  it("returns empty when no virtual ops fire", () => {
    const state = createStateStore();
    // Deactivate all conditions:
    // - No ready unstaking (already future-dated in fixture)
    // - Deactivate pools
    const pool = state.pools.getPool("sps_staking")!;
    pool.is_active = false;
    state.pools.setPool(pool);
    // - Zero out $NULL balances
    state.balances.set("$NULL", "SPS", 0);
    // - Cancel/fulfill the open promise so it won't expire
    const promise = state.promises.get("promise_001")!;
    promise.status = "fulfilled";
    state.promises.set(promise);
    // - Remove check-ins so none can expire
    const checkIn = state.checkIns.get("validator1")!;
    checkIn.status = "inactive";
    state.checkIns.set(checkIn);
    // - No previous block for updateMissedBlocks at a high block number
    // - No transitions

    const results = runVirtualOperations(state, 999999, FIXTURE_BLOCK_TIME);
    expect(results).toEqual([]);
  });
});
