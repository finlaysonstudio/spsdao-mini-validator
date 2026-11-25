import { describe, expect, it } from "vitest";
import { Services } from "../services.mjs";
import { StateStore } from "../state/index.mjs";
import { fakeAction } from "../__tests__/fixture.mjs";
import { fixVoteWeight } from "../actions/transitions.mjs";
import { TRANSITION_POINTS } from "./transitions.mjs";

const ADJUST = TRANSITION_POINTS.adjust_token_distribution_strategy;

function services(): Services {
  const state = new StateStore();
  state.validators.set({ account_name: "val1", reward_account: null, is_active: true, post_url: null, total_votes: 0n, missed_blocks: 0, api_url: null, last_version: null, consecutive_missed_blocks: 0 });
  return new Services(state, { custom_json_id: "sm_sps", custom_json_prefix: "sm_" });
}

describe("validator entry versions", () => {
  it("omits consecutive_missed_blocks before adjust_token_distribution_strategy (v1)", () => {
    const svc = services();
    const [ev] = svc.validators.updateVersion("val1", "1.0.0", fakeAction(ADJUST - 1));
    expect(ev.data).not.toHaveProperty("consecutive_missed_blocks");
    expect(svc.validators.lookup("val1", ADJUST - 1)).not.toHaveProperty("consecutive_missed_blocks");
  });

  it("includes it from the transition block on (v2)", () => {
    const svc = services();
    const [ev] = svc.validators.updateVersion("val1", "1.3.0", fakeAction(ADJUST));
    expect(Object.keys(ev.data as object)).toEqual(["account_name", "reward_account", "is_active", "post_url", "total_votes", "missed_blocks", "api_url", "last_version", "consecutive_missed_blocks"]);
  });

  it("only counts consecutive missed blocks in v2", () => {
    const svc = services();
    svc.validators.incrementMissedBlocks("val1", 3, fakeAction(ADJUST - 1));
    expect(svc.state.validators.get("val1")?.consecutive_missed_blocks).toBe(0);
    svc.validators.incrementMissedBlocks("val1", 3, fakeAction(ADJUST));
    expect(svc.state.validators.get("val1")?.consecutive_missed_blocks).toBe(3);
  });
});

describe("transition_fix_vote_weight", () => {
  it("resets vote weights that differ from the SPSP balance, voters in descending collation order", () => {
    const svc = services();
    const s = svc.state;
    s.balances.set("alice", "SPSP", 1000n);
    s.balances.set("bob", "SPSP", 2500n);
    s.balances.set("carol", "SPSP", 700n);
    s.votes.set("alice", "val1", 900n); // stale
    s.votes.set("bob", "val1", 2500n); // correct
    s.votes.set("carol", "val1", 1n); // stale
    s.votes.set("dave", "val1", 5n); // no SPSP row -> not joined
    const events = fixVoteWeight(svc, fakeAction(TRANSITION_POINTS.fix_vote_weight));
    const voteUpdates = events.filter((e) => e.object_type === "validator_votes").map((e) => e.data);
    expect(voteUpdates).toEqual([
      { voter: "carol", validator: "val1", vote_weight: "0.700" },
      { voter: "alice", validator: "val1", vote_weight: "1.000" },
    ]);
    expect(s.votes.sum("val1")).toBe(1000n + 2500n + 700n + 5n);
  });
});

describe("config upsert", () => {
  it("inserts a missing row with index 0 and null last_updated fields, then reloads", () => {
    const svc = services();
    const ev = svc.config.reloadingUpsertConfig("validator", "object", "consecutive_missed_blocks_threshold", 5);
    expect(ev.event_type).toBe("upsert");
    expect(ev.data).toEqual({ group_name: "validator", group_type: "object", name: "consecutive_missed_blocks_threshold", index: 0, value_type: "number", value: "5", last_updated_date: null, last_updated_tx: null });
    expect(svc.config.value.validator.consecutive_missed_blocks_threshold).toBe(5);
    // a group missing the required validator settings fails the asserter, as upstream
    expect(svc.config.validator).toBeUndefined();
  });
});
