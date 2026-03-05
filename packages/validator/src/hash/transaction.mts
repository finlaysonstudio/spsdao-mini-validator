import type { TransactionEntity, OperationResult } from "../types.mjs";
import type { ParsedAction } from "../operations/types.mjs";

/**
 * Build a TransactionEntity from an action and its result.
 *
 * CRITICAL: Field order must exactly match:
 * id, created_date, block_num, index, block_id, prev_block_id, type, player, data, success, error, result
 *
 * This is what gets JSON.stringify'd into the L2 hash.
 */
export function buildTransactionEntity(
  action: ParsedAction,
  result: OperationResult,
  blockNum: number,
  index: number,
  blockId: string,
  prevBlockId: string,
  blockTime: Date,
): TransactionEntity {
  // Error serialization: JSON.stringify(error.code) — just the numeric code
  const errorStr =
    result.error !== undefined ? JSON.stringify(result.error.code) : null;

  // Result serialization: JSON.stringify({ events: EventLog[] })
  // Wrap event logs in { events: ... }
  const resultStr =
    result.events.length > 0 ? JSON.stringify({ events: result.events }) : null;

  // Data serialization: always JSON.stringify(action.params)
  const dataStr = JSON.stringify(action.params);

  // CRITICAL: Object literal key order determines JSON.stringify output
  return {
    id: action.trxId,
    created_date: blockTime,
    block_num: blockNum,
    index,
    block_id: blockId,
    prev_block_id: prevBlockId,
    type: action.name,
    player: action.players[0] ?? "",
    data: dataStr,
    success: result.success,
    error: errorStr,
    result: resultStr,
  };
}
