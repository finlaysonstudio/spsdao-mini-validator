import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "../balanceOps.mjs";

const UNSTAKE_PERIODS = 4;
const UNSTAKE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

export function handleUnstakeTokens(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { token, qty } = action.params as {
    token?: string;
    qty?: number;
  };
  const player = action.players[0];

  if (!token || qty === undefined || qty <= 0) {
    return errorResult(1, "Invalid unstake params");
  }

  const amount = round3(qty);
  const stakeToken = `${token}P`;

  const sub = subtractBalance(ctx, player, stakeToken, amount);
  if (!sub) {
    return errorResult(3, "Insufficient staked balance");
  }

  const quantityPerPeriod = round3(amount / UNSTAKE_PERIODS);
  const nextUnstakeDate = new Date(
    ctx.blockTime.getTime() + UNSTAKE_INTERVAL_MS,
  );

  ctx.state.unstaking.set({
    player,
    unstake_tx: action.trxId,
    token,
    quantity: quantityPerPeriod,
    quantity_left: amount,
    total_qty: amount,
    next_unstake_date: nextUnstakeDate,
    is_active: true,
  });

  return successResult(combineBalanceEvents([], sub));
}

export function handleCancelUnstakeTokens(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { unstake_tx } = action.params as { unstake_tx?: string };
  const player = action.players[0];

  if (!unstake_tx) {
    return errorResult(1, "Missing unstake_tx");
  }

  const record = ctx.state.unstaking.get(unstake_tx);
  if (!record || record.player !== player || !record.is_active) {
    return errorResult(2, "Unstaking record not found");
  }

  const stakeToken = `${record.token}P`;
  const refundAmount = record.quantity_left;
  const add = addBalance(ctx, player, stakeToken, refundAmount);
  record.is_active = false;
  record.quantity_left = 0;
  ctx.state.unstaking.set(record);

  return successResult(combineBalanceEvents([], add));
}
