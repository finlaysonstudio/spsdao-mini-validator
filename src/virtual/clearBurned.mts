import { round3 } from "../state/index.mjs";
import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult, EventLog } from "../types.mjs";

export function generateClearBurned(
  state: StateStore,
  blockNum: number,
  blockTime: Date,
): { action: ParsedAction; result: OperationResult }[] {
  const nullBalances = state.balances.getAll("$NULL");
  const results: { action: ParsedAction; result: OperationResult }[] = [];

  for (const [token, amount] of nullBalances) {
    if (amount <= 0) continue;

    const qty = round3(amount);
    const trxId = `sl_clear_burned_tokens_${blockNum}`;

    // Zero out the $NULL balance directly
    state.balances.set("$NULL", token, 0);

    const events: EventLog[] = [
      {
        object_type: "balances",
        event_type: "update",
        data: {
          player: "$NULL",
          token,
          balance: (0).toFixed(3),
        },
      },
      {
        object_type: "balance_history",
        event_type: "insert",
        data: {
          player: "$NULL",
          token,
          amount: String(round3(-qty)),
          balance_start: String(qty),
          balance_end: (0).toFixed(3),
          block_num: blockNum,
          trx_id: trxId,
          type: "burn",
          created_date: blockTime.toJSON(),
          counterparty: null,
        },
      },
    ];

    results.push({
      action: {
        name: "burn",
        players: ["$BURNED"],
        params: { token, qty },
        trxId,
        opIndex: 0,
        actionIndex: results.length,
      },
      result: { success: true, events },
    });
  }

  return results;
}
