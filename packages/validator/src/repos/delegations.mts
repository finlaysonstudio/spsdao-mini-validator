import type { DelegationRow, RentalRow, RentalStatus, StateStore } from "../state/index.mjs";
import type { BlockRef, ProcessResult } from "../types.mjs";
import { EventLog } from "../types.mjs";
import { byteCompare } from "../util/collate.mjs";
import { ErrorType, ValidationError } from "../util/errors.mjs";
import { formatScaled, numberToScaled, scaledToNumber } from "../util/num.mjs";
import { Err, OkVoid, type Result } from "../util/result.mjs";
import type { BalanceRepository } from "./balance.mjs";
import { ACCOUNTS, TokenSupport, type IAction, type TokenSupportEntry } from "./context.mjs";
import type { HiveAccountRepository } from "./hive_accounts.mjs";
import type { TransitionManager } from "./transitions.mjs";
import type { TokenUnstakingRepository } from "./unstaking.mjs";

export type ActiveDelegationsEntry = {
  token: string;
  delegator: string;
  delegatee: string;
  amount: number;
  last_delegation_tx: string;
  last_delegation_date: Date;
  last_undelegation_date: Date | null;
  last_undelegation_tx: string | null;
};

function rowData(r: DelegationRow) {
  return {
    token: r.token,
    delegator: r.delegator,
    delegatee: r.delegatee,
    amount: formatScaled(r.amount, 3),
    last_delegation_tx: r.last_delegation_tx,
    last_delegation_date: r.last_delegation_date,
    last_undelegation_date: r.last_undelegation_date,
    last_undelegation_tx: r.last_undelegation_tx,
  };
}

function into(r: DelegationRow): ActiveDelegationsEntry {
  return { ...rowData(r), amount: scaledToNumber(r.amount, 3) };
}

export class ActiveDelegationsRepository {
  constructor(
    private readonly state: StateStore,
    private readonly balances: BalanceRepository,
    private readonly unstaking: TokenUnstakingRepository,
  ) {}

  getAvailableBalance(player: string, token: TokenSupportEntry): number {
    if (!token.delegation) throw new Error("Delegation is not supported for the specified token.");
    const token_balance = this.balances.getBalance(player, token.token);
    const delegated_balance = this.balances.getBalance(player, token.delegation.out_token);
    const balance = token_balance - delegated_balance;
    if (!token.unstakes) return balance;
    const unstaking_record = this.unstaking.lookup(player, token.unstakes);
    const unstaking_balance = unstaking_record ? +(unstaking_record.total_qty - unstaking_record.total_unstaked) : 0;
    return balance - unstaking_balance;
  }

  delegate(action: IAction, delegator: string, delegatee: string, token: TokenSupportEntry, qty: number, skipDateUpdate?: boolean): EventLog[] {
    if (!token.delegation) throw new Error("Delegation is not supported for the specified token.");
    const logs: EventLog[] = [];
    logs.push(this.upsertActiveDelegation(action, delegator, delegatee, token.token, qty, false, skipDateUpdate));
    logs.push(...this.balances.updateBalance(action, ACCOUNTS.DELEGATION, delegator, token.delegation.out_token, qty, "delegate_tokens"));
    logs.push(...this.balances.updateBalance(action, ACCOUNTS.DELEGATION, delegatee, token.delegation.in_token, qty, "delegate_tokens"));
    return logs;
  }

  undelegate(action: IAction, delegator: string, delegatee: string, token: TokenSupportEntry, qty: number, skipDateUpdate?: boolean): EventLog[] {
    if (!token.delegation) throw new Error("Delegation is not supported for the specified token.");
    const logs: EventLog[] = [];
    logs.push(this.upsertActiveDelegation(action, delegator, delegatee, token.token, qty, true, skipDateUpdate));
    logs.push(...this.balances.updateBalance(action, delegator, ACCOUNTS.DELEGATION, token.delegation.out_token, qty, "undelegate_tokens"));
    logs.push(...this.balances.updateBalance(action, delegatee, ACCOUNTS.DELEGATION, token.delegation.in_token, qty, "undelegate_tokens"));
    return logs;
  }

  getActiveDelegation(delegator: string, delegatee: string, token: string): ActiveDelegationsEntry | null {
    const r = this.state.delegations.get(delegator, delegatee, token);
    return r ? into(r) : null;
  }

  getActiveDelegations(delegator: string, delegatees: string[], token: string): ActiveDelegationsEntry[] {
    return this.state.delegations.getMany(delegator, delegatees, token).map(into);
  }

  private upsertActiveDelegation(
    action: IAction,
    delegator: string,
    delegatee: string,
    token: string,
    amount: number,
    is_undelegation: boolean,
    skipDateUpdate?: boolean,
  ): EventLog {
    const record = this.state.delegations.get(delegator, delegatee, token);
    let result: DelegationRow;
    if (!record) {
      result = {
        token,
        delegator,
        delegatee,
        amount: numberToScaled(amount, 3),
        last_delegation_tx: action.unique_trx_id,
        last_delegation_date: action.op.block_time,
        last_undelegation_date: null,
        last_undelegation_tx: null,
      };
      this.state.delegations.set(result);
    } else if (is_undelegation) {
      const current = scaledToNumber(record.amount, 3);
      record.amount = numberToScaled(current - amount, 3);
      if (!skipDateUpdate) {
        record.last_undelegation_tx = action.unique_trx_id;
        record.last_undelegation_date = action.op.block_time;
      }
      result = record;
    } else {
      const current = scaledToNumber(record.amount, 3);
      const new_amount = current + amount;
      if (new_amount == 0) {
        this.state.delegations.delete(delegator, delegatee, token);
        // upstream logs the knex delete result (a row count)
        return new EventLog("upsert", "active_delegations", 1 as unknown as DelegationRow);
      } else if (amount < 0) {
        record.amount = numberToScaled(new_amount, 3);
        if (!skipDateUpdate) {
          record.last_delegation_tx = action.unique_trx_id;
          record.last_delegation_date = action.op.block_time;
          record.last_undelegation_date = null;
          record.last_undelegation_tx = null;
        }
      } else {
        record.amount = numberToScaled(current + amount, 3);
        if (!skipDateUpdate) {
          record.last_delegation_tx = action.unique_trx_id;
          record.last_delegation_date = action.op.block_time;
        }
      }
      result = record;
    }
    return new EventLog("upsert", "active_delegations", rowData(result));
  }
}

// ---------------------------------------------------------------------------
// rental delegations
// ---------------------------------------------------------------------------
export type RentalDelegationEntry = Omit<RentalRow, "qty"> & { qty: number };

function rentalData(r: RentalRow) {
  return {
    id: r.id,
    promise_type: r.promise_type,
    promise_ext_id: r.promise_ext_id,
    lender: r.lender,
    borrower: r.borrower,
    token: r.token,
    qty: formatScaled(r.qty, 3),
    expiration_block: r.expiration_block,
    start_block: r.start_block,
    expiration_blocks: r.expiration_blocks,
    status: r.status,
    created_date: r.created_date,
    updated_date: r.updated_date,
  };
}

function rentalInto(r: RentalRow): RentalDelegationEntry {
  return { ...rentalData(r), qty: scaledToNumber(r.qty, 3) };
}

export class RentalDelegationRepository {
  constructor(private readonly state: StateStore) {}

  create(
    request: { id: string; promise_type: string; promise_ext_id: string; lender: string; borrower: string; token: string; qty: number; expiration_blocks: number; start_block: number },
    action: IAction,
  ): [RentalDelegationEntry, EventLog[]] {
    const row: RentalRow = {
      id: request.id,
      promise_type: request.promise_type,
      promise_ext_id: request.promise_ext_id,
      lender: request.lender,
      borrower: request.borrower,
      token: request.token,
      qty: numberToScaled(request.qty, 3),
      expiration_block: request.start_block + request.expiration_blocks,
      start_block: request.start_block,
      expiration_blocks: request.expiration_blocks,
      status: "active",
      created_date: action.op.block_time,
      updated_date: action.op.block_time,
    };
    if (this.state.rentals.exists(row.id)) throw new Error(`duplicate rental id ${row.id}`);
    this.state.rentals.insertActive(row);
    return [rentalInto(row), [new EventLog("insert", "rental_delegations", rentalData(row))]];
  }

  exists(id: string): boolean {
    return this.state.rentals.exists(id);
  }

  getExpiredRentals(currentBlock: number): RentalDelegationEntry[] {
    return this.state.rentals.expired(currentBlock).map(rentalInto);
  }

  countExpiredRentals(currentBlock: number): number {
    return this.state.rentals.countExpired(currentBlock);
  }

  updateStatus(id: string, status: RentalStatus, action: IAction): EventLog[] {
    const row = this.state.rentals.getActive(id);
    if (!row) throw new Error(`active rental ${id} not found`);
    row.status = status;
    row.updated_date = action.op.block_time;
    const data = rentalData(row);
    if (status !== "active") this.state.rentals.deactivate(id);
    return [new EventLog("update", "rental_delegations", data)];
  }

  getActiveRentalQty(lender: string, borrower: string, token: string): number {
    return scaledToNumber(this.state.rentals.activeQty(lender, borrower, token), 3) || 0;
  }

  getActiveRentalQtyMulti(lender: string, borrowers: string[], token: string): Map<string, number> {
    const map = new Map<string, number>();
    for (const b of new Set(borrowers)) {
      const q = this.state.rentals.activeQty(lender, b, token);
      if (q !== 0n || this.state.rentals.hasPair(lender, b, token)) map.set(b, scaledToNumber(q, 3) || 0);
    }
    return map;
  }
}

export class RentalDelegationExpirationSource {
  static readonly EXPIRATION_ACCOUNT = ACCOUNTS.RENTAL_EXPIRATION;
  constructor(private readonly customJsonId: string, private readonly rentals: RentalDelegationRepository, private readonly transitionBlock: number) {}

  process(block: BlockRef): ProcessResult[] {
    if (block.block_num < this.transitionBlock) return [];
    if (this.rentals.countExpiredRentals(block.block_num) === 0) return [];
    return [
      [
        "custom_json",
        {
          required_auths: [RentalDelegationExpirationSource.EXPIRATION_ACCOUNT],
          required_posting_auths: [],
          id: this.customJsonId,
          json: { action: "expire_rental_delegations", params: { block_num: block.block_num } },
        },
      ],
    ];
  }

  trx_id(block: BlockRef): string {
    return `sl_expire_rental_delegations_${block.block_num}`;
  }
}

// ---------------------------------------------------------------------------
// delegation manager
// ---------------------------------------------------------------------------
export type DelegateTokensRequest = {
  from: string;
  to: string;
  qty: number;
  token: string;
  allowSystemAccounts?: boolean;
  skipDateUpdate?: boolean;
  skipAuthorityCheck?: boolean;
};
export type DelegateTokensMultiRequest = { from: string; to: [string, number][]; token: string; allowSystemAccounts?: boolean };
export type UndelegateTokensRequest = {
  account: string;
  to: string;
  from: string;
  qty: number;
  token: string;
  allowSystemAccounts?: boolean;
  skipDateUpdate?: boolean;
};
export type UndelegateTokensMultiRequest = { to: string; from: [string, number][]; token: string; allowSystemAccounts?: boolean };

const UNDELEGATION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const SYSTEM_ACCOUNT_WHITELIST = ["$SOULKEEP"];
const DELEGATION_AUTHORITY = "delegation";

export class DelegationManager {
  constructor(
    private readonly hiveAccounts: HiveAccountRepository,
    private readonly delegations: ActiveDelegationsRepository,
    private readonly rentals: RentalDelegationRepository,
    private readonly transitions: TransitionManager,
  ) {}

  shouldGroupTransfersInMultiOps(block_num: number): boolean {
    return this.transitions.isTransitioned("fix_multi_undelegate_crash", block_num);
  }

  validateDelegationPromise(request: Pick<DelegateTokensRequest, "to" | "qty" | "token">, action: IAction): Result {
    const tokenEntry = TokenSupport.entry(request.token);
    if (!tokenEntry || !tokenEntry.delegation) {
      return Err(new ValidationError("Delegation is not supported for the specified token.", action.id, ErrorType.DelegationNotSupportedForToken));
    }
    if (!this.hiveAccounts.onlyHiveAccounts([request.to])) {
      return Err(new ValidationError("Argument to and player must be a valid Hive account.", action.id, ErrorType.AccountNotKnown));
    }
    if (request.qty <= 0 || isNaN(request.qty)) {
      return Err(new ValidationError("Amount must always be greater than 0.", action.id, ErrorType.AmountNotPositive));
    }
    return OkVoid();
  }

  validateDelegation(request: DelegateTokensRequest, action: IAction): Result {
    const tokenEntry = TokenSupport.entry(request.token);
    if (!tokenEntry || !tokenEntry.delegation) {
      return Err(new ValidationError("Delegation is not supported for the specified token.", action.id, ErrorType.DelegationNotSupportedForToken));
    } else if (request.to === request.from) {
      return Err(new ValidationError("Cannot delegate tokens to yourself.", action.id, ErrorType.CannotDelegateToSelf));
    }
    const accountsToValidate = [request.to, request.from];
    const is_valid_account = request.allowSystemAccounts
      ? this.hiveAccounts.onlyHiveOrSystemAccounts(accountsToValidate)
      : this.validAccounts(accountsToValidate);
    if (!is_valid_account) {
      return Err(new ValidationError("Arguments to and from must be a valid Hive account.", action.id, ErrorType.AccountNotKnown));
    }
    if (request.qty <= 0 || isNaN(request.qty)) {
      return Err(new ValidationError("Amount must always be greater than 0.", action.id, ErrorType.AmountNotPositive));
    }
    if (!request.skipAuthorityCheck) {
      const has_authority = this.hiveAccounts.checkAuthority(action.op.account, DELEGATION_AUTHORITY, request.from);
      if (!has_authority) {
        return Err(new ValidationError(`${action.op.account} does not have the authority to delegate tokens for ${request.from}.`, action.id, ErrorType.NoAuthority));
      }
    }
    const available_balance = this.delegations.getAvailableBalance(request.from, tokenEntry);
    if (available_balance < request.qty) {
      return Err(new ValidationError(`Insufficient liquid ${request.token}.`, action.id, ErrorType.InsufficientBalance));
    }
    return OkVoid();
  }

  validateDelegationMulti(request: DelegateTokensMultiRequest, action: IAction): Result {
    const tokenEntry = TokenSupport.entry(request.token);
    if (!tokenEntry || !tokenEntry.delegation) {
      return Err(new ValidationError("Delegation is not supported for the specified token.", action.id, ErrorType.DelegationNotSupportedForToken));
    } else if (request.to.some(([account]) => account === request.from)) {
      return Err(new ValidationError("Cannot delegate tokens to yourself.", action.id, ErrorType.CannotDelegateToSelf));
    }
    let delegations = request.to;
    if (this.shouldGroupTransfersInMultiOps(action.op.block_num)) {
      const grouped: Record<string, number> = {};
      for (const [to, qty] of request.to) {
        if (!grouped[to]) grouped[to] = 0;
        grouped[to] += qty;
      }
      delegations = Object.entries(grouped);
    }
    const toAccounts = delegations.map(([account]) => account);
    const accountsToValidate = [...toAccounts, request.from];
    const is_valid_account = request.allowSystemAccounts
      ? this.hiveAccounts.onlyHiveOrSystemAccounts(accountsToValidate)
      : this.validAccounts(accountsToValidate);
    if (!is_valid_account) {
      return Err(new ValidationError("to players must all be valid Hive accounts.", action.id, ErrorType.AccountNotKnown));
    }
    if (delegations.some(([, qty]) => qty <= 0 || isNaN(qty))) {
      return Err(new ValidationError("Amount must always be greater than 0.", action.id, ErrorType.AmountNotPositive));
    }
    const has_authority = this.hiveAccounts.checkAuthority(action.op.account, DELEGATION_AUTHORITY, request.from);
    if (!has_authority) {
      return Err(new ValidationError(`${action.op.account} does not have the authority to delegate tokens for ${request.from}.`, action.id, ErrorType.NoAuthority));
    }
    const qtyNeeded = delegations.reduce((acc, [, qty]) => acc + qty, 0);
    const available_balance = this.delegations.getAvailableBalance(request.from, tokenEntry);
    if (available_balance < qtyNeeded) {
      return Err(new ValidationError(`Insufficient liquid ${request.token}.`, action.id, ErrorType.InsufficientBalance));
    }
    return OkVoid();
  }

  delegate(delegation: DelegateTokensRequest, action: IAction): EventLog[] {
    const tokenEntry = TokenSupport.entry(delegation.token);
    if (!tokenEntry || !tokenEntry.delegation) throw new Error(`Delegation is not supported for the specified token: ${delegation.token}.`);
    return this.delegations.delegate(action, delegation.from, delegation.to, tokenEntry, delegation.qty, delegation.skipDateUpdate);
  }

  validateUndelegation(request: UndelegateTokensRequest, action: IAction): Result {
    const tokenEntry = TokenSupport.entry(request.token);
    if (!tokenEntry || !tokenEntry.delegation) {
      return Err(new ValidationError("Delegation is not supported for the specified token.", action.id, ErrorType.DelegationNotSupportedForToken));
    } else if (request.to === request.from) {
      return Err(new ValidationError("Cannot undelegate tokens from yourself.", action.id, ErrorType.CannotUndelegateToSelf));
    }
    const accountsToValidate = [request.account, request.to, request.from];
    const is_valid_account = request.allowSystemAccounts
      ? this.hiveAccounts.onlyHiveOrSystemAccounts(accountsToValidate)
      : this.validAccounts(accountsToValidate);
    if (!is_valid_account) {
      return Err(new ValidationError("Argument to and from must be a valid Hive account.", action.id, ErrorType.AccountNotKnown));
    }
    if (request.qty <= 0 || isNaN(request.qty)) {
      return Err(new ValidationError("Amount must always be greater than 0.", action.id, ErrorType.AmountNotPositive));
    }
    const has_authority = this.hiveAccounts.checkAuthority(action.op.account, DELEGATION_AUTHORITY, request.account);
    if (!has_authority) {
      return Err(new ValidationError(`${action.op.account} does not have the authority to undelegate tokens for ${request.account}.`, action.id, ErrorType.NoAuthority));
    }
    const active_delegation = this.delegations.getActiveDelegation(request.to, request.from, request.token);
    if (!active_delegation) {
      return Err(new ValidationError(`There is currently no ${request.token} tokens delegated from ${request.to} to ${request.from}.`, action.id, ErrorType.NoTokensDelegated));
    }
    const rentalLockedQty = this.rentals.getActiveRentalQty(request.to, request.from, request.token);
    return this.canUndelegate(active_delegation, request.token, request.from, request.to, request.qty, rentalLockedQty, action);
  }

  validateUndelegationMulti(request: UndelegateTokensMultiRequest, action: IAction): Result {
    const tokenEntry = TokenSupport.entry(request.token);
    if (!tokenEntry || !tokenEntry.delegation) {
      return Err(new ValidationError("Delegation is not supported for the specified token.", action.id, ErrorType.DelegationNotSupportedForToken));
    }
    let undelegations = request.from;
    if (this.shouldGroupTransfersInMultiOps(action.op.block_num)) {
      const grouped: Record<string, number> = {};
      for (const [from, qty] of request.from) {
        if (!grouped[from]) grouped[from] = 0;
        grouped[from] += qty;
      }
      undelegations = Object.entries(grouped);
    }
    const accounts = undelegations.map(([account]) => account);
    if (accounts.some((a) => a === request.to)) {
      return Err(new ValidationError("Cannot undelegate tokens from yourself.", action.id, ErrorType.CannotUndelegateToSelf));
    }
    const accountsToValidate = [...accounts, request.to];
    const is_valid_account = request.allowSystemAccounts
      ? this.hiveAccounts.onlyHiveOrSystemAccounts(accountsToValidate)
      : this.validAccounts(accountsToValidate);
    if (!is_valid_account) {
      return Err(new ValidationError("Argument to must be a valid Hive account.", action.id, ErrorType.AccountNotKnown));
    }
    if (undelegations.some(([, qty]) => qty <= 0 || isNaN(qty))) {
      return Err(new ValidationError("Amount must always be greater than 0.", action.id, ErrorType.AmountNotPositive));
    }
    const has_authority = this.hiveAccounts.checkAuthority(action.op.account, DELEGATION_AUTHORITY, request.to);
    if (!has_authority) {
      return Err(new ValidationError(`${action.op.account} does not have the authority to undelegate tokens for ${request.to}.`, action.id, ErrorType.NoAuthority));
    }
    const active_delegations = this.delegations.getActiveDelegations(request.to, accounts, request.token);
    const rentalLockedQtyMap = this.rentals.getActiveRentalQtyMulti(request.to, accounts, request.token);
    for (const [from, qty] of undelegations) {
      const active_delegation = active_delegations.find((d) => d.delegatee === from);
      const rentalLockedQty = rentalLockedQtyMap.get(from) ?? 0;
      const r = this.canUndelegate(active_delegation, request.token, from, request.to, qty, rentalLockedQty, action);
      if (!r.ok) return r;
    }
    return OkVoid();
  }

  private canUndelegate(
    delegation: ActiveDelegationsEntry | undefined,
    token: string,
    from: string,
    to: string,
    qty: number,
    rentalLockedQty: number,
    action: IAction,
  ): Result {
    if (!delegation) {
      return Err(new ValidationError(`There is currently no ${token} tokens delegated from ${to} to ${from}.`, action.id, ErrorType.NoTokensDelegated));
    }
    const undelegatableAmount = delegation.amount - rentalLockedQty;
    if (qty > undelegatableAmount) {
      return Err(new ValidationError("Cannot undelegate more than you have delegated.", action.id, ErrorType.UndelegationAmountTooHigh));
    } else if (action.op.block_time.getTime() - delegation.last_delegation_date.getTime() < UNDELEGATION_COOLDOWN_MS) {
      return Err(
        new ValidationError(`You have recently delegated from ${to} to ${from} and you must wait a while before being able to undelegate.`, action.id, ErrorType.UndelegationTooSoon),
      );
    }
    return OkVoid();
  }

  undelegate(request: UndelegateTokensRequest, action: IAction): EventLog[] {
    const tokenEntry = TokenSupport.entry(request.token);
    if (!tokenEntry || !tokenEntry.delegation) throw new Error(`Delegation is not supported for the specified token: ${request.token}.`);
    return this.delegations.undelegate(action, request.to, request.from, tokenEntry, request.qty, request.skipDateUpdate);
  }

  private validAccounts(accounts: string[]): boolean {
    const systemAccounts = accounts.filter((a) => a.startsWith("$"));
    const hiveAccounts = accounts.filter((a) => !a.startsWith("$"));
    const is_valid_account = this.hiveAccounts.onlyHiveAccounts(hiveAccounts);
    const is_valid_sys_account = systemAccounts.every((a) => SYSTEM_ACCOUNT_WHITELIST.includes(a));
    return is_valid_account && is_valid_sys_account;
  }
}

export { byteCompare };
