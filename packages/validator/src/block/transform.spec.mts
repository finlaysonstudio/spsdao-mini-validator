import { describe, expect, it } from "vitest";
import { transformBlock } from "./processor.mjs";
import type { HiveBlock } from "../hive/types.mjs";

const raw: HiveBlock = {
  block_id: "05c75916-canonical", previous: "05c75915-canonical", timestamp: "2025-06-20T15:36:51",
  transactions: [{ ref_block_num: 0, ref_block_prefix: 0, expiration: "", extensions: [], signatures: [], operations: [] }],
  transaction_ids: ["abc"],
};

describe("transformBlock (upstream bad-block transition points)", () => {
  it("drops transactions and pins the header at 96950550", () => {
    const b = transformBlock(96950550, raw);
    expect(b.transactions).toEqual([]);
    expect(b.transaction_ids).toEqual([]);
    expect(b.block_id).toBe("05c7591683e0102605a769a6935275a5e760353c");
    expect(b.previous).toBe("05c75915721349cfbd6c42ff962cf4d66ec2b05e");
    expect(b.timestamp).toBe("2025-06-20T15:36:51.000");
  });

  it.each([101201159, 101387262])("transforms %i", (n) => {
    expect(transformBlock(n, raw).transactions).toEqual([]);
  });

  it("leaves other blocks untouched", () => {
    expect(transformBlock(96950551, raw)).toBe(raw);
  });
});
