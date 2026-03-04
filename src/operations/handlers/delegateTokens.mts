import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "../balanceOps.mjs";

export function handleDelegateTokens(
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
    return errorResult(1, "Invalid delegate params");
  }

  if (from === to) {
    return errorResult(2, "Cannot delegate to self");
  }

  const amount = round3(qty);
  const stakeToken = `${token}P`;

  const sub = subtractBalance(ctx, from, stakeToken, amount);
  if (!sub) {
    return errorResult(3, "Insufficient staked balance");
  }

  // Track delegation via IN/OUT tokens
  const out = addBalance(ctx, from, `${stakeToken}-OUT`, amount);
  const inn = addBalance(ctx, to, `${stakeToken}-IN`, amount);

  // Update or create delegation record
  const existing = ctx.state.delegations.get(from, to, token);
  const newAmount = (existing?.amount ?? 0) + amount;

  ctx.state.delegations.set({
    delegator: from,
    delegatee: to,
    token,
    amount: round3(newAmount),
    last_delegation_tx: action.trxId,
  });

  return successResult(combineBalanceEvents([], sub, out, inn));
}

export function handleUndelegateTokens(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const {
    from: delegatee,
    qty,
    token,
  } = action.params as {
    from?: string;
    qty?: number;
    token?: string;
  };
  const delegator = action.players[0];

  if (!delegatee || !token || qty === undefined || qty <= 0) {
    return errorResult(1, "Invalid undelegate params");
  }

  const amount = round3(qty);
  const delegation = ctx.state.delegations.get(delegator, delegatee, token);
  if (!delegation || delegation.amount < amount) {
    return errorResult(2, "Insufficient delegation");
  }

  const stakeToken = `${token}P`;
  const out = subtractBalance(ctx, delegator, `${stakeToken}-OUT`, amount)!;
  const inn = subtractBalance(ctx, delegatee, `${stakeToken}-IN`, amount)!;

  delegation.amount = round3(delegation.amount - amount);
  delegation.last_undelegation_date = ctx.blockTime;

  if (delegation.amount <= 0) {
    ctx.state.delegations.remove(delegator, delegatee, token);
  } else {
    ctx.state.delegations.set(delegation);
  }

  // Staked tokens go back to delegator
  const add = addBalance(ctx, delegator, stakeToken, amount);

  return successResult(combineBalanceEvents([], out, inn, add));
}

export function handleUndelegateTokensMulti(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const {
    from: delegatees,
    qty,
    token,
  } = action.params as {
    from?: string[];
    qty?: number[];
    token?: string;
  };
  const delegator = action.players[0];

  if (!delegatees || !qty || !token || delegatees.length !== qty.length) {
    return errorResult(1, "Invalid multi-undelegate params");
  }

  const stakeToken = `${token}P`;
  const balResults = [];

  for (let i = 0; i < delegatees.length; i++) {
    const delegatee = delegatees[i];
    const amount = round3(qty[i]);

    const delegation = ctx.state.delegations.get(delegator, delegatee, token);
    if (!delegation || delegation.amount < amount) continue;

    const out = subtractBalance(ctx, delegator, `${stakeToken}-OUT`, amount)!;
    const inn = subtractBalance(ctx, delegatee, `${stakeToken}-IN`, amount)!;

    delegation.amount = round3(delegation.amount - amount);
    delegation.last_undelegation_date = ctx.blockTime;

    if (delegation.amount <= 0) {
      ctx.state.delegations.remove(delegator, delegatee, token);
    } else {
      ctx.state.delegations.set(delegation);
    }

    const add = addBalance(ctx, delegator, stakeToken, amount);

    balResults.push(out, inn, add);
  }

  return successResult(combineBalanceEvents([], ...balResults));
}

export function handleReturnTokens(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { to, qty, token } = action.params as {
    to?: string;
    qty?: number;
    token?: string;
  };
  const delegatee = action.players[0];

  if (!to || !token || qty === undefined || qty <= 0) {
    return errorResult(1, "Invalid return params");
  }

  const amount = round3(qty);
  const delegation = ctx.state.delegations.get(to, delegatee, token);
  if (!delegation || delegation.amount < amount) {
    return errorResult(2, "Insufficient delegation to return");
  }

  const stakeToken = `${token}P`;
  const out = subtractBalance(ctx, to, `${stakeToken}-OUT`, amount)!;
  const inn = subtractBalance(ctx, delegatee, `${stakeToken}-IN`, amount)!;

  delegation.amount = round3(delegation.amount - amount);
  if (delegation.amount <= 0) {
    ctx.state.delegations.remove(to, delegatee, token);
  } else {
    ctx.state.delegations.set(delegation);
  }

  const add = addBalance(ctx, to, stakeToken, amount);

  return successResult(combineBalanceEvents([], out, inn, add));
}
