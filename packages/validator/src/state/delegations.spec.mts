import { describe, it, expect } from "vitest";
import { DelegationStore } from "./delegations.mjs";

describe("DelegationStore", () => {
  it("get returns null for unknown delegation", () => {
    const store = new DelegationStore();
    expect(store.get("alice", "bob", "SPS")).toBeNull();
  });

  it("set/get roundtrip", () => {
    const store = new DelegationStore();
    const delegation = {
      delegator: "alice",
      delegatee: "bob",
      token: "SPS",
      amount: 100,
    };
    store.set(delegation);
    expect(store.get("alice", "bob", "SPS")).toEqual(delegation);
  });

  it("remove deletes delegation", () => {
    const store = new DelegationStore();
    store.set({
      delegator: "alice",
      delegatee: "bob",
      token: "SPS",
      amount: 100,
    });
    store.remove("alice", "bob", "SPS");
    expect(store.get("alice", "bob", "SPS")).toBeNull();
  });

  it("getByDelegator filters correctly", () => {
    const store = new DelegationStore();
    store.set({
      delegator: "alice",
      delegatee: "bob",
      token: "SPS",
      amount: 100,
    });
    store.set({
      delegator: "alice",
      delegatee: "charlie",
      token: "SPS",
      amount: 50,
    });
    store.set({
      delegator: "bob",
      delegatee: "charlie",
      token: "SPS",
      amount: 75,
    });

    const result = store.getByDelegator("alice");
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.delegator === "alice")).toBe(true);
  });

  it("getByDelegatee filters correctly", () => {
    const store = new DelegationStore();
    store.set({
      delegator: "alice",
      delegatee: "bob",
      token: "SPS",
      amount: 100,
    });
    store.set({
      delegator: "charlie",
      delegatee: "bob",
      token: "SPS",
      amount: 50,
    });
    store.set({
      delegator: "alice",
      delegatee: "charlie",
      token: "SPS",
      amount: 75,
    });

    const result = store.getByDelegatee("bob");
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.delegatee === "bob")).toBe(true);
  });

  it("getAll returns all", () => {
    const store = new DelegationStore();
    store.set({
      delegator: "alice",
      delegatee: "bob",
      token: "SPS",
      amount: 100,
    });
    store.set({
      delegator: "alice",
      delegatee: "charlie",
      token: "SPS",
      amount: 50,
    });

    expect(store.getAll()).toHaveLength(2);
  });

  it("load populates from entries with date parsing", () => {
    const store = new DelegationStore();
    store.load([
      {
        delegator: "alice",
        delegatee: "bob",
        token: "SPS",
        amount: 100,
        last_undelegation_date: "2025-01-15T00:00:00.000Z",
      },
      { delegator: "charlie", delegatee: "dave", token: "SPS" },
      { delegator: "missing" },
    ]);

    const d1 = store.get("alice", "bob", "SPS");
    expect(d1).not.toBeNull();
    expect(d1!.amount).toBe(100);
    expect(d1!.last_undelegation_date).toBeInstanceOf(Date);

    const d2 = store.get("charlie", "dave", "SPS");
    expect(d2).not.toBeNull();
    expect(d2!.amount).toBe(0);

    expect(store.getAll()).toHaveLength(2);
  });
});
