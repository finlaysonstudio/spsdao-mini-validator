import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import { addBalance, combineBalanceEvents } from "../balanceOps.mjs";

export function handleTokenAward(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { to, qty, token } = action.params as {
    to?: string;
    qty?: number;
    token?: string;
  };

  if (!to || !token || qty === undefined || qty <= 0) {
    return errorResult(1, "Invalid award params");
  }

  const amount = round3(qty);
  const add = addBalance(ctx, to, token, amount);

  return successResult(combineBalanceEvents([], add));
}
