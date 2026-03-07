import { describe, it, expect } from "vitest";
import { handlePriceFeed } from "./priceFeed.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handlePriceFeed", () => {
  it("stores prices from active validator", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "price_feed" });
    const action = createParsedAction({
      name: "price_feed",
      players: ["validator1"],
      params: {
        updates: [
          { token: "SPS", price: 0.035 },
          { token: "DEC", price: 0.001 },
        ],
      },
    });

    const result = handlePriceFeed(action, ctx);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].object_type).toBe("price_history");
    expect(result.events[0].event_type).toBe("upsert");
    expect(result.events[0].data.token).toBe("SPS");
    expect(result.events[0].data.token_price).toBe(0.035);
    expect(result.events[1].data.token).toBe("DEC");
  });

  it("returns error 1 for not an active validator", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "price_feed",
      players: ["alice"],
      params: { updates: [{ token: "SPS", price: 0.03 }] },
    });

    const result = handlePriceFeed(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });

  it("returns error 1 for missing updates", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "price_feed",
      players: ["validator1"],
      params: {},
    });

    const result = handlePriceFeed(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });
});
