import { describe, it, expect } from "vitest";
import {
  handleActivateLicense,
  handleDeactivateLicense,
} from "./licenses.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleActivateLicense", () => {
  it("converts LICENSE to ACTIVATED_LICENSE", () => {
    const state = createStateStore();
    state.balances.add("alice", "LICENSE", 5);
    const ctx = createActionContext({ state, actionType: "activate_license" });
    const action = createParsedAction({
      name: "activate_license",
      players: ["alice"],
      params: { qty: 2 },
    });

    const result = handleActivateLicense(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "LICENSE")).toBe(3);
    expect(state.balances.get("alice", "ACTIVATED_LICENSE")).toBe(2);
  });

  it("returns error 3 for insufficient LICENSE balance", () => {
    const state = createStateStore();
    // alice has no LICENSE balance
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "activate_license",
      players: ["alice"],
      params: { qty: 1 },
    });

    const result = handleActivateLicense(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});

describe("handleDeactivateLicense", () => {
  it("converts ACTIVATED_LICENSE to LICENSE", () => {
    const state = createStateStore();
    state.balances.add("alice", "ACTIVATED_LICENSE", 5);
    const ctx = createActionContext({
      state,
      actionType: "deactivate_license",
    });
    const action = createParsedAction({
      name: "deactivate_license",
      players: ["alice"],
      params: { qty: 3 },
    });

    const result = handleDeactivateLicense(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "ACTIVATED_LICENSE")).toBe(2);
    expect(state.balances.get("alice", "LICENSE")).toBe(3);
  });

  it("returns error 3 for insufficient ACTIVATED_LICENSE balance", () => {
    const state = createStateStore();
    // alice has no ACTIVATED_LICENSE balance
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "deactivate_license",
      players: ["alice"],
      params: { qty: 1 },
    });

    const result = handleDeactivateLicense(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});
