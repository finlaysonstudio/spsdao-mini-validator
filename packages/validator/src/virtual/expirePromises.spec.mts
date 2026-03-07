import { describe, it, expect } from "vitest";
import { generateExpirePromises } from "./expirePromises.mjs";
import {
  createStateStore,
  FIXTURE_BLOCK_TIME,
} from "../__fixtures__/helpers.mjs";

describe("generateExpirePromises", () => {
  it("returns empty when no expired promises", () => {
    const state = createStateStore();
    // Fixture promise has expiration_block_num=110000, so at block 100001 it's not expired
    const results = generateExpirePromises(state, 100001, FIXTURE_BLOCK_TIME);
    expect(results).toEqual([]);
  });

  it("cancels expired promises", () => {
    const state = createStateStore();
    // Set expiration to a block in the past
    const promise = state.promises.get("promise_001")!;
    expect(promise).toBeDefined();
    promise.expiration_block_num = 99000;
    state.promises.set(promise);

    const blockNum = 100001;
    const results = generateExpirePromises(state, blockNum, FIXTURE_BLOCK_TIME);

    expect(results.length).toBe(1);

    // Promise should be cancelled
    const updated = state.promises.get("promise_001")!;
    expect(updated.status).toBe("cancelled");
  });

  it("generates single action with all expired promise events", () => {
    const state = createStateStore();
    // Add a second open promise that is also expired
    state.promises.set({
      id: "promise_002",
      type: "escrow",
      controller: "bob",
      params: {},
      status: "open",
      created_block_num: 98000,
      expiration_block_num: 99500,
    });

    // Make the first promise also expired
    const promise = state.promises.get("promise_001")!;
    promise.expiration_block_num = 99000;
    state.promises.set(promise);

    const blockNum = 100001;
    const results = generateExpirePromises(state, blockNum, FIXTURE_BLOCK_TIME);

    // Should be a single action wrapping all expired promises
    expect(results.length).toBe(1);

    const { action, result } = results[0];
    expect(action.name).toBe("expire_promises");
    expect(action.players).toEqual(["$PROMISE_EXPIRATION"]);
    expect(action.trxId).toBe(`sl_expire_promises_${blockNum}`);
    expect(action.params.count).toBe(2);
    expect(result.success).toBe(true);
    expect(result.events.length).toBe(2); // One event per expired promise
    expect(result.events[0].object_type).toBe("promises");
    expect(result.events[0].event_type).toBe("update");
  });
});
