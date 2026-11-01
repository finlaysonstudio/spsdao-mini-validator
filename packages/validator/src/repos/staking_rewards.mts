import type { StateStore } from "../state/index.mjs";
import { EventLog } from "../types.mjs";
import { warn } from "../util/log.mjs";
import { formatScaled, numberToScaled, scaledToNumber } from "../util/num.mjs";
import type { BalanceRepository } from "./balance.mjs";
import type { BlockRepository } from "./blocks.mjs";
import type { ConfigLoader, PoolSettings } from "./config.mjs";
import { ACCOUNTS, POOLS, type AwardPool, type IAction } from "./context.mjs";

export type StakingIncrease = [number, string] | 0;

export class StakingRewardsRepository {
  constructor(
    private readonly state: StateStore,
    private readonly config: ConfigLoader,
    private readonly balances: BalanceRepository,
    private readonly blocks: BlockRepository,
  ) {}

  claimAll(player: string, staking_increase: StakingIncrease, action: IAction): EventLog[] {
    const out: EventLog[] = [];
    for (const pool of POOLS) out.push(...this.claim(player, pool, staking_increase, action));
    return out;
  }

  claim(player: string, pool: AwardPool, staking_increase: StakingIncrease, action: IAction): EventLog[] {
    const [staking_amount, staking_token] = staking_increase === 0 ? [0, undefined] : staking_increase;
    const result: EventLog[] = this.updatePool(pool, action.op.block_num, action.op.block_time);
    if (staking_token && pool.stake !== staking_token) return result;

    const pool_name = pool.name;
    const acc_tokens_per_share: number = this.config.pools?.[`${pool_name}_acc_tokens_per_share`] || 0;
    const staked = this.balances.getBalance(player, pool.stake);

    if (staked > 0) {
      const reward_debt = this.getRewardDebt(pool_name, player);
      const accumulated_amount = staked * acc_tokens_per_share;
      const claim_amount = +(accumulated_amount - reward_debt).toFixed(3);
      if (claim_amount > 0) {
        result.push(...this.balances.updateBalance(action, pool.reward_account, player, pool.token, claim_amount, `claim_staking_rewards_${pool_name}`));
        const total_staked = -1 * this.balances.getBalance(ACCOUNTS.STAKING, pool.stake);
        result.push(
          new EventLog("insert", "staking_rewards_claim", {
            version: 2,
            player,
            pool_name,
            token: pool.token,
            amount: claim_amount,
            staked_amount: staked,
            accumulated_amount,
            reward_debt,
            total_staked,
          }),
        );
      }
    }

    result.push(this.upsertRewardDebt(player, pool_name, (staked + staking_amount) * acc_tokens_per_share));
    return result;
  }

  private upsertRewardDebt(player: string, pool_name: string, reward_debt: number): EventLog {
    const scaled = numberToScaled(reward_debt, 3);
    this.state.rewardDebts.set(pool_name, player, scaled);
    return new EventLog("upsert", "staking_pool_reward_debt", { player, pool_name, reward_debt: formatScaled(scaled, 3) });
  }

  updatePool(pool: AwardPool, block_num: number, block_time: Date): EventLog[] {
    const pools = this.config.pools;
    if (!pools) {
      warn("Attempting to update pool parameters while having misconfigured staking settings, ignoring.");
      return [];
    }
    const pool_name = pool.name;
    const pool_settings: PoolSettings = pools[pool_name];
    const last_reward_block: number = pools[`${pool_name}_last_reward_block`] || pool_settings.start_block;
    const stop_date_utc = pool_settings.stop_date_utc;
    let stop_block = pool_settings.stop_block;
    const stoppedByBlock = stop_block && block_num > stop_block;
    const results: EventLog[] = [];
    const stopDate = typeof stop_date_utc === "string" ? new Date(stop_date_utc) : stop_date_utc;

    if (stopDate && stopDate < block_time && !stoppedByBlock) {
      const lastBlock = this.blocks.getLastBlockNumBefore(stopDate);
      stop_block = lastBlock === null ? last_reward_block : lastBlock;
      results.push(...this.config.updateStopBlock(pool_name, stop_block));
    }

    const rewardBlock = stop_block === undefined ? block_num : Math.min(stop_block, block_num);
    const contribution = this.getPoolContribution(rewardBlock, last_reward_block, pool_settings, pool);
    if (contribution <= 0) return results;

    let acc_tokens_per_share: number = pools[`${pool_name}_acc_tokens_per_share`] || 0;
    const total_staked = -1 * this.balances.getBalance(ACCOUNTS.STAKING, pool.stake);

    results.push(...this.config.updateLastRewardBlock(pool_name, rewardBlock));
    if (total_staked !== 0 && this.poolAmountsValid(pool_settings)) {
      acc_tokens_per_share += contribution / total_staked;
      results.push(...this.config.updateAccTokensPerShare(pool_name, acc_tokens_per_share));
    }
    return results;
  }

  private poolAmountsValid(params: PoolSettings): boolean {
    if (params.type === "per_block" || params.type === undefined) return params.tokens_per_block !== 0;
    if (params.type === "per_block_capped") return params.tokens_per_block !== 0;
    return false;
  }

  private getPoolContribution(block_num: number, last_reward_block: number, params: PoolSettings, pool: AwardPool): number {
    if (block_num <= last_reward_block) return 0;
    if (params.type === "per_block_capped") {
      const blocks_per_month = 864000;
      const { pool_balance } = this.getPoolBalance(pool.name);
      const num_blocks = block_num - last_reward_block;
      const Y = (pool_balance / blocks_per_month) * num_blocks;
      const X = params.tokens_per_block * num_blocks;
      const o1 = X * 0.7;
      const o2 = Math.min(Y * 0.05, X * 0.9);
      return Math.max(o1, o2);
    } else if (params.type === "per_block" || params.type === undefined) {
      const total_decline = this.getPoolDecline(block_num, params);
      return (block_num - last_reward_block) * params.tokens_per_block * total_decline;
    }
    return 0;
  }

  getPoolBalance(pool_name: string): { reward_account_balance: number; outstanding_rewards: number; pool_balance: number } {
    const pool = POOLS.find((p) => p.name === pool_name);
    if (!pool) return { reward_account_balance: 0, outstanding_rewards: 0, pool_balance: 0 };
    const balance = this.balances.getBalance(pool.reward_account, pool.token);
    const outstanding_rewards = this.getOutstandingRewards(pool_name);
    return { reward_account_balance: balance, outstanding_rewards, pool_balance: balance - outstanding_rewards };
  }

  getOutstandingRewards(pool_name: string): number {
    const pool = POOLS.find((p) => p.name === pool_name);
    if (!pool) return 0;
    const total_staked = -1 * this.balances.getBalance(ACCOUNTS.STAKING, pool.stake);
    const acc_tokens_per_share: number = this.config.pools?.[`${pool_name}_acc_tokens_per_share`] || 0;
    if (total_staked <= 0) return 0;
    const total_reward_debt = this.getTotalRewardDebt(pool_name);
    return total_staked * acc_tokens_per_share - total_reward_debt;
  }

  private getPoolDecline(block_num: number, params: PoolSettings): number {
    if (!params.reduction_pct || !params.reduction_blocks) return 1;
    const total_reductions = Math.trunc((block_num - params.start_block) / params.reduction_blocks);
    const reduction_pct = 1 - params.reduction_pct / 100;
    return reduction_pct ** total_reductions;
  }

  getTotalRewardDebt(pool_name: string): number {
    // SUM() over an empty set is NULL → parseFloat(null) = NaN upstream; only happens with no rows
    if (!this.state.rewardDebts.hasPool(pool_name)) return NaN;
    return scaledToNumber(this.state.rewardDebts.sum(pool_name), 3);
  }

  getRewardDebt(pool_name: string, player: string): number {
    const v = this.state.rewardDebts.get(pool_name, player);
    const ret = v === undefined ? 0 : scaledToNumber(v, 3);
    return isNaN(ret) ? 0 : ret;
  }

  stakeTokens(action: IAction, fromPlayer: string, toPlayer: string, token: string, stakedToken: string, qty: number, actionName: string): EventLog[] {
    const claim_results = this.claimUnclaimedRewards(action, toPlayer, stakedToken, qty);
    const balance_results = this.updatedBalancesAfterStaking(action, fromPlayer, toPlayer, token, stakedToken, qty, actionName);
    return [...claim_results, ...balance_results];
  }

  claimUnclaimedRewards(action: IAction, toPlayer: string, stakedToken: string, qty: number): EventLog[] {
    return this.claimAll(toPlayer, [qty, stakedToken], action);
  }

  updatedBalancesAfterStaking(action: IAction, fromPlayer: string, toPlayer: string, token: string, stakedToken: string, qty: number, actionName: string): EventLog[] {
    const results: EventLog[] = [];
    if (qty > 0) {
      results.push(...this.balances.updateBalance(action, fromPlayer, ACCOUNTS.STAKING, token, qty, actionName));
      results.push(...this.balances.updateBalance(action, ACCOUNTS.STAKING, toPlayer, stakedToken, qty, actionName));
    }
    return results;
  }
}
