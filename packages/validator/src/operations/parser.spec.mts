import { describe, it, expect } from "vitest";
import { parseBlockActions } from "./parser.mjs";
import { makeCustomJsonTx } from "../__fixtures__/helpers.mjs";
import type { HiveTransaction } from "../hive/types.mjs";

describe("parseBlockActions", () => {
  it("returns empty array for empty transactions", () => {
    const result = parseBlockActions([], []);
    expect(result).toEqual([]);
  });

  it("parses prefix format (sm_token_transfer)", () => {
    const { tx, txId } = makeCustomJsonTx(
      "sm_token_transfer",
      { to: "bob", qty: 10, token: "SPS" },
      { required_auths: ["alice"] },
    );
    const result = parseBlockActions([tx], [txId]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("token_transfer");
    expect(result[0].params).toEqual({ to: "bob", qty: 10, token: "SPS" });
    expect(result[0].players).toEqual(["alice"]);
  });

  it("parses ID format (id=sps, json={action, params})", () => {
    const { tx, txId } = makeCustomJsonTx(
      "sps",
      { action: "token_transfer", params: { to: "bob", qty: 5, token: "SPS" } },
      { required_auths: ["alice"] },
    );
    const result = parseBlockActions([tx], [txId]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("token_transfer");
    expect(result[0].params).toEqual({ to: "bob", qty: 5, token: "SPS" });
  });

  it("parses ID format array (multiple actions in one tx)", () => {
    const { tx, txId } = makeCustomJsonTx(
      "sps",
      [
        { action: "token_transfer", params: { to: "bob", qty: 5, token: "SPS" } },
        { action: "burn", params: { qty: 3, token: "SPS" } },
      ],
      { required_auths: ["alice"] },
    );
    const result = parseBlockActions([tx], [txId]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("token_transfer");
    expect(result[0].actionIndex).toBe(0);
    expect(result[1].name).toBe("burn");
    expect(result[1].actionIndex).toBe(1);
  });

  it("ignores non-SPS custom_json (id=something_else)", () => {
    const { tx, txId } = makeCustomJsonTx(
      "something_else",
      { data: "irrelevant" },
      { required_auths: ["alice"] },
    );
    const result = parseBlockActions([tx], [txId]);
    expect(result).toEqual([]);
  });

  it("ignores non-custom_json operations", () => {
    const tx: HiveTransaction = {
      ref_block_num: 0,
      ref_block_prefix: 0,
      expiration: "2024-01-15T12:01:00",
      operations: [
        { type: "vote_operation", value: { voter: "alice", author: "bob" } },
      ],
      extensions: [],
      signatures: [],
    };
    const result = parseBlockActions([tx], ["trx-vote-001"]);
    expect(result).toEqual([]);
  });

  it("resolves posting auth for posting auth actions", () => {
    const { tx, txId } = makeCustomJsonTx(
      "sm_stake_tokens",
      { token: "SPS", qty: 10 },
      { required_posting_auths: ["alice"], required_auths: [] },
    );
    const result = parseBlockActions([tx], [txId]);
    expect(result).toHaveLength(1);
    expect(result[0].players).toEqual(["alice"]);
  });

  it("resolves active auth for non-posting auth actions", () => {
    const { tx, txId } = makeCustomJsonTx(
      "sm_token_transfer",
      { to: "bob", qty: 10, token: "SPS" },
      { required_auths: ["alice"], required_posting_auths: [] },
    );
    const result = parseBlockActions([tx], [txId]);
    expect(result).toHaveLength(1);
    expect(result[0].players).toEqual(["alice"]);
  });

  it("skips actions with no matching auth", () => {
    // token_transfer requires active auth, but only posting auth is provided
    const { tx, txId } = makeCustomJsonTx(
      "sm_token_transfer",
      { to: "bob", qty: 10, token: "SPS" },
      { required_posting_auths: ["alice"], required_auths: [] },
    );
    const result = parseBlockActions([tx], [txId]);
    expect(result).toEqual([]);
  });

  it("handles JSON parse error gracefully", () => {
    const tx: HiveTransaction = {
      ref_block_num: 0,
      ref_block_prefix: 0,
      expiration: "2024-01-15T12:01:00",
      operations: [
        {
          type: "custom_json_operation",
          value: {
            id: "sps",
            json: "NOT VALID JSON {{{",
            required_auths: ["alice"],
            required_posting_auths: [],
          },
        },
      ],
      extensions: [],
      signatures: [],
    };
    const result = parseBlockActions([tx], ["trx-bad-json"]);
    expect(result).toEqual([]);
  });

  it("sets correct trxId with opIndex and actionIndex", () => {
    // Multi-op transaction: second operation (opIndex=1) with array of 2 actions
    const tx: HiveTransaction = {
      ref_block_num: 0,
      ref_block_prefix: 0,
      expiration: "2024-01-15T12:01:00",
      operations: [
        { type: "vote_operation", value: {} },
        {
          type: "custom_json_operation",
          value: {
            id: "sps",
            json: JSON.stringify([
              { action: "token_transfer", params: { to: "bob", qty: 1, token: "SPS" } },
              { action: "burn", params: { qty: 2, token: "SPS" } },
            ]),
            required_auths: ["alice"],
            required_posting_auths: [],
          },
        },
      ],
      extensions: [],
      signatures: [],
    };
    const txId = "trx-multi-op";
    const result = parseBlockActions([tx], [txId]);
    expect(result).toHaveLength(2);
    // opIndex=1 so trxId gets "-1" suffix
    expect(result[0].trxId).toBe("trx-multi-op-1");
    // second action in array gets ".1" suffix
    expect(result[1].trxId).toBe("trx-multi-op-1.1");
  });
});
