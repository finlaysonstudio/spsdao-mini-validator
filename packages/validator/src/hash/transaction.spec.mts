import { describe, it, expect } from "vitest";
import { buildTransactionEntity } from "./transaction.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult } from "../types.mjs";

function makeAction(overrides: Partial<ParsedAction> = {}): ParsedAction {
  return {
    name: "test_op",
    players: ["alice"],
    params: { foo: "bar" },
    trxId: "tx-123",
    opIndex: 0,
    actionIndex: 0,
    ...overrides,
  };
}

function makeResult(overrides: Partial<OperationResult> = {}): OperationResult {
  return {
    success: true,
    events: [],
    ...overrides,
  };
}

const blockNum = 100;
const index = 0;
const blockId = "block-id-abc";
const prevBlockId = "prev-block-id-xyz";
const blockTime = new Date("2024-01-15T10:30:00.000Z");

describe("buildTransactionEntity", () => {
  it("returns TransactionEntity with correct field values", () => {
    const action = makeAction();
    const result = makeResult();
    const entity = buildTransactionEntity(
      action,
      result,
      blockNum,
      index,
      blockId,
      prevBlockId,
      blockTime,
    );

    expect(entity.id).toBe("tx-123");
    expect(entity.created_date).toBe(blockTime);
    expect(entity.block_num).toBe(100);
    expect(entity.index).toBe(0);
    expect(entity.block_id).toBe("block-id-abc");
    expect(entity.prev_block_id).toBe("prev-block-id-xyz");
    expect(entity.type).toBe("test_op");
    expect(entity.player).toBe("alice");
    expect(entity.data).toBe(JSON.stringify({ foo: "bar" }));
    expect(entity.success).toBe(true);
    expect(entity.error).toBeNull();
    expect(entity.result).toBeNull();
  });

  it("CRITICAL: field order invariant - Object.keys() must be exactly: id, created_date, block_num, index, block_id, prev_block_id, type, player, data, success, error, result", () => {
    const entity = buildTransactionEntity(
      makeAction(),
      makeResult(),
      blockNum,
      index,
      blockId,
      prevBlockId,
      blockTime,
    );
    const keys = Object.keys(entity);
    expect(keys).toEqual([
      "id",
      "created_date",
      "block_num",
      "index",
      "block_id",
      "prev_block_id",
      "type",
      "player",
      "data",
      "success",
      "error",
      "result",
    ]);
  });

  it("serializes error as JSON.stringify(error.code) when error present", () => {
    const result = makeResult({
      success: false,
      error: { code: 42, message: "something went wrong" },
    });
    const entity = buildTransactionEntity(
      makeAction(),
      result,
      blockNum,
      index,
      blockId,
      prevBlockId,
      blockTime,
    );
    expect(entity.error).toBe(JSON.stringify(42));
    expect(entity.error).toBe("42");
  });

  it("error is null when no error", () => {
    const entity = buildTransactionEntity(
      makeAction(),
      makeResult(),
      blockNum,
      index,
      blockId,
      prevBlockId,
      blockTime,
    );
    expect(entity.error).toBeNull();
  });

  it("serializes result as JSON.stringify({events: [...]}) when events present", () => {
    const events = [
      { object_type: "balance", event_type: "transfer", data: { amount: 10 } },
    ];
    const result = makeResult({ events });
    const entity = buildTransactionEntity(
      makeAction(),
      result,
      blockNum,
      index,
      blockId,
      prevBlockId,
      blockTime,
    );
    expect(entity.result).toBe(JSON.stringify({ events }));
  });

  it("result is null when no events", () => {
    const entity = buildTransactionEntity(
      makeAction(),
      makeResult({ events: [] }),
      blockNum,
      index,
      blockId,
      prevBlockId,
      blockTime,
    );
    expect(entity.result).toBeNull();
  });

  it("data is always JSON.stringify(action.params)", () => {
    const params = { token: "SPS", qty: 100.5, nested: { a: 1 } };
    const entity = buildTransactionEntity(
      makeAction({ params }),
      makeResult(),
      blockNum,
      index,
      blockId,
      prevBlockId,
      blockTime,
    );
    expect(entity.data).toBe(JSON.stringify(params));
  });

  it("player is first element of action.players", () => {
    const entity = buildTransactionEntity(
      makeAction({ players: ["bob", "charlie"] }),
      makeResult(),
      blockNum,
      index,
      blockId,
      prevBlockId,
      blockTime,
    );
    expect(entity.player).toBe("bob");
  });

  it("player is empty string when players array is empty", () => {
    const entity = buildTransactionEntity(
      makeAction({ players: [] }),
      makeResult(),
      blockNum,
      index,
      blockId,
      prevBlockId,
      blockTime,
    );
    expect(entity.player).toBe("");
  });
});
