import { round3 } from "../state/index.mjs";
import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult } from "../types.mjs";
import { addBalance, combineBalanceEvents } from "../operations/balanceOps.mjs";

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

    const trxId = `sl_token_unstaking_${blockNum}`;
    const balCtx = {
      state,
      blockTime,
      blockNum,
      trxId,
      actionType: "token_unstaking",
    };

    // Credit liquid tokens
    const add = addBalance(balCtx, record.player, record.token, amount);
    const events = combineBalanceEvents([], add);
    record.quantity_left = round3(record.quantity_left - amount);

    if (record.quantity_left <= 0) {
      record.is_active = false;
    } else {
      record.next_unstake_date = new Date(
        blockTime.getTime() + UNSTAKE_INTERVAL_MS,
      );
    }

    state.unstaking.set(record);

    results.push({
      action: {
        name: "token_unstaking",
        players: [record.player],
        params: {
          token: record.token,
          qty: amount,
          unstake_tx: record.unstake_tx,
        },
        trxId,
        opIndex: 0,
        actionIndex: results.length,
      },
      result: { success: true, events },
    });
  }

  return results;
}
