import { describe, expect, it } from "vitest";
import { byteCompare, pgCompare } from "./collate.mjs";

// Order produced by `ORDER BY` in the upstream Postgres image (glibc en_US.utf8).
const PG_ORDER = [
  "$SPS_STAKING_REWARDS", "$TOKEN_STAKING", "1abc", "a-b", "a.b", "ab", "abc", "Abc", "abc_1", "abc1",
  "abc-10-match-1", "abc-1-match-1", "null", "sl_cs", "sl-cs-lite", "_x", "x", "zed", "Zed",
];

describe("pgCompare", () => {
  it("matches Postgres en_US.utf8 ORDER BY", () => {
    const shuffled = [...PG_ORDER].reverse();
    expect(shuffled.sort(pgCompare)).toEqual(PG_ORDER);
  });

  it("ignores hyphens at the first level (the rental expiry bug)", () => {
    expect(pgCompare("abc-10-match-1", "abc-1-match-1")).toBeLessThan(0);
    expect(byteCompare("abc-10-match-1", "abc-1-match-1")).toBeGreaterThan(0);
  });

  it("orders system ($) accounts before players, as upstream balance queries see them", () => {
    const players = ["a001ex", "$TOKEN_STAKING", "zed", "$BURNED", "sl-cs-lite", "acc_1", "acc1"];
    expect(players.sort(pgCompare)).toEqual(["$BURNED", "$TOKEN_STAKING", "a001ex", "acc_1", "acc1", "sl-cs-lite", "zed"]);
  });

  // Validated against Postgres ORDER BY on all 341,802 balances.player values, 130,140 hive
  // account names containing punctuation, tokens and promise ext_ids (0 positions differ).
  // Known limit: glibc's level-4 "position" rule is approximated, so contrived strings with
  // several punctuation characters around "$" (e.g. "$_$a" vs "$$a") can differ.

  it("is zero only for identical strings", () => {
    expect(pgCompare("abc", "abc")).toBe(0);
    expect(pgCompare("abc", "Abc")).not.toBe(0);
  });
});
