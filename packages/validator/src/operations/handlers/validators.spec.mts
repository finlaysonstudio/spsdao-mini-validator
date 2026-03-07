import { describe, it, expect } from "vitest";
import {
  handleApproveValidator,
  handleUnapproveValidator,
  handleUpdateValidator,
} from "./validators.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleApproveValidator", () => {
  it("creates and activates a new validator", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "approve_validator" });
    const action = createParsedAction({
      name: "approve_validator",
      players: ["newvalidator"],
      params: { account_name: "newvalidator" },
    });

    const result = handleApproveValidator(action, ctx);

    expect(result.success).toBe(true);
    const validator = state.validators.get("newvalidator");
    expect(validator).toBeDefined();
    expect(validator!.is_active).toBe(true);
    expect(validator!.account_name).toBe("newvalidator");
  });

  it("activates an existing inactive validator", () => {
    const state = createStateStore();
    // Deactivate validator2 first
    const v = state.validators.get("validator2")!;
    v.is_active = false;
    state.validators.set(v);

    const ctx = createActionContext({ state, actionType: "approve_validator" });
    const action = createParsedAction({
      name: "approve_validator",
      players: ["validator2"],
      params: { account_name: "validator2" },
    });

    const result = handleApproveValidator(action, ctx);

    expect(result.success).toBe(true);
    expect(state.validators.get("validator2")!.is_active).toBe(true);
  });

  it("returns error 1 for missing account_name", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "approve_validator",
      players: ["alice"],
      params: {},
    });

    const result = handleApproveValidator(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });
});

describe("handleUnapproveValidator", () => {
  it("deactivates validator", () => {
    const state = createStateStore();
    const ctx = createActionContext({
      state,
      actionType: "unapprove_validator",
    });
    const action = createParsedAction({
      name: "unapprove_validator",
      players: ["validator1"],
      params: { account_name: "validator1" },
    });

    const result = handleUnapproveValidator(action, ctx);

    expect(result.success).toBe(true);
    expect(state.validators.get("validator1")!.is_active).toBe(false);
  });

  it("returns error 2 for validator not found", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "unapprove_validator",
      players: ["alice"],
      params: { account_name: "nonexistent" },
    });

    const result = handleUnapproveValidator(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});

describe("handleUpdateValidator", () => {
  it("updates post_url", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "update_validator" });
    const action = createParsedAction({
      name: "update_validator",
      players: ["validator1"],
      params: { account_name: "validator1", post_url: "https://new.url" },
    });

    const result = handleUpdateValidator(action, ctx);

    expect(result.success).toBe(true);
    expect(state.validators.get("validator1")!.post_url).toBe(
      "https://new.url",
    );
  });

  it("returns error 2 for validator not found", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "update_validator",
      players: ["alice"],
      params: { account_name: "nonexistent", post_url: "https://x.com" },
    });

    const result = handleUpdateValidator(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(2);
  });
});
