import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diffStates } from "../state/compare.mjs";
import { StateStore } from "../state/index.mjs";
import { exportSeed, manifestPath, packU32, sha256File, unpackU32, writeSnapshot } from "./export.mjs";
import { loadSeed } from "./seed.mjs";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const date = (s: string): Date => new Date(s);

function populated(): StateStore {
  const s = new StateStore();
  s.balances.set("alice", "SPS", 123456n);
  s.balances.set("alice", "SPSP", 1n);
  s.balances.set("$TOKEN_STAKING", "SPSP", -999n);
  for (let i = 0; i < 70_000; i++) s.hiveAccounts.add(`user${i}`); // spans two hash64 chunks
  s.hiveAccounts.setAuthority("alice", { delegation: ["bob"] });
  s.votes.set("alice", "val1", 5000n);
  s.votes.set("bob", "val1", 7n);
  s.votes.set("bob", "val2", 9n);
  s.validators.set({ account_name: "val1", reward_account: null, is_active: true, post_url: null, total_votes: 5007n, missed_blocks: 2, api_url: null, last_version: "1.5.1", consecutive_missed_blocks: 1 });
  s.checkIns.set({ account: "alice", status: "active", last_check_in_block_num: 9, last_check_in: date("2025-01-01T00:00:00Z") });
  s.unstaking.set({
    player: "bob", unstake_tx: "tx1", unstake_start_date: date("2025-01-01T00:00:00Z"), is_active: true, token: "SPS",
    total_qty: 4000n, next_unstake_date: date("2025-01-08T00:00:00Z"), total_unstaked: 1000n, unstaking_periods: 4, unstaking_interval_seconds: 604800, cancel_tx: null,
  });
  s.config.set({ group_name: "validator", group_type: "object", name: "max_block_age", index: 0, value_type: "number", value: "100", last_updated_date: null, last_updated_tx: null });
  s.priceHistory.set({ validator: "val1", token: "SPS", block_num: 8, block_time: date("2025-01-01T00:00:00Z"), token_price: 12345678n });
  s.rewardDebts.set("SPS", "alice", 42n);
  s.delegations.set({ token: "SPSP", delegator: "alice", delegatee: "bob", amount: 5n, last_delegation_tx: "d1", last_delegation_date: date("2025-01-01T00:00:00Z"), last_undelegation_date: null, last_undelegation_tx: null });
  s.transferKeys.add("alice", "k1");
  s.promises.setLive({ ext_id: "p2", type: "delegation", status: "open", params: { lender: "alice" }, controllers: ["c"], fulfill_timeout_seconds: 60, fulfilled_by: null, fulfilled_at: null, fulfilled_expiration: null, created_date: date("2025-01-01T00:00:00Z"), updated_date: date("2025-01-01T00:00:00Z") });
  s.promises.close("delegation", "p1", "completed", "alice", ["bob"]);
  s.promises.close("delegation", "p3", "cancelled", undefined, ["bob", "carol"]);
  s.rentals.rememberId("r-old");
  s.rentals.insertActive({ id: "r-1", lender: "alice", borrower: "bob", token: "SPSP", qty: 3000n, expiration_block: 20, status: "active", created_date: date("2025-01-01T00:00:00Z"), updated_date: date("2025-01-01T00:00:00Z") } as never);
  s.rentals.insertActive({ id: "r-2", lender: "carol", borrower: "dave", token: "SPSP", qty: 1000n, expiration_block: 15, status: "active", created_date: date("2025-01-01T00:00:00Z"), updated_date: date("2025-01-01T00:00:00Z") } as never);
  s.rentals.deactivate("r-2"); // leaves no empty index entries behind
  s.blocks.set({ block_num: 10, block_id: "b10", prev_block_id: "b9", l2_block_id: "h10", block_time: date("2025-01-01T00:00:00Z"), validator: "val1", validation_tx: null });
  return s;
}

describe("seed export", () => {
  it("packs 32-bit words little-endian", () => {
    expect(unpackU32(packU32([0, 1, 0xffffffff, 0x80000000]))).toEqual([0, 1, 0xffffffff, 0x80000000]);
    expect(Buffer.from(packU32([1]), "base64")).toEqual(Buffer.from([1, 0, 0, 0]));
  });

  it("reloads to a structurally identical state, including hashed sets", async () => {
    dir = mkdtempSync(join(tmpdir(), "seed-"));
    const original = populated();
    const path = join(dir, "seed-10.ndjson.gz");
    const manifest = await exportSeed(original, { block_num: 10, l2_block_id: "h10", block_id: "b10" }, path);

    const reloaded = new StateStore();
    const meta = await loadSeed(reloaded, path);
    expect(meta).toMatchObject({ block_num: 10, l2_block_id: "h10", block_id: "b10", format: 2 });
    expect(diffStates(original, reloaded)).toEqual([]);

    expect(reloaded.hiveAccounts.has("user69999")).toBe(true);
    expect(reloaded.hiveAccounts.has("mallory")).toBe(false);
    expect(reloaded.promises.getClosed("delegation", "p3")).toEqual({ status: "cancelled", lender: undefined, controllers: ["bob", "carol"] });
    expect(reloaded.rentals.exists("r-old")).toBe(true);
    expect(reloaded.rentals.expired(20).map((r) => r.id)).toEqual(["r-1"]);
    expect(reloaded.rentals.exists("r-2")).toBe(true);
    expect(reloaded.rentals.hasPair("carol", "dave", "SPSP")).toBe(false);
    // the reloaded store keeps working: new closed promises reuse the restored lookup tables
    reloaded.promises.close("delegation", "p4", "completed", "alice", ["bob"]);
    expect(reloaded.promises.closedTables()).toEqual(original.promises.closedTables());

    expect(manifest).toMatchObject({ format: 2, block_num: 10, l2_block_id: "h10", file: "seed-10.ndjson.gz", sha256: await sha256File(path) });
    expect(JSON.parse(readFileSync(manifestPath(path), "utf8"))).toEqual(manifest);
  });

  it("writes snapshots with latest.json and keeps the newest", async () => {
    dir = mkdtempSync(join(tmpdir(), "snap-"));
    const s = new StateStore();
    for (const b of [100, 200, 300]) await writeSnapshot(dir, s, { block_num: b, l2_block_id: `h${b}`, block_id: `b${b}` }, 2);
    expect(readdirSync(dir).sort()).toEqual([
      "latest.json",
      "seed-0000000200.manifest.json",
      "seed-0000000200.ndjson.gz",
      "seed-0000000300.manifest.json",
      "seed-0000000300.ndjson.gz",
    ]);
    expect(JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"))).toMatchObject({ block_num: 300, file: "seed-0000000300.ndjson.gz" });
  });

  it("detects a difference", () => {
    const a = populated();
    const b = populated();
    b.balances.set("alice", "SPS", 1n);
    b.hiveAccounts.add("mallory");
    expect(diffStates(a, b)).toEqual(["balances.map", "hiveAccounts.names"]);
  });
});
