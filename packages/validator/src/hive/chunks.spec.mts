import { describe, expect, it } from "vitest";
import { chunkStart, compactBlock } from "./chunks.mjs";
import type { HiveBlock } from "./types.mjs";

const tx = (ops: { type: string; value: Record<string, unknown> }[]) => ({
  ref_block_num: 1, ref_block_prefix: 2, expiration: "e", extensions: [], signatures: ["sig"], operations: ops,
});

const block: HiveBlock = {
  block_id: "0595cd20aa", previous: "0595cd1faa", timestamp: "2025-02-27T17:53:54",
  transaction_ids: ["t0", "t1", "t2", "t3"],
  transactions: [
    tx([{ type: "vote_operation", value: {} }]),
    tx([{ type: "transfer_operation", value: {} }, { type: "custom_json_operation", value: { id: "sm_token_transfer", json: "{}" } }]),
    tx([{ type: "custom_json_operation", value: { id: "other_app", json: "{}" } }]),
    tx([{ type: "create_claimed_account_operation", value: { new_account_name: "newbie" } }]),
  ],
};

describe("compactBlock", () => {
  const c = compactBlock(block);

  it("keeps only transactions the processor reads, with their ids", () => {
    expect(c.transaction_ids).toEqual(["t1", "t3"]);
    expect(c.transactions).toHaveLength(2);
  });

  it("keeps op_index stable by replacing unrelated ops with placeholders", () => {
    expect(c.transactions[0].operations.map((o) => o.type)).toEqual(["x", "custom_json_operation"]);
    expect(c.transactions[0].operations[1].value.id).toBe("sm_token_transfer");
  });

  it("keeps the header fields the PRNG and hash use", () => {
    expect([c.block_id, c.previous, c.timestamp]).toEqual([block.block_id, block.previous, block.timestamp]);
  });
});

describe("chunkStart", () => {
  it("aligns to 1000-block chunks", () => {
    expect(chunkStart(93703456)).toBe(93703000);
    expect(chunkStart(93703000)).toBe(93703000);
  });
});
