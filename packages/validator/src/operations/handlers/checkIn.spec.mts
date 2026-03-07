import { describe, it, expect } from "vitest";
import { handleCheckInValidator } from "./checkIn.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleCheckInValidator", () => {
  it("stores check-in for valid validator", () => {
    const state = createStateStore();
    const ctx = createActionContext({
      state,
      actionType: "check_in_validator",
      blockNum: 100001,
    });
    const action = createParsedAction({
      name: "check_in_validator",
      players: ["validator1"],
      // Use block_num not in block store to skip hash verification
      params: { block_num: 99999, hash: "somehash" },
    });

    const result = handleCheckInValidator(action, ctx);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].object_type).toBe("check_ins");
    expect(result.events[0].data.account).toBe("validator1");
    expect(result.events[0].data.block_num).toBe(100001);

    const checkIn = state.checkIns.get("validator1");
    expect(checkIn).toBeDefined();
    expect(checkIn!.block_num).toBe(100001);
  });

  it("returns error 1 for missing params", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "check_in_validator",
      players: ["validator1"],
      params: {},
    });

    const result = handleCheckInValidator(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 2 for validator not found", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "check_in_validator",
      players: ["nonexistent"],
      params: { block_num: 100000, hash: "somehash" },
    });

    const result = handleCheckInValidator(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });

  it("returns error 3 for referenced block too old", () => {
    const state = createStateStore();
    const ctx = createActionContext({
      state,
      blockNum: 100001,
    });
    const action = createParsedAction({
      name: "check_in_validator",
      players: ["validator1"],
      // block_num is more than 300 blocks behind current
      params: { block_num: 99000, hash: "somehash" },
    });

    const result = handleCheckInValidator(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});
