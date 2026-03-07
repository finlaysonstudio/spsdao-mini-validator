import { describe, it, expect } from "vitest";
import { CheckInStore } from "./checkIns.mjs";
import type { CheckIn } from "./checkIns.mjs";

function makeCheckIn(
  account: string,
  overrides: Partial<CheckIn> = {},
): CheckIn {
  return {
    account,
    block_num: 1000,
    hash: "abc123",
    status: "active",
    ...overrides,
  };
}

describe("CheckInStore", () => {
  it("get returns undefined for unknown", () => {
    const store = new CheckInStore();
    expect(store.get("unknown")).toBeUndefined();
  });

  it("set/get roundtrip", () => {
    const store = new CheckInStore();
    const ci = makeCheckIn("alice");
    store.set(ci);
    expect(store.get("alice")).toEqual(ci);
  });

  it("remove deletes", () => {
    const store = new CheckInStore();
    store.set(makeCheckIn("alice"));
    store.remove("alice");
    expect(store.get("alice")).toBeUndefined();
  });

  it("setInactive changes status to inactive", () => {
    const store = new CheckInStore();
    store.set(makeCheckIn("alice", { status: "active" }));
    store.setInactive("alice");
    expect(store.get("alice")!.status).toBe("inactive");
  });

  it("getExpired returns active check-ins older than interval+window blocks", () => {
    const store = new CheckInStore();
    store.set(makeCheckIn("alice", { block_num: 100, status: "active" }));
    store.set(makeCheckIn("bob", { block_num: 900, status: "active" }));

    // currentBlock=1000, interval=500, window=100 => maxAge=600
    // alice at 100: 1000 - 100 = 900 > 600 => expired
    // bob at 900: 1000 - 900 = 100 <= 600 => not expired
    const expired = store.getExpired(1000, 500, 100);
    expect(expired).toHaveLength(1);
    expect(expired[0].account).toBe("alice");
  });

  it("getExpired excludes inactive", () => {
    const store = new CheckInStore();
    store.set(makeCheckIn("alice", { block_num: 100, status: "inactive" }));
    store.set(makeCheckIn("bob", { block_num: 100, status: "active" }));

    const expired = store.getExpired(1000, 500, 100);
    expect(expired).toHaveLength(1);
    expect(expired[0].account).toBe("bob");
  });

  it("getAll returns all", () => {
    const store = new CheckInStore();
    store.set(makeCheckIn("alice"));
    store.set(makeCheckIn("bob", { status: "inactive" }));
    expect(store.getAll()).toHaveLength(2);
  });

  it("load populates with defaults", () => {
    const store = new CheckInStore();
    store.load([
      { account: "alice", block_num: 500, hash: "xyz" },
      { account: "bob" },
      {},
    ]);

    const alice = store.get("alice");
    expect(alice).toBeDefined();
    expect(alice!.block_num).toBe(500);
    expect(alice!.hash).toBe("xyz");
    expect(alice!.status).toBe("active");

    const bob = store.get("bob");
    expect(bob).toBeDefined();
    expect(bob!.block_num).toBe(0);
    expect(bob!.hash).toBe("");

    expect(store.getAll()).toHaveLength(2);
  });
});
