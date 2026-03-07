import { describe, it, expect } from "vitest";
import { handleShopPurchase } from "./shopPurchase.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleShopPurchase", () => {
  it("deducts tokens from player", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "shop_purchase" });
    const action = createParsedAction({
      name: "shop_purchase",
      players: ["alice"],
      params: { qty: 50, token: "SPS" },
    });

    const before = state.balances.get("alice", "SPS");
    const result = handleShopPurchase(action, ctx);

    expect(result.success).toBe(true);
    expect(state.balances.get("alice", "SPS")).toBe(before - 50);
  });

  it("returns error 1 for invalid params (missing token)", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "shop_purchase",
      players: ["alice"],
      params: { qty: 10 },
    });

    const result = handleShopPurchase(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 3 for insufficient balance", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "shop_purchase",
      players: ["alice"],
      params: { qty: 999999, token: "SPS" },
    });

    const result = handleShopPurchase(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(3);
  });
});
