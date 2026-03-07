import { describe, it, expect } from "vitest";
import { round3, BalanceStore } from "./balances.mjs";

describe("round3", () => {
  it("rounds to 3 decimal places", () => {
    expect(round3(1.23456)).toBe(1.235);
  });

  it("handles exact values (1.5 -> 1.5)", () => {
    expect(round3(1.5)).toBe(1.5);
  });

  it("rounds 1.2345 -> 1.235 (Math.round)", () => {
    expect(round3(1.2345)).toBe(1.235);
  });

  it("handles 0", () => {
    expect(round3(0)).toBe(0);
  });

  it("handles negative values", () => {
    expect(round3(-1.2345)).toBe(-1.234);
  });
});

describe("BalanceStore", () => {
  it("get returns 0 for unknown player/token", () => {
    const store = new BalanceStore();
    expect(store.get("nobody", "SPS")).toBe(0);
  });

  it("set/get roundtrip", () => {
    const store = new BalanceStore();
    store.set("alice", "SPS", 100);
    expect(store.get("alice", "SPS")).toBe(100);
  });

  it("set applies round3", () => {
    const store = new BalanceStore();
    store.set("alice", "SPS", 1.23456);
    expect(store.get("alice", "SPS")).toBe(1.235);
  });

  it("add increases balance", () => {
    const store = new BalanceStore();
    store.set("alice", "SPS", 10);
    store.add("alice", "SPS", 5.5);
    expect(store.get("alice", "SPS")).toBe(15.5);
  });

  it("subtract decreases balance and returns true", () => {
    const store = new BalanceStore();
    store.set("alice", "SPS", 10);
    const result = store.subtract("alice", "SPS", 3);
    expect(result).toBe(true);
    expect(store.get("alice", "SPS")).toBe(7);
  });

  it("subtract returns false for insufficient balance", () => {
    const store = new BalanceStore();
    store.set("alice", "SPS", 5);
    const result = store.subtract("alice", "SPS", 10);
    expect(result).toBe(false);
  });

  it("subtract does not mutate on failure", () => {
    const store = new BalanceStore();
    store.set("alice", "SPS", 5);
    store.subtract("alice", "SPS", 10);
    expect(store.get("alice", "SPS")).toBe(5);
  });

  it("getAll returns all tokens for a player", () => {
    const store = new BalanceStore();
    store.set("alice", "SPS", 10);
    store.set("alice", "DEC", 20);
    store.set("bob", "SPS", 30);
    const all = store.getAll("alice");
    expect(all.size).toBe(2);
    expect(all.get("SPS")).toBe(10);
    expect(all.get("DEC")).toBe(20);
  });

  it("getHolders returns all holders of a token (only positive balances)", () => {
    const store = new BalanceStore();
    store.set("alice", "SPS", 10);
    store.set("bob", "SPS", 20);
    store.set("charlie", "SPS", 0);
    const holders = store.getHolders("SPS");
    expect(holders.size).toBe(2);
    expect(holders.get("alice")).toBe(10);
    expect(holders.get("bob")).toBe(20);
    expect(holders.has("charlie")).toBe(false);
  });

  it("totalSupply sums all holders", () => {
    const store = new BalanceStore();
    store.set("alice", "SPS", 10);
    store.set("bob", "SPS", 20.5);
    expect(store.totalSupply("SPS")).toBe(30.5);
  });

  it("load populates from entries array", () => {
    const store = new BalanceStore();
    store.load([
      { player: "alice", token: "SPS", balance: 100 },
      { player: "bob", token: "DEC", balance: 50.123 },
    ]);
    expect(store.get("alice", "SPS")).toBe(100);
    expect(store.get("bob", "DEC")).toBe(50.123);
  });
});
