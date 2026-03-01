import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult, balanceEvent } from "../types.mjs";

export function handleTokenTransfer(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { to, qty, token } = action.params as {
    to?: string;
    qty?: number;
    token?: string;
  };
  const from = action.players[0];

  if (!to || !token || qty === undefined || qty <= 0) {
    return errorResult(1, "Invalid transfer params");
  }

  if (from === to) {
    return errorResult(2, "Cannot transfer to self");
  }

  const amount = round3(qty);
  if (!ctx.state.balances.subtract(from, token, amount)) {
    return errorResult(3, "Insufficient balance");
  }

  ctx.state.balances.add(to, token, amount);

  return successResult([
    balanceEvent(from, token, -amount),
    balanceEvent(to, token, amount),
  ]);
}

export function handleTokenTransferMulti(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { to, qty, token } = action.params as {
    to?: string[];
    qty?: number[];
    token?: string;
  };
  const from = action.players[0];

  if (!to || !qty || !token || to.length !== qty.length) {
    return errorResult(1, "Invalid multi-transfer params");
  }

  const events = [];
  let totalAmount = 0;

  for (const q of qty) {
    totalAmount += round3(q);
  }

  const balance = ctx.state.balances.get(from, token);
  if (round3(balance) < round3(totalAmount)) {
    return errorResult(3, "Insufficient balance");
  }

  ctx.state.balances.subtract(from, token, totalAmount);
  events.push(balanceEvent(from, token, -totalAmount));

  for (let i = 0; i < to.length; i++) {
    const amount = round3(qty[i]);
    ctx.state.balances.add(to[i], token, amount);
    events.push(balanceEvent(to[i], token, amount));
  }

  return successResult(events);
}
