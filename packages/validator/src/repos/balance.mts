import type { StateStore } from "../state/index.mjs";
import { EventLog } from "../types.mjs";
import { ActionError, ErrorType } from "../util/errors.mjs";
import { addScaled, formatScaled, scaledToNumber } from "../util/num.mjs";
import type { IAction } from "./context.mjs";

function isPrintingAccount(player: string): boolean {
  // SpsBookkeeping: DOLLAR_ONLY with no configured bookkeeping accounts
  return player.startsWith("$");
}

export class BalanceRepository {
  constructor(private readonly state: StateStore) {}

  getBalance(player: string, token: string): number {
    this.state.balances.ensure(player, token);
    return this.state.balances.get(player, token);
  }

  getBalances(player: string): { player: string; token: string; balance: number }[] {
    return this.state.balances.getBalances(player);
  }

  /**
   * Mirrors BalanceRepository.updateBalance + BalanceHistoryRepository.insert
   * + TokenTransfer.
   */
  updateBalance(action: IAction, from: string, to: string, token: string, amount: number, type: string | null): EventLog[] {
    if (amount <= 0 || isNaN(amount)) {
      throw new ActionError("Amount must always be greater than 0", action.id, ErrorType.AmountNotPositive);
    }
    const from_balance = this.getBalance(from, token);
    const to_balance = this.getBalance(to, token);

    if (!isPrintingAccount(from) && from_balance < amount) {
      throw new ActionError("Insufficient balance.", action.id, ErrorType.InsufficientBalance);
    }

    const b = this.state.balances;
    // increment('balance', amount * -1) then increment('balance', amount), sequentially
    const newFrom = addScaled(b.getScaled(from, token), amount * -1, 3);
    b.set(from, token, newFrom);
    const newTo = addScaled(b.getScaled(to, token), amount, 3);
    b.set(to, token, newTo);

    // TokenTransfer (floats)
    const amt = parseFloat(amount as unknown as string);
    const from_start = parseFloat(from_balance as unknown as string);
    const from_end = parseFloat(from_balance as unknown as string) + amt * -1;
    const to_start = parseFloat(to_balance as unknown as string);
    const to_end = parseFloat(to_balance as unknown as string) + amt;

    const fromHistory = {
      player: from,
      token,
      amount: String(amt * -1),
      balance_start: String(from_start),
      balance_end: from_end.toFixed(3),
      block_num: action.op.block_num,
      trx_id: action.op.trx_op_id,
      type: type!,
      created_date: action.op.block_time,
      counterparty: to,
    };
    const toHistory = {
      player: to,
      token,
      amount: String(amt),
      balance_start: String(to_start),
      balance_end: to_end.toFixed(3),
      block_num: action.op.block_num,
      trx_id: action.op.trx_op_id,
      type: type!,
      created_date: action.op.block_time,
      counterparty: from,
    };

    return [
      new EventLog("update", "balances", { player: from, token, balance: formatScaled(newFrom, 3) }),
      new EventLog("update", "balances", { player: to, token, balance: formatScaled(newTo, 3) }),
      new EventLog("insert", "balance_history", fromHistory),
      new EventLog("insert", "balance_history", toHistory),
    ];
  }

  tokenTransferKeysExist(account: string, keys: string[]): boolean {
    return keys.some((k) => this.state.transferKeys.has(account, k));
  }

  insertTokenTransferKey(account: string, key: string, action: IAction): EventLog {
    this.state.transferKeys.add(account, key);
    return new EventLog("insert", "token_transfer_keys", {
      account,
      key,
      trx_id: action.op.trx_op_id,
      block_num: action.op.block_num,
      block_time: action.op.block_time,
    });
  }
}

export { scaledToNumber };
