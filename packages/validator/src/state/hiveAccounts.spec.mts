import { describe, it, expect } from "vitest";
import { HiveAccountStore } from "./hiveAccounts.mjs";

describe("HiveAccountStore", () => {
  it("has returns false for unknown", () => {
    const store = new HiveAccountStore();
    expect(store.has("unknown")).toBe(false);
  });

  it("add/has roundtrip", () => {
    const store = new HiveAccountStore();
    store.add("alice");
    expect(store.has("alice")).toBe(true);
  });

  it("getAll returns all accounts", () => {
    const store = new HiveAccountStore();
    store.add("alice");
    store.add("bob");
    store.add("charlie");

    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all).toContain("alice");
    expect(all).toContain("bob");
    expect(all).toContain("charlie");
  });

  it("load populates from array", () => {
    const store = new HiveAccountStore();
    store.load(["alice", "bob", "charlie"]);

    expect(store.has("alice")).toBe(true);
    expect(store.has("bob")).toBe(true);
    expect(store.has("charlie")).toBe(true);
    expect(store.getAll()).toHaveLength(3);
  });
});
