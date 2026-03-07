import { describe, it, expect } from "vitest";
import { ValidatorStore } from "./validators.mjs";
import type { Validator } from "./validators.mjs";

function makeValidator(
  account_name: string,
  overrides: Partial<Validator> = {},
): Validator {
  return {
    account_name,
    is_active: true,
    post_url: null,
    api_url: null,
    total_votes: 100,
    missed_blocks: 0,
    reward_account: null,
    last_version: null,
    ...overrides,
  };
}

describe("ValidatorStore", () => {
  it("get returns undefined for unknown account", () => {
    const store = new ValidatorStore();
    expect(store.get("unknown")).toBeUndefined();
  });

  it("set/get roundtrip", () => {
    const store = new ValidatorStore();
    const v = makeValidator("alice");
    store.set(v);
    expect(store.get("alice")).toEqual(v);
  });

  it("getActive returns only active validators with total_votes > 0, sorted by votes desc then name asc", () => {
    const store = new ValidatorStore();
    store.set(makeValidator("charlie", { total_votes: 200 }));
    store.set(makeValidator("alice", { total_votes: 300 }));
    store.set(makeValidator("bob", { total_votes: 200 }));

    const active = store.getActive();
    expect(active.map((v) => v.account_name)).toEqual([
      "alice",
      "bob",
      "charlie",
    ]);
  });

  it("getActive excludes inactive validators", () => {
    const store = new ValidatorStore();
    store.set(makeValidator("alice", { total_votes: 100, is_active: true }));
    store.set(makeValidator("bob", { total_votes: 100, is_active: false }));

    const active = store.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].account_name).toBe("alice");
  });

  it("getActive excludes validators with 0 votes", () => {
    const store = new ValidatorStore();
    store.set(makeValidator("alice", { total_votes: 100 }));
    store.set(makeValidator("bob", { total_votes: 0 }));

    const active = store.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].account_name).toBe("alice");
  });

  it("selectValidator returns null when fewer than minValidators active", () => {
    const store = new ValidatorStore();
    store.set(makeValidator("alice", { total_votes: 100 }));

    const result = store.selectValidator("block1", "block0", 3);
    expect(result).toBeNull();
  });

  it("selectValidator returns a validator deterministically based on blockId+prevBlockId", () => {
    const store = new ValidatorStore();
    store.set(makeValidator("alice", { total_votes: 100 }));
    store.set(makeValidator("bob", { total_votes: 100 }));
    store.set(makeValidator("charlie", { total_votes: 100 }));

    const result1 = store.selectValidator("blockA", "blockB", 1);
    const result2 = store.selectValidator("blockA", "blockB", 1);
    expect(result1).not.toBeNull();
    expect(result1!.account_name).toBe(result2!.account_name);
  });

  it("selectValidator uses weighted selection (higher votes = more likely)", () => {
    const store = new ValidatorStore();
    store.set(makeValidator("alice", { total_votes: 1 }));
    store.set(makeValidator("bob", { total_votes: 999999 }));

    const counts: Record<string, number> = { alice: 0, bob: 0 };
    for (let i = 0; i < 100; i++) {
      const result = store.selectValidator(`block${i}`, `prev${i}`, 1);
      if (result) counts[result.account_name]++;
    }

    expect(counts.bob).toBeGreaterThan(counts.alice);
  });

  it("getAll returns all validators", () => {
    const store = new ValidatorStore();
    store.set(makeValidator("alice"));
    store.set(makeValidator("bob", { is_active: false, total_votes: 0 }));

    expect(store.getAll()).toHaveLength(2);
  });

  it("load populates from partial entries, applies defaults", () => {
    const store = new ValidatorStore();
    store.load([
      { account_name: "alice", total_votes: 500 },
      { account_name: "bob" },
      {},
    ]);

    const alice = store.get("alice");
    expect(alice).toBeDefined();
    expect(alice!.total_votes).toBe(500);
    expect(alice!.is_active).toBe(false);
    expect(alice!.post_url).toBeNull();

    const bob = store.get("bob");
    expect(bob).toBeDefined();
    expect(bob!.total_votes).toBe(0);
    expect(bob!.missed_blocks).toBe(0);

    expect(store.getAll()).toHaveLength(2);
  });
});
