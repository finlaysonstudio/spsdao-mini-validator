import { describe, it, expect } from "vitest";
import {
  handleCreatePromise,
  handleFulfillPromise,
  handleFulfillPromiseMulti,
  handleCompletePromise,
  handleCancelPromise,
  handleReversePromise,
} from "./promises.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleCreatePromise", () => {
  it("creates a new promise", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "create_promise" });
    const action = createParsedAction({
      name: "create_promise",
      players: ["alice"],
      params: {
        id: "new_promise",
        type: "escrow",
        params: { token: "SPS", qty: 20 },
      },
    });

    const result = handleCreatePromise(action, ctx);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data.id).toBe("new_promise");

    const promise = state.promises.get("new_promise");
    expect(promise).toBeDefined();
    expect(promise!.status).toBe("open");
    expect(promise!.controller).toBe("alice");
    expect(promise!.type).toBe("escrow");
  });

  it("returns error 2 for promise already exists", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "create_promise",
      players: ["alice"],
      params: { id: "promise_001", type: "escrow" },
    });

    const result = handleCreatePromise(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });

  it("returns error 1 for missing id or type", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "create_promise",
      players: ["alice"],
      params: {},
    });

    const result = handleCreatePromise(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });
});

describe("handleFulfillPromise", () => {
  it("fulfills an open promise with escrow", () => {
    const state = createStateStore();
    // promise_001 is open with params: { token: "SPS", qty: 10 }
    const ctx = createActionContext({ state, actionType: "fulfill_promise" });
    const action = createParsedAction({
      name: "fulfill_promise",
      players: ["bob"],
      params: { id: "promise_001" },
    });

    const bobBefore = state.balances.get("bob", "SPS");
    const result = handleFulfillPromise(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("bob", "SPS")).toBe(bobBefore - 10);

    const promise = state.promises.get("promise_001");
    expect(promise!.status).toBe("fulfilled");
    expect(promise!.fulfilled_by).toBe("bob");
  });

  it("returns error 2 for promise not open", () => {
    const state = createStateStore();
    // Manually mark promise as fulfilled
    const promise = state.promises.get("promise_001")!;
    promise.status = "fulfilled";
    state.promises.set(promise);

    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "fulfill_promise",
      players: ["bob"],
      params: { id: "promise_001" },
    });

    const result = handleFulfillPromise(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });

  it("returns error 3 for insufficient balance for fulfillment", () => {
    const state = createStateStore();
    // Create a promise that needs more than bob has
    state.promises.set({
      id: "expensive_promise",
      type: "escrow",
      controller: "alice",
      params: { token: "SPS", qty: 999999 },
      status: "open",
      created_block_num: 99000,
    });

    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "fulfill_promise",
      players: ["bob"],
      params: { id: "expensive_promise" },
    });

    const result = handleFulfillPromise(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});

describe("handleFulfillPromiseMulti", () => {
  it("fulfills multiple open promises", () => {
    const state = createStateStore();
    // Create a second open promise (without escrow)
    state.promises.set({
      id: "promise_002",
      type: "basic",
      controller: "alice",
      params: {},
      status: "open",
      created_block_num: 99000,
    });

    const ctx = createActionContext({
      state,
      actionType: "fulfill_promise_multi",
    });
    const action = createParsedAction({
      name: "fulfill_promise_multi",
      players: ["bob"],
      params: { ids: ["promise_001", "promise_002"] },
    });

    const result = handleFulfillPromiseMulti(action, ctx);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(state.promises.get("promise_001")!.status).toBe("fulfilled");
    expect(state.promises.get("promise_002")!.status).toBe("fulfilled");
  });

  it("returns error 1 for missing ids", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "fulfill_promise_multi",
      players: ["bob"],
      params: {},
    });

    const result = handleFulfillPromiseMulti(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });
});

describe("handleCompletePromise", () => {
  it("completes a fulfilled promise and credits controller", () => {
    const state = createStateStore();
    // Fulfill the promise first
    const promise = state.promises.get("promise_001")!;
    promise.status = "fulfilled";
    promise.fulfilled_by = "bob";
    state.promises.set(promise);

    const ctx = createActionContext({ state, actionType: "complete_promise" });
    const action = createParsedAction({
      name: "complete_promise",
      players: ["alice"],
      params: { id: "promise_001" },
    });

    const aliceBefore = state.balances.get("alice", "SPS");
    const result = handleCompletePromise(action, ctx);

    expect(result.success).toBe(true);
    expect(state.promises.get("promise_001")!.status).toBe("completed");
    // promise_001 has params: { token: "SPS", qty: 10 } — alice (controller) gets 10
    expect(state.balances.get("alice", "SPS")).toBe(aliceBefore + 10);
  });

  it("returns error 2 for promise not fulfilled", () => {
    const state = createStateStore();
    // promise_001 is still "open"
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "complete_promise",
      players: ["alice"],
      params: { id: "promise_001" },
    });

    const result = handleCompletePromise(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});

describe("handleCancelPromise", () => {
  it("cancels an open promise", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "cancel_promise" });
    const action = createParsedAction({
      name: "cancel_promise",
      players: ["alice"],
      params: { id: "promise_001" },
    });

    const result = handleCancelPromise(action, ctx);

    expect(result.success).toBe(true);
    expect(state.promises.get("promise_001")!.status).toBe("cancelled");
  });

  it("returns error 2 for promise not open", () => {
    const state = createStateStore();
    const promise = state.promises.get("promise_001")!;
    promise.status = "fulfilled";
    state.promises.set(promise);

    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "cancel_promise",
      players: ["alice"],
      params: { id: "promise_001" },
    });

    const result = handleCancelPromise(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});

describe("handleReversePromise", () => {
  it("reverses a fulfilled promise and refunds fulfiller", () => {
    const state = createStateStore();
    const promise = state.promises.get("promise_001")!;
    promise.status = "fulfilled";
    promise.fulfilled_by = "bob";
    state.promises.set(promise);

    const ctx = createActionContext({ state, actionType: "reverse_promise" });
    const action = createParsedAction({
      name: "reverse_promise",
      players: ["alice"],
      params: { id: "promise_001" },
    });

    const bobBefore = state.balances.get("bob", "SPS");
    const result = handleReversePromise(action, ctx);

    expect(result.success).toBe(true);
    expect(state.promises.get("promise_001")!.status).toBe("reversed");
    // promise_001 has params: { token: "SPS", qty: 10 } — bob (fulfiller) gets refund
    expect(state.balances.get("bob", "SPS")).toBe(bobBefore + 10);
  });

  it("returns error 2 for promise not fulfilled", () => {
    const state = createStateStore();
    // promise_001 is "open"
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "reverse_promise",
      players: ["alice"],
      params: { id: "promise_001" },
    });

    const result = handleReversePromise(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});
