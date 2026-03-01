import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult, balanceEvent } from "../types.mjs";

export function handleStakeTokens(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { token, qty, to } = action.params as {
    token?: string;
    qty?: number;
    to?: string;
  };
  const from = action.players[0];

  if (!token || qty === undefined || qty <= 0) {
    return errorResult(1, "Invalid stake params");
  }

  const amount = round3(qty);
  const stakeToken = `${token}P`;
  const target = to ?? from;

  if (!ctx.state.balances.subtract(from, token, amount)) {
    return errorResult(3, "Insufficient balance");
  }

  ctx.state.balances.add(target, stakeToken, amount);

  return successResult([
    balanceEvent(from, token, -amount),
    balanceEvent(target, stakeToken, amount),
  ]);
}

export function handleStakeTokensMulti(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { token, qty, to } = action.params as {
    token?: string;
    qty?: number[];
    to?: string[];
  };
  const from = action.players[0];

  if (!token || !qty || !to || qty.length !== to.length) {
    return errorResult(1, "Invalid multi-stake params");
  }

  const stakeToken = `${token}P`;
  let totalAmount = 0;
  for (const q of qty) {
    totalAmount += round3(q);
  }

  if (!ctx.state.balances.subtract(from, token, totalAmount)) {
    return errorResult(3, "Insufficient balance");
  }

  const events = [balanceEvent(from, token, -totalAmount)];

  for (let i = 0; i < to.length; i++) {
    const amount = round3(qty[i]);
    ctx.state.balances.add(to[i], stakeToken, amount);
    events.push(balanceEvent(to[i], stakeToken, amount));
  }

  return successResult(events);
}
