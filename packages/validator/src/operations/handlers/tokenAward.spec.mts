import { describe, it, expect } from "vitest";
import { handleTokenAward } from "./tokenAward.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleTokenAward", () => {
  it("valid award adds balance to recipient", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "token_award" });
    const action = createParsedAction({
      name: "token_award",
      players: ["alice"],
      params: { to: "bob", qty: 25, token: "SPS" },
    });

    const bobBefore = state.balances.get("bob", "SPS");
    const result = handleTokenAward(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("bob", "SPS")).toBe(bobBefore + 25);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("returns error 1 for invalid params (missing to)", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "token_award",
      players: ["alice"],
      params: { qty: 10, token: "SPS" },
    });

    const result = handleTokenAward(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 1 for zero qty", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "token_award",
      players: ["alice"],
      params: { to: "bob", qty: 0, token: "SPS" },
    });

    const result = handleTokenAward(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });
});
