import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult, balanceEvent } from "../types.mjs";

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
  ctx.state.balances.add(to, token, amount);

  return successResult([balanceEvent(to, token, amount)]);
}
