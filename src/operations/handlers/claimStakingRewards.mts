import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult, balanceEvent } from "../types.mjs";

export function handleClaimStakingRewards(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { token } = action.params as { token?: string };
  const player = action.players[0];

  if (!token) {
    return errorResult(1, "Missing token");
  }

  const stakeToken = `${token}P`;
  const stakedBalance = ctx.state.balances.get(player, stakeToken);
  const delegatedIn = ctx.state.balances.get(player, `${stakeToken}-IN`);
  const totalStaked = round3(stakedBalance + delegatedIn);

  if (totalStaked <= 0) {
    return errorResult(2, "No staked balance");
  }

  // Find the staking pool for this token
  const pools = ctx.state.pools.getActivePools();
  const stakingPool = pools.find(
    (p) => p.token === stakeToken && p.reward_token === token,
  );

  if (!stakingPool) {
    return errorResult(3, "No staking pool found");
  }

  const accPerShare = stakingPool.acc_tokens_per_share;
  const rewardDebt = ctx.state.pools.getRewardDebt(player, stakingPool.name);

  const pending = round3(totalStaked * accPerShare - rewardDebt);

  if (pending <= 0) {
    return successResult([]);
  }

  ctx.state.balances.add(player, token, pending);
  ctx.state.pools.setRewardDebt(
    player,
    stakingPool.name,
    round3(totalStaked * accPerShare),
  );

  return successResult([balanceEvent(player, token, pending)]);
}
