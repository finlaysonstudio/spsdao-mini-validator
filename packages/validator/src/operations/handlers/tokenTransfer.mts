import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "../balanceOps.mjs";

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
  const sub = subtractBalance(ctx, from, token, amount, to);
  if (!sub) {
    return errorResult(3, "Insufficient balance");
  }

  const add = addBalance(ctx, to, token, amount, from);

  return successResult(combineBalanceEvents([], sub, add));
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

  let totalAmount = 0;
  for (const q of qty) {
    totalAmount += round3(q);
  }

  const balance = ctx.state.balances.get(from, token);
  if (round3(balance) < round3(totalAmount)) {
    return errorResult(3, "Insufficient balance");
  }

  const sub = subtractBalance(ctx, from, token, totalAmount);
  if (!sub) {
    return errorResult(3, "Insufficient balance");
  }

  const adds = to.map((recipient, i) =>
    addBalance(ctx, recipient, token, round3(qty[i])),
  );

  return successResult(combineBalanceEvents([], sub, ...adds));
}
