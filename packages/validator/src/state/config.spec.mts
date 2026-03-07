import { describe, it, expect } from "vitest";
import { ConfigStore } from "./config.mjs";

describe("ConfigStore", () => {
  it("get returns undefined for unknown", () => {
    const store = new ConfigStore();
    expect(store.get("sps", "missing")).toBeUndefined();
  });

  it("set/get roundtrip", () => {
    const store = new ConfigStore();
    store.set("sps", "inflation_rate", "0.05");
    expect(store.get("sps", "inflation_rate")).toBe("0.05");
  });

  it("getString returns fallback when missing", () => {
    const store = new ConfigStore();
    expect(store.getString("sps", "missing", "default")).toBe("default");
  });

  it("getNumber returns parsed number", () => {
    const store = new ConfigStore();
    store.set("sps", "rate", "42.5");
    expect(store.getNumber("sps", "rate", 0)).toBe(42.5);
  });

  it("getNumber returns fallback for NaN", () => {
    const store = new ConfigStore();
    store.set("sps", "bad", "not-a-number");
    expect(store.getNumber("sps", "bad", 99)).toBe(99);
  });

  it("getAll returns all entries with group/name split", () => {
    const store = new ConfigStore();
    store.set("sps", "rate", "0.05");
    store.set("validator", "min_count", "3");

    const all = store.getAll();
    expect(all).toHaveLength(2);

    const spsEntry = all.find((e) => e.group_name === "sps");
    expect(spsEntry).toBeDefined();
    expect(spsEntry!.name).toBe("rate");
    expect(spsEntry!.value).toBe("0.05");

    const valEntry = all.find((e) => e.group_name === "validator");
    expect(valEntry).toBeDefined();
    expect(valEntry!.name).toBe("min_count");
  });

  it("load populates from entries", () => {
    const store = new ConfigStore();
    store.load([
      { group_name: "sps", name: "rate", value: "0.05" },
      { group_name: "validator", name: "min_count", value: "3" },
    ]);

    expect(store.get("sps", "rate")).toBe("0.05");
    expect(store.get("validator", "min_count")).toBe("3");
  });
});
