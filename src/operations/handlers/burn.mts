import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult, balanceEvent } from "../types.mjs";

export function handleBurn(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { qty, token } = action.params as {
    qty?: number;
    token?: string;
  };
  const player = action.players[0];

  if (!token || qty === undefined || qty <= 0) {
    return errorResult(1, "Invalid burn params");
  }

  const amount = round3(qty);
  if (!ctx.state.balances.subtract(player, token, amount)) {
    return errorResult(3, "Insufficient balance");
  }

  // Add to null account to track burns
  ctx.state.balances.add("$NULL", token, amount);

  return successResult([balanceEvent(player, token, -amount)]);
}
