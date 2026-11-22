import { sha256 } from "js-sha256";
import type { CheckInRow, StateStore } from "../state/index.mjs";
import type { BlockRef, ProcessResult } from "../types.mjs";
import { EventLog } from "../types.mjs";
import { pgCompare } from "../util/collate.mjs";
import { warn } from "../util/log.mjs";
import type { BalanceRepository } from "./balance.mjs";
import type { BlockRepository } from "./blocks.mjs";
import type { ConfigLoader } from "./config.mjs";
import { ACCOUNTS, TOKENS, type IAction } from "./context.mjs";
import type { StakingRewardsRepository } from "./staking_rewards.mjs";

function rowData(r: CheckInRow) {
  return { account: r.account, status: r.status, last_check_in_block_num: r.last_check_in_block_num, last_check_in: r.last_check_in };
}

export class CheckInRepository {
  constructor(private readonly state: StateStore) {}

  getByAccount(account: string): CheckInRow | undefined {
    return this.state.checkIns.get(account);
  }

  upsert(check_in: CheckInRow): EventLog {
    let row = this.state.checkIns.get(check_in.account);
    if (!row) {
      row = { ...check_in };
      this.state.checkIns.set(row);
    } else {
      row.status = check_in.status;
      row.last_check_in_block_num = check_in.last_check_in_block_num;
      row.last_check_in = check_in.last_check_in;
    }
    return new EventLog("upsert", "validator_check_in", rowData(row));
  }

  countExpired(block_num: number): number {
    return this.state.checkIns.all().filter((r) => r.last_check_in_block_num < block_num && r.status === "active").length;
  }

  getExpired(block_num: number): CheckInRow[] {
    return this.state.checkIns
      .all()
      .filter((r) => r.last_check_in_block_num < block_num && r.status === "active")
      .sort((a, b) => a.last_check_in_block_num - b.last_check_in_block_num || pgCompare(a.account, b.account));
  }

  setInactive(account: string): EventLog {
    const row = this.state.checkIns.get(account);
    if (!row) throw new Error(`check-in for ${account} not found`);
    row.status = "inactive";
    return new EventLog("update", "validator_check_in", rowData(row));
  }
}

export type ValidatorCheckInEntry = {
  account: string;
  can_check_in: boolean;
  is_valid: boolean;
  last_check_in_block_num?: number;
  last_check_in?: Date;
};

export class LicenseManager {
  static readonly LICENSE_MANAGER_ACCOUNT = ACCOUNTS.LICENSE_MANAGER;

  constructor(
    private readonly customJsonId: string,
    private readonly checkIns: CheckInRepository,
    private readonly stakingRewards: StakingRewardsRepository,
    private readonly balances: BalanceRepository,
    private readonly config: ConfigLoader,
    private readonly blocks: BlockRepository,
  ) {}

  private get cfg() {
    return this.config.validator_check_in;
  }

  process(block: BlockRef): ProcessResult[] {
    if (this.cfg === undefined) {
      warn("Invalid check in config. Ignoring check in expiration.");
      return [];
    }
    const expiredBlockNum = this.getExpiredBlockNum(block.block_num);
    if (this.checkIns.countExpired(expiredBlockNum) === 0) return [];
    return [
      [
        "custom_json",
        {
          required_auths: [LicenseManager.LICENSE_MANAGER_ACCOUNT],
          required_posting_auths: [],
          id: this.customJsonId,
          json: { action: "expire_check_ins", params: {} },
        },
      ],
    ];
  }

  trx_id(block: BlockRef): string {
    return `sl_expire_check_ins_${block.block_num}`;
  }

  getLicenses(account: string): { activatedLicenses: number; licenses: number } {
    const activatedLicenses = this.balances.getBalance(account, TOKENS.ACTIVATED_LICENSE);
    const licenses = this.balances.getBalance(account, TOKENS.LICENSE);
    return { activatedLicenses, licenses };
  }

  activateLicenses(action: IAction, account: string, qty: number): EventLog[] {
    if (this.cfg === undefined) return [];
    const results: EventLog[] = [];
    results.push(...this.balances.updateBalance(action, account, LicenseManager.LICENSE_MANAGER_ACCOUNT, TOKENS.LICENSE, qty, "activate_license"));
    results.push(...this.balances.updateBalance(action, LicenseManager.LICENSE_MANAGER_ACCOUNT, account, TOKENS.ACTIVATED_LICENSE, qty, "activate_license"));
    if (this.hasValidCheckIn(account, action.op.block_num)) results.push(...this.syncActivatedLicenses(account, action));
    return results;
  }

  deactivateLicenses(action: IAction, account: string, qty: number): EventLog[] {
    if (this.cfg === undefined) return [];
    const results: EventLog[] = [];
    results.push(...this.balances.updateBalance(action, account, LicenseManager.LICENSE_MANAGER_ACCOUNT, TOKENS.ACTIVATED_LICENSE, qty, "deactivate_license"));
    results.push(...this.balances.updateBalance(action, LicenseManager.LICENSE_MANAGER_ACCOUNT, account, TOKENS.LICENSE, qty, "deactivate_license"));
    if (this.hasValidCheckIn(account, action.op.block_num)) results.push(...this.syncActivatedLicenses(account, action));
    return results;
  }

  hasValidCheckIn(account: string, block_num: number): boolean {
    const checkIn = this.checkIns.getByAccount(account);
    if (!checkIn) return false;
    return this.isCheckInValid(block_num, checkIn);
  }

  private syncActivatedLicenses(account: string, action: IAction): EventLog[] {
    const results: EventLog[] = [];
    const balance = this.balances.getBalance(account, TOKENS.ACTIVATED_LICENSE);
    const stakedBalance = this.balances.getBalance(account, TOKENS.RUNNING_LICENSE);
    if (balance > stakedBalance) {
      const qty = balance - stakedBalance;
      results.push(...this.stakingRewards.claimAll(account, [qty, TOKENS.RUNNING_LICENSE], action));
      results.push(...this.balances.updateBalance(action, ACCOUNTS.STAKING, account, TOKENS.RUNNING_LICENSE, qty, "sync_running_license"));
    } else if (balance < stakedBalance) {
      const qty = stakedBalance - balance;
      results.push(...this.stakingRewards.claimAll(account, [qty * -1, TOKENS.RUNNING_LICENSE], action));
      results.push(...this.balances.updateBalance(action, account, ACCOUNTS.STAKING, TOKENS.RUNNING_LICENSE, qty, "sync_running_license"));
    }
    return results;
  }

  getCheckIn(account: string, block_num: number): ValidatorCheckInEntry {
    const cfg = this.cfg;
    if (cfg === undefined) return { account, can_check_in: false, is_valid: false };
    const poolPaused = block_num < cfg.paused_until_block;
    const checkIn = this.checkIns.getByAccount(account);
    const activatedLicenses = this.balances.getBalance(account, TOKENS.ACTIVATED_LICENSE);
    if (!checkIn) return { account, can_check_in: !poolPaused && activatedLicenses > 0, is_valid: false };
    const canCheckIn = activatedLicenses > 0 && !poolPaused && block_num - checkIn.last_check_in_block_num >= cfg.check_in_interval_blocks;
    return {
      account,
      can_check_in: canCheckIn,
      is_valid: this.isCheckInValid(block_num, checkIn),
      last_check_in_block_num: checkIn.last_check_in_block_num,
      last_check_in: checkIn.last_check_in,
    };
  }

  checkIn(action: IAction, account: string): EventLog[] {
    const cfg = this.cfg;
    if (cfg === undefined) return [];
    if (cfg.paused_until_block > action.op.block_num) return [];
    const results: EventLog[] = [];
    results.push(this.checkIns.upsert({ account, status: "active", last_check_in_block_num: action.op.block_num, last_check_in: action.op.block_time }));
    results.push(...this.syncActivatedLicenses(account, action));
    return results;
  }

  expireCheckIns(action: IAction): EventLog[] {
    if (this.cfg === undefined) return [];
    const results: EventLog[] = [];
    const expiredBlockNum = this.getExpiredBlockNum(action.op.block_num);
    for (const checkIn of this.checkIns.getExpired(expiredBlockNum)) {
      results.push(...this.expireCheckIn(checkIn.account, action));
    }
    return results;
  }

  private getExpiredBlockNum(block_num: number): number {
    return block_num - this.cfg!.check_in_window_blocks - this.cfg!.check_in_interval_blocks;
  }

  expireCheckIn(account: string, action: IAction): EventLog[] {
    const checkIn = this.checkIns.getByAccount(account);
    if (!checkIn) return [];
    const results: EventLog[] = [];
    results.push(this.checkIns.setInactive(account));
    const stakedBalance = this.balances.getBalance(account, TOKENS.RUNNING_LICENSE);
    if (stakedBalance > 0) {
      results.push(...this.stakingRewards.claimAll(account, [stakedBalance * -1, TOKENS.RUNNING_LICENSE], action));
      results.push(...this.balances.updateBalance(action, account, ACCOUNTS.STAKING, TOKENS.RUNNING_LICENSE, stakedBalance, "sync_running_license"));
    }
    return results;
  }

  private isCheckInValid(block_num: number, check_in: CheckInRow): boolean {
    const checkInAge = block_num - check_in.last_check_in_block_num;
    const validCheckIn = checkInAge <= this.cfg!.check_in_window_blocks + this.cfg!.check_in_interval_blocks;
    return check_in.status === "active" && validCheckIn;
  }

  getCheckInHashForBlockNum(block_num: number, account: string): string | undefined {
    const block = this.blocks.getBlockHash(block_num);
    if (!block) return undefined;
    return this.getCheckInHash(block.l2_block_id, account);
  }

  isCheckInBlockWithinWindow(current_block_num: number, check_in_block_num: number): boolean {
    if (!this.cfg) return false;
    return current_block_num - check_in_block_num <= this.cfg.check_in_window_blocks;
  }

  getCheckInHash(block_hash: string, account: string): string {
    return sha256(`${block_hash}${account}`);
  }
}
