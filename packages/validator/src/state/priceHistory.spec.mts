import { describe, it, expect } from "vitest";
import { PriceHistoryStore } from "./priceHistory.mjs";

describe("PriceHistoryStore", () => {
  it("getLatest returns undefined when empty", () => {
    const store = new PriceHistoryStore();
    expect(store.getLatest("SPS")).toBeUndefined();
  });

  it("add/getLatest roundtrip", () => {
    const store = new PriceHistoryStore();
    const entry = {
      validator: "v1",
      token: "SPS",
      block_num: 100,
      block_time: new Date("2025-01-01"),
      token_price: 0.05,
    };
    store.add(entry);
    expect(store.getLatest("SPS")).toEqual(entry);
  });

  it("getLatest returns most recent entry for token", () => {
    const store = new PriceHistoryStore();
    store.add({
      validator: "v1",
      token: "SPS",
      block_num: 100,
      block_time: new Date("2025-01-01"),
      token_price: 0.05,
    });
    store.add({
      validator: "v2",
      token: "DEC",
      block_num: 200,
      block_time: new Date("2025-01-02"),
      token_price: 0.001,
    });
    store.add({
      validator: "v1",
      token: "SPS",
      block_num: 300,
      block_time: new Date("2025-01-03"),
      token_price: 0.06,
    });

    const latest = store.getLatest("SPS");
    expect(latest).toBeDefined();
    expect(latest!.token_price).toBe(0.06);
    expect(latest!.block_num).toBe(300);
  });

  it("getAll returns copy of all entries", () => {
    const store = new PriceHistoryStore();
    store.add({
      validator: "v1",
      token: "SPS",
      block_num: 100,
      block_time: new Date("2025-01-01"),
      token_price: 0.05,
    });
    store.add({
      validator: "v2",
      token: "DEC",
      block_num: 200,
      block_time: new Date("2025-01-02"),
      token_price: 0.001,
    });

    const all = store.getAll();
    expect(all).toHaveLength(2);

    // Verify it is a copy
    all.push({
      validator: "v3",
      token: "VOUCHER",
      block_num: 300,
      block_time: new Date(),
      token_price: 0,
    });
    expect(store.getAll()).toHaveLength(2);
  });

  it("load populates from entries with date parsing", () => {
    const store = new PriceHistoryStore();
    store.load([
      {
        validator: "v1",
        token: "SPS",
        block_num: 100,
        block_time: "2025-06-15T12:00:00.000Z",
        token_price: 0.05,
      },
      { validator: "v2", token: "DEC" },
      { token: "MISSING_VALIDATOR" },
    ]);

    const all = store.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].block_time).toBeInstanceOf(Date);
    expect(all[0].block_num).toBe(100);
    expect(all[1].block_num).toBe(0);
    expect(all[1].token_price).toBe(0);
  });
});
