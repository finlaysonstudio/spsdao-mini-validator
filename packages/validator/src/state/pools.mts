import { round3 } from "./balances.mjs";

export interface Pool {
  name: string;
  token: string;
  reward_token: string;
  tokens_per_block: number;
  start_block: number;
  acc_tokens_per_share: number;
  last_reward_block: number;
  is_active: boolean;
}

export interface RewardDebt {
  player: string;
  pool_name: string;
  reward_debt: number;
}

export class PoolStore {
  private pools = new Map<string, Pool>();
  private rewardDebts = new Map<string, RewardDebt>();

  getPool(name: string): Pool | undefined {
    return this.pools.get(name);
  }

  setPool(pool: Pool): void {
    this.pools.set(pool.name, pool);
  }

  getActivePools(): Pool[] {
    return Array.from(this.pools.values()).filter((p) => p.is_active);
  }

  getAllPools(): Pool[] {
    return Array.from(this.pools.values());
  }

  private debtKey(player: string, poolName: string): string {
    return `${player}:${poolName}`;
  }

  getRewardDebt(player: string, poolName: string): number {
    return (
      this.rewardDebts.get(this.debtKey(player, poolName))?.reward_debt ?? 0
    );
  }

  setRewardDebt(player: string, poolName: string, debt: number): void {
    this.rewardDebts.set(this.debtKey(player, poolName), {
      player,
      pool_name: poolName,
      reward_debt: round3(debt),
    });
  }

  getAllRewardDebts(): RewardDebt[] {
    return Array.from(this.rewardDebts.values());
  }

  load(pools: Partial<Pool>[], rewardDebts?: Partial<RewardDebt>[]): void {
    for (const p of pools) {
      if (!p.name) continue;
      this.setPool({
        name: p.name,
        token: p.token ?? "",
        reward_token: p.reward_token ?? "",
        tokens_per_block: p.tokens_per_block ?? 0,
        start_block: p.start_block ?? 0,
        acc_tokens_per_share: p.acc_tokens_per_share ?? 0,
        last_reward_block: p.last_reward_block ?? 0,
        is_active: p.is_active ?? true,
      });
    }
    if (rewardDebts) {
      for (const rd of rewardDebts) {
        if (!rd.player || !rd.pool_name) continue;
        this.setRewardDebt(rd.player, rd.pool_name, rd.reward_debt ?? 0);
      }
    }
  }
}
