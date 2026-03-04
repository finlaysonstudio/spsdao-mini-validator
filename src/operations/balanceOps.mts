import type { StateStore } from "../state/index.mjs";
import type { EventLog } from "../types.mjs";

export interface BalanceContext {
  state: StateStore;
  blockTime: Date;
  blockNum: number;
  trxId: string;
  actionType: string;
}

export interface BalanceResult {
  updates: EventLog[];
  history: EventLog[];
}

/**
 * Combine multiple BalanceResults into ordered EventLog[]:
 * all balances UPDATEs first, then all balance_history INSERTs.
 * Prepend any non-balance events before both groups.
 */
export function combineBalanceEvents(
  otherEvents: EventLog[],
  ...results: BalanceResult[]
): EventLog[] {
  return [
    ...otherEvents,
    ...results.flatMap((r) => r.updates),
    ...results.flatMap((r) => r.history),
  ];
}

/**
 * Add balance and produce upstream-compatible events (balances UPDATE + balance_history INSERT).
 */
export function addBalance(
  ctx: BalanceContext,
  player: string,
  token: string,
  amount: number,
  counterparty?: string | null,
): BalanceResult {
  const balanceStart = ctx.state.balances.get(player, token);
  ctx.state.balances.add(player, token, amount);
  const balanceEnd = ctx.state.balances.get(player, token);

  return balanceEventPair(
    ctx,
    player,
    token,
    amount,
    balanceStart,
    balanceEnd,
    counterparty,
  );
}

/**
 * Subtract balance and produce upstream-compatible events.
 * Returns null if insufficient balance (same as BalanceStore.subtract).
 */
export function subtractBalance(
  ctx: BalanceContext,
  player: string,
  token: string,
  amount: number,
  counterparty?: string | null,
): BalanceResult | null {
  const balanceStart = ctx.state.balances.get(player, token);
  if (!ctx.state.balances.subtract(player, token, amount)) {
    return null;
  }
  const balanceEnd = ctx.state.balances.get(player, token);

  return balanceEventPair(
    ctx,
    player,
    token,
    -amount,
    balanceStart,
    balanceEnd,
    counterparty,
  );
}

function balanceEventPair(
  ctx: BalanceContext,
  player: string,
  token: string,
  amount: number,
  balanceStart: number,
  balanceEnd: number,
  counterparty?: string | null,
): BalanceResult {
  return {
    updates: [
      {
        object_type: "balances",
        event_type: "update",
        data: {
          player,
          token,
          balance: balanceEnd.toFixed(3),
        },
      },
    ],
    history: [
      {
        object_type: "balance_history",
        event_type: "insert",
        data: {
          player,
          token,
          amount: String(amount),
          balance_start: String(balanceStart),
          balance_end: balanceEnd.toFixed(3),
          block_num: ctx.blockNum,
          trx_id: ctx.trxId,
          type: ctx.actionType,
          created_date: ctx.blockTime.toJSON(),
          counterparty: counterparty ?? null,
        },
      },
    ],
  };
}
