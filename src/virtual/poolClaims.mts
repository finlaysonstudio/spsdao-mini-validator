import { round3 } from "../state/index.mjs";
import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult, EventLog } from "../types.mjs";

export function generatePoolClaims(
  state: StateStore,
  blockNum: number,
  _blockTime: Date,
): { action: ParsedAction; result: OperationResult }[] {
  const pools = state.pools.getActivePools();
  const results: { action: ParsedAction; result: OperationResult }[] = [];

  for (const pool of pools) {
    if (pool.tokens_per_block <= 0) continue;
    if (blockNum <= pool.last_reward_block) continue;

    const blocksElapsed = blockNum - pool.last_reward_block;
    const totalStaked = state.balances.totalSupply(pool.token);

    if (totalStaked <= 0) {
      pool.last_reward_block = blockNum;
      state.pools.setPool(pool);
      continue;
    }

    const reward = round3(blocksElapsed * pool.tokens_per_block);
    const accPerShare = pool.acc_tokens_per_share + reward / totalStaked;

    pool.acc_tokens_per_share = accPerShare;
    pool.last_reward_block = blockNum;
    state.pools.setPool(pool);

    const events: EventLog[] = [
      {
        type: "pool_reward",
        data: {
          pool: pool.name,
          reward,
          acc_tokens_per_share: accPerShare,
        },
      },
    ];

    results.push({
      action: {
        name: "claim_pool",
        players: ["$POOL"],
        params: { pool_name: pool.name, reward },
        trxId: `sl_claim_pool_${pool.name}_${blockNum}`,
        opIndex: 0,
        actionIndex: results.length,
      },
      result: { success: true, events },
    });
  }

  return results;
}
