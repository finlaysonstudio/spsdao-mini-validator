import { describe, it, expect } from "vitest";
import { UnstakingStore } from "./unstaking.mjs";
import type { UnstakingRecord } from "./unstaking.mjs";

function makeRecord(
  unstake_tx: string,
  overrides: Partial<UnstakingRecord> = {},
): UnstakingRecord {
  return {
    player: "alice",
    unstake_tx,
    token: "SPS",
    quantity: 10,
    quantity_left: 10,
    total_qty: 100,
    next_unstake_date: new Date("2025-06-01"),
    is_active: true,
    ...overrides,
  };
}

describe("UnstakingStore", () => {
  it("get returns undefined for unknown tx", () => {
    const store = new UnstakingStore();
    expect(store.get("unknown")).toBeUndefined();
  });

  it("set/get roundtrip", () => {
    const store = new UnstakingStore();
    const record = makeRecord("tx1");
    store.set(record);
    expect(store.get("tx1")).toEqual(record);
  });

  it("remove deletes record", () => {
    const store = new UnstakingStore();
    store.set(makeRecord("tx1"));
    store.remove("tx1");
    expect(store.get("tx1")).toBeUndefined();
  });

  it("getByPlayer returns only active records for player", () => {
    const store = new UnstakingStore();
    store.set(makeRecord("tx1", { player: "alice", is_active: true }));
    store.set(makeRecord("tx2", { player: "alice", is_active: false }));
    store.set(makeRecord("tx3", { player: "bob", is_active: true }));

    const result = store.getByPlayer("alice");
    expect(result).toHaveLength(1);
    expect(result[0].unstake_tx).toBe("tx1");
  });

  it("getReady returns active records where next_unstake_date <= now", () => {
    const store = new UnstakingStore();
    const past = new Date("2025-01-01");
    const future = new Date("2099-01-01");
    const now = new Date("2025-06-01");

    store.set(makeRecord("tx1", { next_unstake_date: past, is_active: true }));
    store.set(
      makeRecord("tx2", { next_unstake_date: future, is_active: true }),
    );
    store.set(makeRecord("tx3", { next_unstake_date: now, is_active: true }));

    const ready = store.getReady(now);
    expect(ready).toHaveLength(2);
    expect(ready.map((r) => r.unstake_tx).sort()).toEqual(["tx1", "tx3"]);
  });

  it("getReady excludes inactive records", () => {
    const store = new UnstakingStore();
    const past = new Date("2025-01-01");
    const now = new Date("2025-06-01");

    store.set(makeRecord("tx1", { next_unstake_date: past, is_active: true }));
    store.set(makeRecord("tx2", { next_unstake_date: past, is_active: false }));

    const ready = store.getReady(now);
    expect(ready).toHaveLength(1);
    expect(ready[0].unstake_tx).toBe("tx1");
  });

  it("getAll returns all", () => {
    const store = new UnstakingStore();
    store.set(makeRecord("tx1"));
    store.set(makeRecord("tx2", { is_active: false }));
    expect(store.getAll()).toHaveLength(2);
  });

  it("load applies round3 and date parsing", () => {
    const store = new UnstakingStore();
    store.load([
      {
        player: "alice",
        unstake_tx: "tx1",
        token: "SPS",
        quantity: 1.2345,
        quantity_left: 2.5678,
        total_qty: 10.9999,
        next_unstake_date: "2025-06-01T00:00:00.000Z",
        is_active: true,
      },
    ]);

    const record = store.get("tx1");
    expect(record).toBeDefined();
    expect(record!.quantity).toBe(1.235);
    expect(record!.quantity_left).toBe(2.568);
    expect(record!.total_qty).toBe(11);
    expect(record!.next_unstake_date).toBeInstanceOf(Date);
  });
});
