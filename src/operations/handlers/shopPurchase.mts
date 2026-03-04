import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import { subtractBalance, combineBalanceEvents } from "../balanceOps.mjs";

export function handleShopPurchase(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { qty, token } = action.params as {
    qty?: number;
    token?: string;
  };
  const player = action.players[0];

  if (!token || qty === undefined || qty <= 0) {
    return errorResult(1, "Invalid purchase params");
  }

  const amount = round3(qty);
  const sub = subtractBalance(ctx, player, token, amount);
  if (!sub) {
    return errorResult(3, "Insufficient balance");
  }

  return successResult(combineBalanceEvents([], sub));
}
