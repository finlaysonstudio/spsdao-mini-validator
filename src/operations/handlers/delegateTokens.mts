import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult, balanceEvent } from "../types.mjs";

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

  if (!ctx.state.balances.subtract(from, stakeToken, amount)) {
    return errorResult(3, "Insufficient staked balance");
  }

  // Track delegation via IN/OUT tokens
  ctx.state.balances.add(from, `${stakeToken}-OUT`, amount);
  ctx.state.balances.add(to, `${stakeToken}-IN`, amount);

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

  return successResult([
    balanceEvent(from, stakeToken, -amount),
    balanceEvent(from, `${stakeToken}-OUT`, amount),
    balanceEvent(to, `${stakeToken}-IN`, amount),
  ]);
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
  ctx.state.balances.subtract(delegator, `${stakeToken}-OUT`, amount);
  ctx.state.balances.subtract(delegatee, `${stakeToken}-IN`, amount);

  delegation.amount = round3(delegation.amount - amount);
  delegation.last_undelegation_date = ctx.blockTime;

  if (delegation.amount <= 0) {
    ctx.state.delegations.remove(delegator, delegatee, token);
  } else {
    ctx.state.delegations.set(delegation);
  }

  // Staked tokens go back to delegator
  ctx.state.balances.add(delegator, stakeToken, amount);

  return successResult([
    balanceEvent(delegator, `${stakeToken}-OUT`, -amount),
    balanceEvent(delegatee, `${stakeToken}-IN`, -amount),
    balanceEvent(delegator, stakeToken, amount),
  ]);
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

  const events = [];
  const stakeToken = `${token}P`;

  for (let i = 0; i < delegatees.length; i++) {
    const delegatee = delegatees[i];
    const amount = round3(qty[i]);

    const delegation = ctx.state.delegations.get(delegator, delegatee, token);
    if (!delegation || delegation.amount < amount) continue;

    ctx.state.balances.subtract(delegator, `${stakeToken}-OUT`, amount);
    ctx.state.balances.subtract(delegatee, `${stakeToken}-IN`, amount);

    delegation.amount = round3(delegation.amount - amount);
    delegation.last_undelegation_date = ctx.blockTime;

    if (delegation.amount <= 0) {
      ctx.state.delegations.remove(delegator, delegatee, token);
    } else {
      ctx.state.delegations.set(delegation);
    }

    ctx.state.balances.add(delegator, stakeToken, amount);

    events.push(
      balanceEvent(delegator, `${stakeToken}-OUT`, -amount),
      balanceEvent(delegatee, `${stakeToken}-IN`, -amount),
      balanceEvent(delegator, stakeToken, amount),
    );
  }

  return successResult(events);
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
  ctx.state.balances.subtract(to, `${stakeToken}-OUT`, amount);
  ctx.state.balances.subtract(delegatee, `${stakeToken}-IN`, amount);

  delegation.amount = round3(delegation.amount - amount);
  if (delegation.amount <= 0) {
    ctx.state.delegations.remove(to, delegatee, token);
  } else {
    ctx.state.delegations.set(delegation);
  }

  ctx.state.balances.add(to, stakeToken, amount);

  return successResult([
    balanceEvent(to, `${stakeToken}-OUT`, -amount),
    balanceEvent(delegatee, `${stakeToken}-IN`, -amount),
    balanceEvent(to, stakeToken, amount),
  ]);
}
