import { describe, it, expect } from "vitest";
import { sha256 } from "js-sha256";
import { computeL2Hash } from "./index.mjs";

describe("computeL2Hash", () => {
  it("returns SHA256 of prevHash.[] for empty transactions", () => {
    const prevHash = "abc123";
    const result = computeL2Hash(prevHash, []);
    const expected = sha256(`${prevHash}.[]`);
    expect(result).toBe(expected);
  });

  it("is deterministic (same inputs = same output)", () => {
    const prevHash = "somehash";
    const transactions: never[] = [];
    const result1 = computeL2Hash(prevHash, transactions);
    const result2 = computeL2Hash(prevHash, transactions);
    expect(result1).toBe(result2);
  });

  it("different prevHash produces different hash", () => {
    const result1 = computeL2Hash("hash_a", []);
    const result2 = computeL2Hash("hash_b", []);
    expect(result1).not.toBe(result2);
  });

  it("includes transaction data in hash (non-empty array)", () => {
    const prevHash = "prev";
    const transactions = [
      {
        id: "tx1",
        created_date: new Date("2024-01-01T00:00:00.000Z"),
        block_num: 1,
        index: 0,
        block_id: "bid",
        prev_block_id: "pbid",
        type: "test_op",
        player: "alice",
        data: "{}",
        success: true,
        error: null,
        result: null,
      },
    ];
    const withTx = computeL2Hash(prevHash, transactions);
    const withoutTx = computeL2Hash(prevHash, []);
    expect(withTx).not.toBe(withoutTx);
  });

  it("matches manual SHA256 computation", () => {
    const prevHash = "deadbeef";
    const transactions = [
      {
        id: "t1",
        created_date: new Date("2024-06-15T12:00:00.000Z"),
        block_num: 100,
        index: 0,
        block_id: "block1",
        prev_block_id: "block0",
        type: "token_transfer",
        player: "bob",
        data: '{"to":"alice","qty":10}',
        success: true,
        error: null,
        result: null,
      },
    ];
    const payload = `${prevHash}.${JSON.stringify(transactions)}`;
    const expected = sha256(payload);
    const result = computeL2Hash(prevHash, transactions);
    expect(result).toBe(expected);
  });
});
