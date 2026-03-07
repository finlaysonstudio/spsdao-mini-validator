import { describe, it, expect } from "vitest";
import { PromiseStore } from "./promises.mjs";
import type { PromiseRecord } from "./promises.mjs";

function makePromise(
  id: string,
  overrides: Partial<PromiseRecord> = {},
): PromiseRecord {
  return {
    id,
    type: "transfer",
    controller: "alice",
    params: {},
    status: "open",
    created_block_num: 100,
    ...overrides,
  };
}

describe("PromiseStore", () => {
  it("get returns undefined for unknown", () => {
    const store = new PromiseStore();
    expect(store.get("unknown")).toBeUndefined();
  });

  it("set/get roundtrip", () => {
    const store = new PromiseStore();
    const promise = makePromise("p1");
    store.set(promise);
    expect(store.get("p1")).toEqual(promise);
  });

  it("remove deletes", () => {
    const store = new PromiseStore();
    store.set(makePromise("p1"));
    store.remove("p1");
    expect(store.get("p1")).toBeUndefined();
  });

  it("getOpen returns only open promises", () => {
    const store = new PromiseStore();
    store.set(makePromise("p1", { status: "open" }));
    store.set(makePromise("p2", { status: "fulfilled" }));
    store.set(makePromise("p3", { status: "open" }));
    store.set(makePromise("p4", { status: "cancelled" }));

    const open = store.getOpen();
    expect(open).toHaveLength(2);
    expect(open.map((p) => p.id).sort()).toEqual(["p1", "p3"]);
  });

  it("getExpired returns open promises past expiration", () => {
    const store = new PromiseStore();
    store.set(makePromise("p1", { status: "open", expiration_block_num: 50 }));
    store.set(makePromise("p2", { status: "open", expiration_block_num: 200 }));
    store.set(
      makePromise("p3", { status: "open", expiration_block_num: 100 }),
    );

    const expired = store.getExpired(100);
    expect(expired).toHaveLength(2);
    expect(expired.map((p) => p.id).sort()).toEqual(["p1", "p3"]);
  });

  it("getExpired excludes non-open and no-expiration", () => {
    const store = new PromiseStore();
    store.set(
      makePromise("p1", { status: "fulfilled", expiration_block_num: 50 }),
    );
    store.set(makePromise("p2", { status: "open" }));
    store.set(makePromise("p3", { status: "open", expiration_block_num: 50 }));

    const expired = store.getExpired(100);
    expect(expired).toHaveLength(1);
    expect(expired[0].id).toBe("p3");
  });

  it("getAll returns all", () => {
    const store = new PromiseStore();
    store.set(makePromise("p1"));
    store.set(makePromise("p2", { status: "fulfilled" }));
    expect(store.getAll()).toHaveLength(2);
  });

  it("load populates with defaults", () => {
    const store = new PromiseStore();
    store.load([
      { id: "p1", type: "transfer", controller: "alice" },
      { id: "p2" },
      {},
    ]);

    const p1 = store.get("p1");
    expect(p1).toBeDefined();
    expect(p1!.type).toBe("transfer");
    expect(p1!.status).toBe("open");

    const p2 = store.get("p2");
    expect(p2).toBeDefined();
    expect(p2!.type).toBe("");
    expect(p2!.controller).toBe("");
    expect(p2!.params).toEqual({});

    expect(store.getAll()).toHaveLength(2);
  });
});
