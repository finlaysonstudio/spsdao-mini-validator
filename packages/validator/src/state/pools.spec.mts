import { describe, it, expect } from "vitest";
import { PoolStore } from "./pools.mjs";
import type { Pool } from "./pools.mjs";

function makePool(name: string, overrides: Partial<Pool> = {}): Pool {
  return {
    name,
    token: "SPS",
    reward_token: "SPS",
    tokens_per_block: 1,
    start_block: 0,
    acc_tokens_per_share: 0,
    last_reward_block: 0,
    is_active: true,
    ...overrides,
  };
}

describe("PoolStore", () => {
  it("getPool returns undefined for unknown", () => {
    const store = new PoolStore();
    expect(store.getPool("unknown")).toBeUndefined();
  });

  it("setPool/getPool roundtrip", () => {
    const store = new PoolStore();
    const pool = makePool("staking");
    store.setPool(pool);
    expect(store.getPool("staking")).toEqual(pool);
  });

  it("getActivePools returns only active pools", () => {
    const store = new PoolStore();
    store.setPool(makePool("active1", { is_active: true }));
    store.setPool(makePool("inactive1", { is_active: false }));
    store.setPool(makePool("active2", { is_active: true }));

    const active = store.getActivePools();
    expect(active).toHaveLength(2);
    expect(active.every((p) => p.is_active)).toBe(true);
  });

  it("getAllPools returns all", () => {
    const store = new PoolStore();
    store.setPool(makePool("pool1"));
    store.setPool(makePool("pool2", { is_active: false }));
    expect(store.getAllPools()).toHaveLength(2);
  });

  it("getRewardDebt returns 0 for unknown", () => {
    const store = new PoolStore();
    expect(store.getRewardDebt("alice", "staking")).toBe(0);
  });

  it("setRewardDebt/getRewardDebt roundtrip", () => {
    const store = new PoolStore();
    store.setRewardDebt("alice", "staking", 123.456);
    expect(store.getRewardDebt("alice", "staking")).toBe(123.456);
  });

  it("setRewardDebt applies round3", () => {
    const store = new PoolStore();
    store.setRewardDebt("alice", "staking", 1.2345);
    expect(store.getRewardDebt("alice", "staking")).toBe(1.235);
  });

  it("getAllRewardDebts returns all debts", () => {
    const store = new PoolStore();
    store.setRewardDebt("alice", "pool1", 10);
    store.setRewardDebt("bob", "pool1", 20);
    store.setRewardDebt("alice", "pool2", 30);

    const debts = store.getAllRewardDebts();
    expect(debts).toHaveLength(3);
  });

  it("load populates pools and reward debts", () => {
    const store = new PoolStore();
    store.load(
      [{ name: "staking", token: "SPS", is_active: true }, { name: "lp" }],
      [{ player: "alice", pool_name: "staking", reward_debt: 50.1234 }],
    );

    expect(store.getPool("staking")).toBeDefined();
    expect(store.getPool("staking")!.token).toBe("SPS");
    expect(store.getPool("lp")).toBeDefined();
    expect(store.getPool("lp")!.token).toBe("");
    expect(store.getRewardDebt("alice", "staking")).toBe(50.123);
  });
});
