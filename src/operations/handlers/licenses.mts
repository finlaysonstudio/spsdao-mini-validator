import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "../balanceOps.mjs";

export function handleActivateLicense(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { qty } = action.params as { qty?: number };
  const player = action.players[0];
  const amount = qty ?? 1;

  if (amount <= 0) {
    return errorResult(1, "Invalid qty");
  }

  const licenseBalance = ctx.state.balances.get(player, "LICENSE");
  if (licenseBalance < amount) {
    return errorResult(3, "Insufficient LICENSE balance");
  }

  const sub = subtractBalance(ctx, player, "LICENSE", amount)!;
  const add = addBalance(ctx, player, "ACTIVATED_LICENSE", amount);

  return successResult(combineBalanceEvents([], sub, add));
}

export function handleDeactivateLicense(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { qty } = action.params as { qty?: number };
  const player = action.players[0];
  const amount = qty ?? 1;

  if (amount <= 0) {
    return errorResult(1, "Invalid qty");
  }

  const activatedBalance = ctx.state.balances.get(player, "ACTIVATED_LICENSE");
  if (activatedBalance < amount) {
    return errorResult(3, "Insufficient ACTIVATED_LICENSE balance");
  }

  const sub = subtractBalance(ctx, player, "ACTIVATED_LICENSE", amount)!;
  const add = addBalance(ctx, player, "LICENSE", amount);

  return successResult(combineBalanceEvents([], sub, add));
}
