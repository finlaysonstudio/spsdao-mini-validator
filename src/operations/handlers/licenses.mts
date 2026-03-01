import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult, balanceEvent } from "../types.mjs";

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

  ctx.state.balances.subtract(player, "LICENSE", amount);
  ctx.state.balances.add(player, "ACTIVATED_LICENSE", amount);

  return successResult([
    balanceEvent(player, "LICENSE", -amount),
    balanceEvent(player, "ACTIVATED_LICENSE", amount),
  ]);
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

  ctx.state.balances.subtract(player, "ACTIVATED_LICENSE", amount);
  ctx.state.balances.add(player, "LICENSE", amount);

  return successResult([
    balanceEvent(player, "ACTIVATED_LICENSE", -amount),
    balanceEvent(player, "LICENSE", amount),
  ]);
}
