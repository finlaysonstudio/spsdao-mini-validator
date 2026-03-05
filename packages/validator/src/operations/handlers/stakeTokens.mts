import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "../balanceOps.mjs";

export function handleStakeTokens(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult | null {
  const { token, qty, to } = action.params as {
    token?: string;
    qty?: number;
    to?: string;
  };
  const from = action.players[0];

  // Schema validation: missing required fields → drop action (no TransactionEntity)
  if (!token || qty === undefined || qty <= 0) {
    return null;
  }

  const amount = round3(qty);
  const stakeToken = `${token}P`;
  const target = to ?? from;

  const sub = subtractBalance(ctx, from, token, amount);
  if (!sub) {
    return errorResult(3, "Insufficient balance");
  }

  const add = addBalance(ctx, target, stakeToken, amount);

  return successResult(combineBalanceEvents([], sub, add));
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

  const sub = subtractBalance(ctx, from, token, totalAmount);
  if (!sub) {
    return errorResult(3, "Insufficient balance");
  }

  const adds = to.map((recipient, i) =>
    addBalance(ctx, recipient, stakeToken, round3(qty[i])),
  );

  return successResult(combineBalanceEvents([], sub, ...adds));
}
