import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listCheckpoints, loadCheckpoint, pruneCheckpoints, writeCheckpoint } from "./checkpoint.mjs";
import { StateStore } from "./index.mjs";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function populated(): StateStore {
  const s = new StateStore();
  s.balances.set("alice", "SPS", 123456n);
  s.balances.set("$TOKEN_STAKING", "SPSP", -999n);
  s.hiveAccounts.add("alice");
  s.hiveAccounts.setAuthority("alice", { delegation: ["bob"] });
  s.votes.set("alice", "val1", 5000n);
  s.validators.set({ account_name: "val1", reward_account: null, is_active: true, post_url: null, total_votes: 5000n, missed_blocks: 2, api_url: null, last_version: "1.5.1", consecutive_missed_blocks: 1 });
  s.promises.addClosedPacked("delegation", "p1", s.promises.pack("completed", "alice", ["bob"]));
  s.rentals.rememberId("r-old");
  s.blocks.set({ block_num: 10, block_id: "b10", prev_block_id: "b9", l2_block_id: "h10", block_time: new Date("2025-01-01T00:00:00Z"), validator: "val1", validation_tx: null });
  return s;
}

describe("checkpoints", () => {
  it("round-trips the whole store, including hashed sets, bigints and dates", () => {
    dir = mkdtempSync(join(tmpdir(), "cp-"));
    writeCheckpoint(dir, populated(), { block_num: 10, l2_block_id: "h10", block_id: "b10", verified: true });
    const { state, meta } = loadCheckpoint(dir, 10);
    expect(meta).toMatchObject({ block_num: 10, l2_block_id: "h10", verified: true });
    expect(state.balances.getScaled("alice", "SPS")).toBe(123456n);
    expect(state.balances.getScaled("$TOKEN_STAKING", "SPSP")).toBe(-999n);
    expect(state.hiveAccounts.has("alice")).toBe(true);
    expect(state.hiveAccounts.has("mallory")).toBe(false);
    expect(state.hiveAccounts.getAuthority("alice")).toEqual({ delegation: ["bob"] });
    expect(state.votes.sum("val1")).toBe(5000n);
    expect(state.validators.get("val1")?.consecutive_missed_blocks).toBe(1);
    expect(state.promises.getClosed("delegation", "p1")).toEqual({ status: "completed", lender: "alice", controllers: ["bob"] });
    expect(state.rentals.exists("r-old")).toBe(true);
    expect(state.blocks.get(10)?.block_time).toEqual(new Date("2025-01-01T00:00:00Z"));
    // restored instances keep working (prototype methods + mutable internals)
    state.hiveAccounts.add("carol");
    expect(state.hiveAccounts.has("carol")).toBe(true);
  });

  it("lists and prunes, keeping the newest and the round-number ones", () => {
    dir = mkdtempSync(join(tmpdir(), "cp-"));
    const s = new StateStore();
    for (const b of [1000, 2000, 3000, 4000, 5000]) writeCheckpoint(dir, s, { block_num: b, l2_block_id: "h", block_id: "b", verified: true });
    expect(listCheckpoints(dir)).toEqual([1000, 2000, 3000, 4000, 5000]);
    pruneCheckpoints(dir, 2, 2000);
    expect(listCheckpoints(dir)).toEqual([2000, 4000, 5000]);
  });
});
