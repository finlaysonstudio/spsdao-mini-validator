import { round3 } from "../state/index.mjs";
import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult, EventLog } from "../types.mjs";

export function generateClearBurned(
  state: StateStore,
  blockNum: number,
  _blockTime: Date,
): { action: ParsedAction; result: OperationResult }[] {
  const nullBalances = state.balances.getAll("$NULL");
  const results: { action: ParsedAction; result: OperationResult }[] = [];

  for (const [token, amount] of nullBalances) {
    if (amount <= 0) continue;

    state.balances.set("$NULL", token, 0);

    const events: EventLog[] = [
      {
        type: "burn",
        data: { token, amount: round3(amount) },
      },
    ];

    results.push({
      action: {
        name: "burn",
        players: ["$BURNED"],
        params: { token, qty: round3(amount) },
        trxId: `sl_clear_burned_tokens_${blockNum}`,
        opIndex: 0,
        actionIndex: results.length,
      },
      result: { success: true, events },
    });
  }

  return results;
}
