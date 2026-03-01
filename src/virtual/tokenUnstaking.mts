import { round3 } from "../state/index.mjs";
import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult, EventLog } from "../types.mjs";

const UNSTAKE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

export function generateTokenUnstaking(
  state: StateStore,
  blockNum: number,
  blockTime: Date,
): { action: ParsedAction; result: OperationResult }[] {
  const ready = state.unstaking.getReady(blockTime);
  if (ready.length === 0) return [];

  const results: { action: ParsedAction; result: OperationResult }[] = [];

  for (const record of ready) {
    const amount = round3(Math.min(record.quantity, record.quantity_left));

    if (amount <= 0) {
      record.is_active = false;
      state.unstaking.set(record);
      continue;
    }

    // Credit liquid tokens
    state.balances.add(record.player, record.token, amount);
    record.quantity_left = round3(record.quantity_left - amount);

    if (record.quantity_left <= 0) {
      record.is_active = false;
    } else {
      record.next_unstake_date = new Date(
        blockTime.getTime() + UNSTAKE_INTERVAL_MS,
      );
    }

    state.unstaking.set(record);

    const events: EventLog[] = [
      {
        type: "balance_update",
        data: { player: record.player, token: record.token, amount },
      },
    ];

    results.push({
      action: {
        name: "token_unstaking",
        players: [record.player],
        params: {
          token: record.token,
          qty: amount,
          unstake_tx: record.unstake_tx,
        },
        trxId: `sl_token_unstaking_${record.token}_${blockNum}`,
        opIndex: 0,
        actionIndex: results.length,
      },
      result: { success: true, events },
    });
  }

  return results;
}
