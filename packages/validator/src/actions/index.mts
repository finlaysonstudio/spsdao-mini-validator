/**
 * All SPS actions, ported from apps/sps-validator/src/sps/actions. Validation
 * order and error codes are preserved exactly; they feed the L2 hash.
 */
import * as S from "../schema.mjs";
import type { Services } from "../services.mjs";
import { EventLog, type OperationData } from "../types.mjs";
import { isSystemAccount } from "../util/accounts.mjs";
import { ErrorType, UnsupportedPathError, ValidationError } from "../util/errors.mjs";
import { ACCOUNTS, TOKENS, TokenSupport } from "../repos/context.mjs";
import type { ValidatorEntry } from "../repos/validators.mjs";
import { Action, AdminAction, type ActionFactory, type ExecutableAction } from "./base.mjs";
import * as T from "./transitions.mjs";

type Op = OperationData;

// ---------------------------------------------------------------------------
// test
// ---------------------------------------------------------------------------
class TestAction extends Action<{ type: string }> {
  constructor(op: Op, data: unknown, index?: number) {
    super(S.test, op, data, index);
  }
  validate() {
    if (!this.params.type) throw this.err("Invalid or missing type.", ErrorType.TestError);
    return true;
  }
  process() {
    return [new EventLog("update", "test", this.params.type)];
  }
}

// ---------------------------------------------------------------------------
// config_update
// ---------------------------------------------------------------------------
class ConfigUpdateAction extends AdminAction<{ updates: { group_name: string; name: string; value: unknown }[] }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(svc.config, S.config_update, op, data, index);
  }
  override validate(): boolean {
    super.validate();
    throw new UnsupportedPathError(`config_update by admin ${this.op.account} at ${this.op.block_num} is not ported`);
  }
  process(): EventLog[] {
    throw new UnsupportedPathError("config_update");
  }
}

// ---------------------------------------------------------------------------
// account
// ---------------------------------------------------------------------------
class SetAuthorityAction extends Action<{ delegation: string[] }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.set_authority, op, data, index);
  }
  validate() {
    const authority = { delegation: this.params.delegation };
    const accounts = Object.values(authority).flatMap((a) => a);
    if (!this.svc.hiveAccounts.onlyHiveAccounts(accounts)) {
      throw this.err("One or more of the accounts are not valid Hive accounts.", ErrorType.AccountNotKnown);
    }
    return true;
  }
  process() {
    const authority = { delegation: this.params.delegation };
    return [this.svc.hiveAccounts.setAuthority(this.op.account, authority)];
  }
}

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------
class BurnAction extends Action<{ account: string; to: string; token: string; qty: number }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.burn, op, data, index);
  }
  validate() {
    const balance = this.svc.balances.getBalance(this.op.account, this.params.token);
    if (balance < this.params.qty) throw this.err("Insufficient balance.", ErrorType.InsufficientBalance);
    if (this.op.account !== this.params.account) throw this.err("Account mismatch balance.", ErrorType.MismatchedAccount);
    return true;
  }
  process() {
    this.players.push(this.params.to);
    return this.svc.balances.updateBalance(this, this.op.account, this.params.to, this.params.token, this.params.qty, this.action_name);
  }
}

class CancelUnstakeTokensAction extends Action<{ token: string }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.cancel_unstake_tokens, op, data, index);
  }
  validate() {
    const stake = TokenSupport.stake(this.params.token);
    if (!stake) throw this.err("Staking is not supported for the specified token.", ErrorType.NoStakingToken);
    if (!this.svc.unstaking.lookup(this.op.account, this.params.token)) {
      throw this.err("This player does not have a currently active unstaking operation to cancel.", ErrorType.NoActiveUnstaking);
    }
    return true;
  }
  process() {
    return [this.svc.unstaking.cancel(this, this.params.token)];
  }
}

class ClaimStakingRewardsAction extends Action<Record<string, never>> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.claim_staking_rewards, op, data, index);
  }
  validate() {
    return true;
  }
  process() {
    return this.svc.stakingRewards.claimAll(this.op.account, 0, this);
  }
}

class DelegateTokensAction extends Action<{ token: string; to: string; qty: number; player?: string }> {
  private readonly toPlayer: string;
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.delegate_tokens, op, data, index);
    this.toPlayer = this.params.player ?? this.op.account;
  }
  validate() {
    const v = this.svc.delegationManager.validateDelegation(
      { from: this.toPlayer, token: this.params.token, to: this.params.to, qty: this.params.qty, allowSystemAccounts: false },
      this,
    );
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    this.players.push(this.toPlayer, this.params.to);
    return this.svc.delegationManager.delegate({ from: this.toPlayer, to: this.params.to, qty: this.params.qty, token: this.params.token, allowSystemAccounts: false }, this);
  }
}

class ReturnTokensAction extends Action<{ token: string; from: string; qty: number; player?: string }> {
  private readonly fromPlayer: string;
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.return_tokens, op, data, index);
    this.fromPlayer = this.params.player ?? this.op.account;
  }
  validate() {
    const v = this.svc.delegationManager.validateUndelegation(
      { account: this.fromPlayer, to: this.params.from, from: this.fromPlayer, token: this.params.token, qty: this.params.qty, allowSystemAccounts: false },
      this,
    );
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    this.players.push(this.fromPlayer, this.params.from);
    return this.svc.delegationManager.undelegate(
      { account: this.fromPlayer, to: this.params.from, from: this.fromPlayer, qty: this.params.qty, token: this.params.token, allowSystemAccounts: false },
      this,
    );
  }
}

class ShopPurchaseAction extends Action<{ id: string; qty: number }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.shop_purchase, op, data, index);
  }
  override isSupported() {
    return true;
  }
  validate(): boolean {
    // Shop.precalculateSale: only `validator_tranche_info` (legacy tranche sale) and config-registered
    // sales exist. With no dynamic sales configured every other id fails with NoSuchSale.
    if (this.params.id !== "validator_tranche_info") {
      const shop = this.svc.config.shop;
      if (shop && Object.prototype.hasOwnProperty.call(shop, this.params.id)) {
        throw new UnsupportedPathError(`shop_purchase of configured sale ${this.params.id}`);
      }
      throw this.err(`Sale ${this.params.id} does not exist`, ErrorType.NoSuchSale);
    }
    throw new UnsupportedPathError("shop_purchase validator_tranche_info is not ported");
  }
  process(): EventLog[] {
    throw new UnsupportedPathError("shop_purchase");
  }
}

class StakeTokensMultiAction extends AdminAction<{ token: string; to_player?: string; multi: { from: string; qty: number }[] }> {
  private readonly stakedToken?: string;
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(svc.config, S.stake_tokens_multi, op, data, index);
    this.stakedToken = TokenSupport.stake(this.params.token);
  }
  override validate() {
    if (this.op.block_num > 105721365 && !super.validate()) return false;
    if (!this.stakedToken) throw this.err("Staking is not supported for the specified token.", ErrorType.NoStakingToken);
    if (!this.params.to_player) {
      this.params.to_player = this.op.account;
    } else if (this.params.to_player !== this.op.account && !this.op.active_auth) {
      throw this.err("Active key is required when staking to someone else.", ErrorType.ActiveKeyRequired);
    }
    const grouped: Record<string, number> = {};
    for (const cur of this.params.multi) {
      if (!grouped[cur.from]) grouped[cur.from] = 0;
      grouped[cur.from] += cur.qty;
    }
    const isAdmin = this.svc.config.isAdmin(this.op.account);
    for (const [from, qty] of Object.entries(grouped)) {
      if (this.op.block_num > 105721365 && isSystemAccount(from) && !isAdmin) {
        throw this.err("Cannot stake from system account as non admin", ErrorType.AdminOnly);
      }
      const balance = this.svc.balances.getBalance(from, this.params.token);
      if (balance < qty) throw this.err("Cannot stake more than the currently available liquid token balance.", ErrorType.InsufficientBalance);
    }
    return true;
  }
  process() {
    const logs: EventLog[] = [];
    const totalQty = this.params.multi.reduce((acc, cur) => acc + cur.qty, 0);
    logs.push(...this.svc.stakingRewards.claimUnclaimedRewards(this, this.params.to_player!, this.stakedToken!, totalQty));
    for (const { qty, from } of this.params.multi) {
      logs.push(...this.svc.stakingRewards.updatedBalancesAfterStaking(this, from, this.params.to_player!, this.params.token, this.stakedToken!, qty, this.action_name));
    }
    logs.push(...this.svc.votes.incrementVoteWeight(this.params.to_player!, totalQty, this.op.block_num));
    return logs;
  }
}

class StakeTokensAction extends Action<{ token: string; to_player?: string; from_player?: string; qty: number }> {
  private readonly stakedToken?: string;
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.stake_tokens, op, data, index);
    this.stakedToken = TokenSupport.stake(this.params.token);
  }
  validate() {
    if (!this.stakedToken) throw this.err("Staking is not supported for the specified token.", ErrorType.NoStakingToken);
    if (!this.params.to_player) {
      this.params.to_player = this.op.account;
    } else if (this.params.to_player !== this.op.account && !this.op.active_auth) {
      throw this.err("Active key is required when staking to someone else.", ErrorType.ActiveKeyRequired);
    }
    if (!this.params.from_player) this.params.from_player = this.op.account;
    const isFromSystemAccount = isSystemAccount(this.params.from_player);
    const isAdmin = this.svc.config.isAdmin(this.op.account);
    if (isFromSystemAccount && !isAdmin) throw this.err("Cannot stake from system account as non admin", ErrorType.AdminOnly);
    const balance = this.svc.balances.getBalance(this.params.from_player, this.params.token);
    if (balance < this.params.qty) throw this.err("Cannot stake more than the currently available liquid token balance.", ErrorType.InsufficientBalance);
    return true;
  }
  process() {
    const logs: EventLog[] = [];
    logs.push(...this.svc.stakingRewards.stakeTokens(this, this.params.from_player!, this.params.to_player!, this.params.token, this.stakedToken!, this.params.qty, this.action_name));
    logs.push(...this.svc.votes.incrementVoteWeight(this.params.to_player!, this.params.qty, this.op.block_num));
    return logs;
  }
}

class TokenAwardAction extends AdminAction<{ to: string; from: string; token: string; qty: number }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(svc.config, S.token_award, op, data, index);
  }
  override validate() {
    super.validate();
    if (!this.op.active_auth) throw this.err("Active key is required when awarding tokens.", ErrorType.ActiveKeyRequired);
    if (!this.params.from.startsWith("$")) throw this.err("Tokens may only be awarded from a system account.", ErrorType.NoSystemAccount);
    const balance = this.svc.balances.getBalance(this.params.from, this.params.token);
    if (balance < this.params.qty) throw this.err("Cannot award more than the currently available liquid token balance.", ErrorType.InsufficientBalance);
    return true;
  }
  process() {
    return this.svc.balances.updateBalance(this, this.params.from, this.params.to, this.params.token, this.params.qty, this.action_name);
  }
  override isSupported() {
    return TokenSupport.canTransfer(this.params.token, this.params.qty);
  }
}

function isValidTokenTransferKey(key: unknown): key is string {
  return !(typeof key !== "string" || key.length === 0 || key.length > 64);
}

type MultiTransfer = { type?: string; multi: { token: string; to: { name: string; qty: number; memo?: string; type?: string; key?: unknown }[] }[] };

class TokenTransferMultiAction extends Action<MultiTransfer> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.token_transfer_multi, op, data, index);
  }
  override isSupported() {
    if (this.params.multi.length === 0) return false;
    const transfers = this.params.multi.flatMap((x) => x.to.map((y) => ({ token: x.token, qty: y.qty })));
    return transfers.every((e) => TokenSupport.canTransfer(e.token, e.qty));
  }
  validate() {
    if (this.params.multi.some((x) => x.to.some((y) => y.name === this.op.account))) {
      throw this.err("You cannot transfer tokens to yourself", ErrorType.SelfTransfer);
    }
    const tokens_required = new Map<string, number>();
    for (const x of this.params.multi) {
      const current = tokens_required.get(x.token) ?? 0;
      tokens_required.set(x.token, current + x.to.reduce((acc, t) => acc + t.qty, 0));
    }
    if (tokens_required.size > 1) throw this.err("Transferring more than 1 token type is not supported at this block", ErrorType.NoMultiTokenTransfer);
    const balances = new Map<string, number>();
    for (const x of this.svc.balances.getBalances(this.op.account)) {
      balances.set(x.token, (balances.get(x.token) ?? 0) + x.balance);
    }
    for (const [token, required] of tokens_required) {
      const owned = balances.get(token) ?? 0;
      if (owned < required) throw this.err("Insufficient balance.", ErrorType.InsufficientBalance);
    }
    const names = this.params.multi.flatMap((x) => x.to).flatMap((x) => x.name);
    if (!this.svc.hiveAccounts.onlyHiveOrSystemAccounts(names)) {
      throw this.err("You cannot transfer tokens to a non existing Hive account.", ErrorType.AccountNotKnown);
    }
    if (this.svc.transitions.isTransitioned("adjust_token_distribution_strategy", this.op.block_num)) {
      const transferKeys = this.params.multi
        .flatMap((x) => x.to)
        .flatMap((x) => x.key)
        .filter((k) => k !== undefined);
      if (transferKeys.length !== new Set(transferKeys).size) throw this.err("Duplicate transfer keys are not allowed.", ErrorType.DuplicateTransferKey);
      const invalidKeys = transferKeys.filter((k) => !isValidTokenTransferKey(k));
      if (invalidKeys.length > 0) {
        throw this.err("Invalid transfer keys. Each key must be a non-empty string with a maximum length of 64 characters.", ErrorType.InvalidTransferKey);
      }
      if (this.svc.balances.tokenTransferKeysExist(this.op.account, transferKeys as string[])) {
        throw this.err("A transfer for one of these keys has already been processed for this account.", ErrorType.DuplicateTransferKey);
      }
    }
    return true;
  }
  process() {
    const affected = new Set(this.params.multi.flatMap((x) => x.to.map((t) => t.name)));
    this.players.push(...affected);
    const type = this.params.type || this.action_name;
    const transfers = this.params.multi.flatMap((x) => x.to.map((t) => ({ to: t.name, amount: t.qty, token: x.token, type: t.type || type, key: t.key })));
    const event_logs: EventLog[] = [];
    for (const transfer of transfers) {
      const event_log = this.svc.balances.updateBalance(this, this.op.account, transfer.to, transfer.token, transfer.amount, transfer.type);
      event_logs.push(...event_log);
      if (transfer.key && this.svc.transitions.isTransitioned("adjust_token_distribution_strategy", this.op.block_num)) {
        // upstream bug preserved: the key event is pushed to the already-spread local array and never logged
        this.svc.balances.insertTokenTransferKey(this.op.account, transfer.key as string, this);
      }
    }
    return event_logs;
  }
}

class TokenTransferAction extends Action<{ to: string; token: string; qty: number; key?: unknown }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.token_transfer, op, data, index);
  }
  validate() {
    if (!this.params.to.startsWith("$")) this.params.to = this.params.to.toLowerCase().trim();
    if (this.params.to === this.op.account) throw this.err("You cannot transfer tokens to yourself.", ErrorType.SelfTransfer);
    const balance = this.svc.balances.getBalance(this.op.account, this.params.token);
    if (balance < this.params.qty) throw this.err("Insufficient balance.", ErrorType.InsufficientBalance);
    if (!this.svc.hiveAccounts.onlyHiveOrSystemAccounts([this.params.to])) {
      throw this.err("You cannot transfer tokens to a non existing Hive account.", ErrorType.AccountNotKnown);
    }
    if (this.params.key !== undefined && this.svc.transitions.isTransitioned("adjust_token_distribution_strategy", this.op.block_num)) {
      if (!isValidTokenTransferKey(this.params.key)) {
        throw this.err("Invalid transfer key. The key must be a non-empty string with a maximum length of 64 characters.", ErrorType.InvalidTransferKey);
      }
      if (this.svc.balances.tokenTransferKeysExist(this.op.account, [this.params.key])) {
        throw this.err("A transfer for this key has already been processed for this account.", ErrorType.DuplicateTransferKey);
      }
    }
    return true;
  }
  process() {
    this.players.push(this.params.to);
    const logs: EventLog[] = [];
    logs.push(...this.svc.balances.updateBalance(this, this.op.account, this.params.to, this.params.token, this.params.qty, this.action_name));
    if (this.params.key && this.svc.transitions.isTransitioned("adjust_token_distribution_strategy", this.op.block_num)) {
      logs.push(this.svc.balances.insertTokenTransferKey(this.op.account, this.params.key as string, this));
    }
    return logs;
  }
  override isSupported() {
    return TokenSupport.canTransfer(this.params.token, this.params.qty);
  }
}

class TokenUnstakingAction extends Action<{ player: string; unstake_amount: number; token: string; update: () => void }> {
  private readonly stakedToken?: string;
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.token_unstaking, op, data, index);
    this.stakedToken = TokenSupport.stake(this.params.token);
  }
  validate() {
    if (!this.stakedToken) throw this.err("Staking is not supported for the specified token.", ErrorType.NoStakingToken);
    return true;
  }
  process() {
    if (!this.stakedToken) throw this.err("Staking is not supported for the specified token.", ErrorType.NoStakingToken);
    const results: EventLog[] = this.svc.stakingRewards.claimAll(this.params.player, [this.params.unstake_amount * -1, this.stakedToken], this);
    const amount_remaining = this.svc.balances.getBalance(this.params.player, this.stakedToken);
    const unstake_amount = Math.min(this.params.unstake_amount, amount_remaining);
    if (unstake_amount > 0) {
      results.push(...this.svc.balances.updateBalance(this, this.params.player, ACCOUNTS.STAKING, this.stakedToken, unstake_amount, this.action_name));
      results.push(...this.svc.balances.updateBalance(this, ACCOUNTS.STAKING, this.params.player, this.params.token, unstake_amount, this.action_name));
      const checkStakedToken = this.svc.transitions.isTransitioned("fix_vote_weight", this.op.block_num) ? TOKENS.SPSP : TOKENS.SPS;
      if (this.params.token === TOKENS.SPS && this.stakedToken === checkStakedToken) {
        results.push(...this.svc.votes.incrementVoteWeight(this.params.player, unstake_amount * -1, this.op.block_num));
      }
    }
    this.params.update();
    return results;
  }
}

class UndelegateTokensMultiAction extends Action<{ token: string; data: { from: string; qty: number }[]; player?: string }> {
  private readonly toPlayer: string;
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.undelegate_tokens_multi, op, data, index);
    this.toPlayer = this.params.player ?? this.op.account;
  }
  validate() {
    const v = this.svc.delegationManager.validateUndelegationMulti(
      { to: this.toPlayer, from: this.params.data.map(({ from, qty }) => [from, qty]), token: this.params.token, allowSystemAccounts: false },
      this,
    );
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    this.players.push(this.toPlayer);
    const logs: EventLog[] = [];
    for (const { from, qty } of this.params.data) {
      this.players.push(from);
      logs.push(...this.svc.delegationManager.undelegate({ account: this.toPlayer, to: this.toPlayer, from, qty, token: this.params.token, allowSystemAccounts: false }, this));
    }
    return logs;
  }
}

class UndelegateTokensAction extends Action<{ token: string; from: string; qty: number; player?: string }> {
  private readonly toPlayer: string;
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.undelegate_tokens, op, data, index);
    this.toPlayer = this.params.player ?? this.op.account;
  }
  validate() {
    const v = this.svc.delegationManager.validateUndelegation(
      { account: this.toPlayer, to: this.toPlayer, from: this.params.from, token: this.params.token, qty: this.params.qty, allowSystemAccounts: false },
      this,
    );
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    this.players.push(this.toPlayer, this.params.from);
    return this.svc.delegationManager.undelegate(
      { account: this.toPlayer, to: this.toPlayer, from: this.params.from, qty: this.params.qty, token: this.params.token, allowSystemAccounts: false },
      this,
    );
  }
}

class UnstakeTokensAction extends Action<{ token: string; qty: number }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.unstake_tokens, op, data, index);
  }
  validate() {
    const staked = TokenSupport.stake(this.params.token);
    if (!staked) throw this.err("Unstaking is not supported for the specified token.", ErrorType.NoStakingToken);
    if (this.params.qty < 0.04) throw this.err("Minimum unstake amount is 0.04.", ErrorType.InvalidUnstakingQty);
    const balance = this.svc.balances.getBalance(this.op.account, staked);
    const delegation_support = TokenSupport.delegation(staked);
    let unstaking_limit = balance;
    if (delegation_support) {
      const out_balance = this.svc.balances.getBalance(this.op.account, delegation_support.out_token);
      unstaking_limit -= out_balance;
    }
    if (unstaking_limit < this.params.qty) throw this.err("Cannot unstake more than the currently available staked token balance.", ErrorType.InsufficientBalance);
    if (this.svc.unstaking.lookup(this.op.account, this.params.token)) {
      throw this.err(
        "There is already an active unstaking process for this player. You must cancel any active unstaking processes before you may start a new one.",
        ErrorType.ActiveUnstaking,
      );
    }
    return true;
  }
  process() {
    return this.svc.unstaking.insert(this, this.params.token, this.params.qty);
  }
}

// ---------------------------------------------------------------------------
// validator
// ---------------------------------------------------------------------------
class ActivateLicenseAction extends Action<{ qty: number }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.activate_license, op, data, index);
  }
  validate() {
    const { licenses } = this.svc.licenseManager.getLicenses(this.op.account);
    if (licenses < this.params.qty) throw this.err("Not enough licenses", ErrorType.InsufficientBalance);
    return true;
  }
  process() {
    return [...this.svc.licenseManager.activateLicenses(this, this.op.account, this.params.qty)];
  }
}

class DeactivateLicenseAction extends Action<{ qty: number }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.deactivate_license, op, data, index);
  }
  validate() {
    const { activatedLicenses } = this.svc.licenseManager.getLicenses(this.op.account);
    if (activatedLicenses < this.params.qty) throw this.err("Not enough activated licenses", ErrorType.InsufficientBalance);
    return true;
  }
  process() {
    return [...this.svc.licenseManager.deactivateLicenses(this, this.op.account, this.params.qty)];
  }
}

class ApproveValidatorAction extends Action<{ account_name: string }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.approve_validator, op, data, index);
  }
  validate() {
    const validator = this.svc.validators.lookup(this.params.account_name, this.op.block_num);
    if (!validator) throw this.err("Specified validator not found.", ErrorType.UnknownValidator);
    const votes = this.svc.votes.lookupByVoter(this.op.account);
    if (votes && votes.find((v) => v.validator === this.params.account_name)) {
      throw this.err("This account has already voted for the specified validator.", ErrorType.DoubleValidatorVote);
    }
    const max_votes = this.svc.config.validator?.max_votes;
    if (max_votes === undefined) throw this.err("This validator node has an incompatible configuration. try again later", ErrorType.MisconfiguredValidator);
    if (votes && votes.length >= max_votes) throw this.err("This account has already voted for the maximum allowed number of validators.", ErrorType.MaxValidatorVotes);
    return true;
  }
  process() {
    return this.svc.votes.insert(this);
  }
}

class UnapproveValidatorAction extends Action<{ account_name: string }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.unapprove_validator, op, data, index);
  }
  validate() {
    const votes = this.svc.votes.lookupByVoter(this.op.account);
    if (!votes || !votes.find((v) => v.validator === this.params.account_name)) {
      throw this.err("This account is not currently voting for the specified validator.", ErrorType.NoSuchValidatorVote);
    }
    return true;
  }
  process() {
    return this.svc.votes.delete(this);
  }
}

class CheckInValidatorAction extends Action<{ block_num: number; hash: string; version: string }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.check_in_validator, op, data, index);
  }
  validate() {
    const validator = this.svc.validators.lookup(this.op.account, this.op.block_num);
    if (!validator) throw this.err("Validator not found.", ErrorType.UnknownValidator);
    else if (!validator.is_active) throw this.err("Validator is not active.", ErrorType.InactiveValidator);
    const rewardAccount = validator.reward_account ?? this.op.account;
    const checkIn = this.svc.licenseManager.getCheckIn(rewardAccount, this.op.block_num);
    if (!checkIn.can_check_in) throw this.err("Cannot check in at this block.", ErrorType.InvalidCheckIn);
    const { block_num, hash } = this.params;
    if (!this.svc.licenseManager.isCheckInBlockWithinWindow(this.op.block_num, block_num)) throw this.err("Check in block is too old.", ErrorType.InvalidCheckIn);
    const expectedHash = this.svc.licenseManager.getCheckInHashForBlockNum(block_num, rewardAccount);
    if (hash !== expectedHash) throw this.err("Invalid check in hash.", ErrorType.InvalidCheckIn);
    return true;
  }
  process() {
    const results: EventLog[] = [];
    const validator = this.svc.validators.lookup(this.op.account, this.op.block_num)!;
    const rewardAccount = validator.reward_account ?? this.op.account;
    results.push(...this.svc.licenseManager.checkIn(this, rewardAccount));
    if (validator.last_version !== this.params.version) {
      results.push(...this.svc.validators.updateVersion(this.op.account, this.params.version, this));
    }
    return results;
  }
}

class ExpireCheckInsAction extends Action<Record<string, never>> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.expire_check_ins, op, data, index);
  }
  validate() {
    if (this.op.account !== ACCOUNTS.LICENSE_MANAGER) throw this.err("Only the system account can expire check ins", ErrorType.MismatchedAccount);
    return true;
  }
  process() {
    return [...this.svc.licenseManager.expireCheckIns(this)];
  }
}

class TopPriceFeedAction extends Action<{ updates: { token: string; price: number }[]; metadata?: unknown }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.price_feed, op, data, index);
  }
  validate() {
    return true;
  }
  process() {
    const results: EventLog[] = [];
    for (const update of this.params.updates) {
      if (update.token !== TOKENS.SPS) continue;
      results.push(
        ...this.svc.priceFeed.addPriceEntry({
          validator: this.op.account,
          token: update.token,
          token_price: update.price,
          block_num: this.op.block_num,
          block_time: this.op.block_time,
        }),
      );
    }
    return results;
  }
}

/** Upstream LegacyAdminPriceFeedAction -> AdminPriceFeedAction proxy, writing through RawPriceFeed. */
class LegacyAdminPriceFeedAction extends AdminAction<{ sps_price: number }> {
  constructor(op: Op, data: unknown, index: number | undefined, private readonly svc: Services) {
    super(svc.config, S.legacy_price_feed, op, data, index);
  }
  process(): EventLog[] {
    const updates = [{ token: TOKENS.SPS, price: this.params.sps_price }];
    const results: EventLog[] = [];
    for (const update of updates) {
      results.push(
        ...this.svc.priceFeed.addRawPriceEntry({
          validator: this.op.account,
          token: update.token,
          token_price: update.price,
          block_num: this.op.block_num,
          block_time: this.op.block_time,
        }),
      );
    }
    return results;
  }
}

function removeFromLicenseRewardPool(svc: Services, action: Action, validator: ValidatorEntry): EventLog[] {
  const events: EventLog[] = [];
  if (validator.reward_account) {
    const validators = svc.validators.getValidators({ reward_account: validator.reward_account, is_active: true });
    const filtered = validators.filter((v) => v.account_name !== validator.account_name);
    const rewardAccountValidator = svc.validators.lookup(validator.reward_account, action.op.block_num);
    if (filtered.length === 0 && (!rewardAccountValidator || !rewardAccountValidator.is_active)) {
      events.push(...svc.licenseManager.expireCheckIn(validator.reward_account, action));
    }
  } else {
    const validators = svc.validators.getValidators({ reward_account: validator.account_name, is_active: true });
    const filtered = validators.filter((v) => v.account_name !== validator.account_name);
    if (filtered.length === 0) events.push(...svc.licenseManager.expireCheckIn(validator.account_name, action));
  }
  return events;
}

class UpdateMissedBlocksAction extends Action<{ account: string; checked_block: number; missed_blocks: number }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.update_missed_blocks, op, data, index);
  }
  validate() {
    return true;
  }
  process() {
    const logs = [...this.svc.validators.incrementMissedBlocks(this.params.account, this.params.missed_blocks, this)];
    const validator = this.svc.validators.lookup(this.params.account, this.op.block_num);
    const threshold = this.svc.config.validator?.consecutive_missed_blocks_threshold ?? 0;
    if (validator && validator.is_active && validator.consecutive_missed_blocks !== undefined && threshold !== 0 && validator.consecutive_missed_blocks > threshold) {
      logs.push(this.svc.validators.disable(this.params.account, this));
      logs.push(...removeFromLicenseRewardPool(this.svc, this, validator));
    }
    return logs;
  }
}

class UpdateValidatorAction extends Action<{ is_active: boolean; post_url?: string | null; api_url?: string | null; reward_account?: string | null }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.update_validator, op, data, index);
  }
  validate() {
    if (this.params.reward_account) {
      if (!this.svc.hiveAccounts.onlyHiveAccounts([this.params.reward_account])) throw this.err("reward_account must be a valid hive account", ErrorType.AccountNotKnown);
      if (this.params.reward_account === this.op.account) throw this.err("reward_account cannot be the same as the validator account", ErrorType.DuplicateAccount);
    }
    return true;
  }
  process() {
    const events: EventLog[] = [];
    const validator = this.svc.validators.lookup(this.op.account, this.op.block_num);
    if (validator && !this.params.is_active) {
      events.push(...removeFromLicenseRewardPool(this.svc, this, validator));
    } else if (validator && this.params.reward_account !== validator.reward_account) {
      events.push(...removeFromLicenseRewardPool(this.svc, this, validator));
    }
    events.push(
      this.svc.validators.register(
        {
          account: this.op.account,
          is_active: this.params.is_active,
          post_url: this.params.post_url ?? undefined,
          api_url: this.params.api_url ?? undefined,
          reward_account: this.params.reward_account ?? undefined,
        },
        this,
      ),
    );
    return events;
  }
}

class ValidateBlockAction extends Action<{ block_num: number; hash: string; version: string }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.validate_block, op, data, index);
  }
  validate() {
    const block = this.svc.blocks.getByBlockNum(this.params.block_num);
    if (!block) throw this.err("Specified block not found.", ErrorType.NoSuchBlock);
    if (block.validator !== this.op.account) throw this.err("The specified block was not assigned to this account to validate.", ErrorType.WrongBlockValidator);
    const cfg = this.svc.config.validator;
    if (!cfg) throw this.err("This validator node has an incompatible configuration. try again later", ErrorType.MisconfiguredValidator);
    if (this.op.block_num - this.params.block_num > cfg.max_block_age) throw this.err("The specified block is too old to be validated.", ErrorType.OldBlock);
    if (cfg.paused_until_block > this.params.block_num) throw this.err("Block validation is paused.", ErrorType.BlockValidationPaused);
    if (block.validation_tx) throw this.err("The specified block has already been validated.", ErrorType.AlreadyValidatedBlock);
    if (block.l2_block_id !== this.params.hash) throw this.err("The specified hash does not match.", ErrorType.BlockHashMismatch);
    return true;
  }
  process() {
    const validator = this.svc.validators.lookup(this.op.account, this.op.block_num);
    if (!validator) throw this.err("Validator not found.", ErrorType.AccountNotKnown);
    const reward_account = validator.reward_account ?? this.op.account;
    const results: EventLog[] = [this.svc.blocks.insertValidation(this.params.block_num, this.op.transaction_id)];
    const reward = this.op.block_reward;
    if (reward !== 0) {
      const [amount, token] = reward;
      if (amount > 0) results.push(...this.svc.balances.updateBalance(this, ACCOUNTS.VALIDATOR_REWARDS, reward_account, token, amount, this.action_name));
    }
    if (validator.last_version !== this.params.version) results.push(...this.svc.validators.updateVersion(this.op.account, this.params.version, this));
    if (validator.consecutive_missed_blocks !== undefined && validator.consecutive_missed_blocks > 0) {
      results.push(...this.svc.validators.resetConsecutiveMissedBlocks(this.op.account, this));
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// promises
// ---------------------------------------------------------------------------
class CancelPromiseAction extends Action<{ type: string; id: string }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.cancel_promise, op, data, index);
  }
  validate() {
    const v = this.svc.promiseManager.validateCancelPromise({ type: this.params.type, id: this.params.id }, this);
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    return this.svc.promiseManager.cancelPromise({ type: this.params.type, id: this.params.id }, this);
  }
}

class CompletePromiseAction extends Action<{ type: string; id: string }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.complete_promise, op, data, index);
  }
  validate() {
    const v = this.svc.promiseManager.validateCompletePromise({ type: this.params.type, id: this.params.id }, this);
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    return this.svc.promiseManager.completePromise({ type: this.params.type, id: this.params.id }, this);
  }
}

class ReversePromiseAction extends Action<{ type: string; id: string }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.reverse_promise, op, data, index);
  }
  validate() {
    const v = this.svc.promiseManager.validateReversePromise({ type: this.params.type, id: this.params.id }, this);
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    return this.svc.promiseManager.reversePromise({ type: this.params.type, id: this.params.id }, this);
  }
}

type CreatePromiseParams = { controllers: string[]; type: string; id?: string | null; fulfill_timeout_seconds?: number; params?: unknown };

class LegacyCreatePromiseAction extends AdminAction<CreatePromiseParams> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(svc.config, S.create_promise_legacy, op, data, index);
  }
  override validate() {
    if (!super.validate()) return false;
    const v = this.svc.promiseManager.validateCreatePromise(
      { type: this.params.type, id: this.params.id!, controllers: this.params.controllers, params: this.params.params, fulfill_timeout_seconds: this.params.fulfill_timeout_seconds },
      this,
    );
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    return this.svc.promiseManager.createPromise(
      { type: this.params.type, id: this.params.id!, controllers: this.params.controllers, params: this.params.params, fulfill_timeout_seconds: this.params.fulfill_timeout_seconds },
      this,
    );
  }
}

class CreatePromiseAction extends Action<CreatePromiseParams> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.create_promise, op, data, index);
  }
  validate() {
    const v = this.svc.promiseManager.validateCreatePromise(
      { type: this.params.type, id: this.params.id ?? null, controllers: this.params.controllers, params: this.params.params, fulfill_timeout_seconds: this.params.fulfill_timeout_seconds },
      this,
    );
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    return this.svc.promiseManager.createPromise(
      { type: this.params.type, id: this.params.id ?? null, controllers: this.params.controllers, params: this.params.params, fulfill_timeout_seconds: this.params.fulfill_timeout_seconds },
      this,
    );
  }
}

class ExpirePromisesAction extends Action<{ now: Date }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.expire_promises, op, data, index);
  }
  validate() {
    return true;
  }
  process() {
    return this.svc.promiseManager.expirePromises(this.params.now, this);
  }
}

class ExpireRentalDelegationsAction extends Action<{ block_num: number }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.expire_rental_delegations, op, data, index);
  }
  validate() {
    return true;
  }
  process() {
    const logs: EventLog[] = [];
    for (const rental of this.svc.rentals.getExpiredRentals(this.params.block_num)) {
      logs.push(
        ...this.svc.delegationManager.undelegate(
          { account: rental.lender, to: rental.lender, from: rental.borrower, qty: rental.qty, token: rental.token, skipDateUpdate: true },
          this,
        ),
      );
      logs.push(...this.svc.rentals.updateStatus(rental.id, "expired", this));
    }
    return logs;
  }
}

class FulfillPromiseAction extends Action<{ type: string; id: string; metadata?: unknown }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.fulfill_promise, op, data, index);
  }
  validate() {
    const v = this.svc.promiseManager.validateFulfillPromise({ type: this.params.type, id: this.params.id, metadata: this.params.metadata }, this);
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    return this.svc.promiseManager.fulfillPromise({ type: this.params.type, id: this.params.id, metadata: this.params.metadata }, this);
  }
}

class FulfillPromisesAction extends Action<{ type: string; ids: string[]; metadata?: unknown }> {
  constructor(op: Op, data: unknown, index: number, private readonly svc: Services) {
    super(S.fulfill_promise_multi, op, data, index);
  }
  validate() {
    const v = this.svc.promiseManager.validateFulfillPromises({ type: this.params.type, ids: this.params.ids, metadata: this.params.metadata }, this);
    if (!v.ok) throw v.error;
    return true;
  }
  process() {
    return this.svc.promiseManager.fulfillPromises({ type: this.params.type, ids: this.params.ids, metadata: this.params.metadata }, this);
  }
}

// ---------------------------------------------------------------------------
// pools (admin-only; the PoolManager is not ported — admins never use it now)
// ---------------------------------------------------------------------------
class UnsupportedAdminAction extends AdminAction<unknown> {
  constructor(schema: S.Schema<any>, op: Op, data: unknown, index: number, svc: Services) {
    super(svc.config, schema, op, data, index);
  }
  process(): EventLog[] {
    throw new UnsupportedPathError(`${this.action_name} by admin is not ported`);
  }
}

class ClaimPoolAction extends Action<{ now: Date }> {
  constructor(op: Op, data: unknown, index?: number) {
    super(S.claim_pool, op, data, index);
  }
  validate() {
    return true;
  }
  process(): EventLog[] {
    throw new UnsupportedPathError("claim_pool");
  }
}

class TransitionAction extends Action<{ block_num: number }> {
  constructor(schema: S.Schema<any>, op: Op, data: unknown, index: number, private readonly svc: Services, private readonly point: keyof typeof import("../repos/transitions.mjs").TRANSITION_POINTS) {
    super(schema, op, data, index);
  }
  override isSupported() {
    return this.op.account === this.svc.transitions.transitionAccount && this.svc.transitions.isTransitionPoint(this.point, this.op.block_num);
  }
  validate() {
    return true;
  }
  process(): EventLog[] {
    switch (this.action_name) {
      case "transition_fix_vote_weight":
        return T.fixVoteWeight(this.svc, this);
      case "transition_cleanup_lite_accounts":
        return T.cleanupLiteAccounts(this.svc, this);
      case "transition_balance_token_staking_spsp":
        return T.balanceTokenStakingAccount(this.svc, this);
      case "transition_adjust_token_distribution_strategy":
        return T.adjustTokenDistributionStrategy(this.svc, this);
      case "transition_cancel_delegation_promises":
        return T.cancelDelegationPromises(this.svc, this);
      default:
        throw new UnsupportedPathError(`transition ${this.action_name}`);
    }
  }
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
type Route = { name: string; factory: ActionFactory; from?: () => number; to?: () => number };

export class ActionRouter {
  private readonly main: Route[];
  private readonly virtual: Route[];

  constructor(private readonly svc: Services) {
    const f = (ctor: new (op: Op, data: unknown, index: number, svc: Services) => ExecutableAction): ActionFactory => {
      return (op, data, index = 0) => new ctor(op, data, index, svc);
    };
    const priceFeedStart = () => {
      const c = svc.config.validator;
      if (c === undefined) return Number.MAX_SAFE_INTEGER;
      return Math.max(c.reward_start_block, c.paused_until_block);
    };
    const delegationOfferBlock = () => svc.transitions.transitionPoints.delegation_offer_block;
    this.main = [
      { name: "test", factory: (op, data, index) => new TestAction(op, data, index), from: () => 100 },
      { name: "token_transfer", factory: f(TokenTransferAction) },
      { name: "delegate_tokens", factory: f(DelegateTokensAction) },
      { name: "undelegate_tokens", factory: f(UndelegateTokensAction) },
      { name: "undelegate_tokens_multi", factory: f(UndelegateTokensMultiAction) },
      { name: "return_tokens", factory: f(ReturnTokensAction) },
      { name: "stake_tokens", factory: f(StakeTokensAction) },
      { name: "stake_tokens_multi", factory: f(StakeTokensMultiAction) },
      { name: "cancel_unstake_tokens", factory: f(CancelUnstakeTokensAction) },
      { name: "approve_validator", factory: f(ApproveValidatorAction) },
      { name: "unstake_tokens", factory: f(UnstakeTokensAction) },
      { name: "claim_staking_rewards", factory: f(ClaimStakingRewardsAction) },
      { name: "unapprove_validator", factory: f(UnapproveValidatorAction) },
      { name: "validate_block", factory: f(ValidateBlockAction) },
      { name: "config_update", factory: f(ConfigUpdateAction) },
      { name: "update_validator", factory: f(UpdateValidatorAction) },
      { name: "token_award", factory: f(TokenAwardAction) },
      { name: "price_feed", factory: (op, data, index) => new LegacyAdminPriceFeedAction(op, data, index, svc), to: priceFeedStart },
      { name: "price_feed", factory: f(TopPriceFeedAction), from: priceFeedStart },
      { name: "token_transfer_multi", factory: f(TokenTransferMultiAction) },
      { name: "shop_purchase", factory: f(ShopPurchaseAction) },
      { name: "add_pool", factory: (op, data, index = 0) => new UnsupportedAdminAction(S.add_pool, op, data, index, svc) },
      { name: "update_pool", factory: (op, data, index = 0) => new UnsupportedAdminAction(S.update_pool, op, data, index, svc) },
      { name: "disable_pool", factory: (op, data, index = 0) => new UnsupportedAdminAction(S.disable_pool, op, data, index, svc) },
      { name: "set_authority", factory: f(SetAuthorityAction) },
      { name: "create_promise", factory: f(LegacyCreatePromiseAction), to: delegationOfferBlock },
      { name: "create_promise", factory: f(CreatePromiseAction), from: delegationOfferBlock },
      { name: "fulfill_promise", factory: f(FulfillPromiseAction) },
      { name: "fulfill_promise_multi", factory: f(FulfillPromisesAction) },
      { name: "reverse_promise", factory: f(ReversePromiseAction) },
      { name: "cancel_promise", factory: f(CancelPromiseAction) },
      { name: "complete_promise", factory: f(CompletePromiseAction) },
      { name: "activate_license", factory: f(ActivateLicenseAction) },
      { name: "deactivate_license", factory: f(DeactivateLicenseAction) },
      { name: "check_in_validator", factory: f(CheckInValidatorAction) },
    ];
    const t = (name: string, schema: S.Schema<any>, point: Parameters<typeof svc.transitions.isTransitionPoint>[0]): Route => ({
      name,
      factory: (op, data, index = 0) => new TransitionAction(schema, op, data, index, svc, point),
    });
    this.virtual = [
      { name: "token_unstaking", factory: f(TokenUnstakingAction) },
      { name: "claim_pool", factory: (op, data, index) => new ClaimPoolAction(op, data, index) },
      { name: "burn", factory: f(BurnAction) },
      { name: "expire_promises", factory: f(ExpirePromisesAction) },
      { name: "expire_rental_delegations", factory: f(ExpireRentalDelegationsAction) },
      { name: "expire_check_ins", factory: f(ExpireCheckInsAction) },
      { name: "update_missed_blocks", factory: f(UpdateMissedBlocksAction) },
      t("transition_fix_vote_weight", S.transition_fix_vote_weight, "fix_vote_weight"),
      t("transition_cleanup_lite_accounts", S.transition_cleanup_lite_accounts, "validator_transition_cleanup"),
      t("transition_balance_token_staking_spsp", S.transition_balance_token_staking_spsp, "validator_transition_cleanup"),
      t("transition_adjust_token_distribution_strategy", S.transition_adjust_token_distribution_strategy, "adjust_token_distribution_strategy"),
      t("transition_cancel_delegation_promises", S.transition_cancel_delegation_promises, "delegation_offer_block"),
    ];
  }

  route(block_num: number, name: string, isVirtual: boolean): ActionFactory | null {
    const routes = isVirtual ? this.virtual : this.main;
    for (const r of routes) {
      if (r.name !== name) continue;
      if (r.from !== undefined && block_num < r.from()) continue;
      if (r.to !== undefined && block_num >= r.to()) continue;
      return r.factory;
    }
    return null;
  }
}

export { ValidationError };
