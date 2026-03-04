import type { OperationResult, EventLog } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "../balanceOps.mjs";

/**
 * Calculate block reward using the per_block_capped formula.
 * Matches upstream BlockProcessor.calculateBlockReward.
 */
function calculateBlockReward(ctx: ActionContext): {
  reward: number;
  token: string;
} | null {
  const tokensPerBlock = ctx.state.config.getNumber(
    "validator",
    "tokens_per_block",
    0,
  );
  const rewardStartBlock = ctx.state.config.getNumber(
    "validator",
    "reward_start_block",
    0,
  );

  const elapsed = ctx.blockNum - rewardStartBlock;
  if (elapsed < 0) return null;

  const rewardVersion = ctx.state.config.getString(
    "validator",
    "reward_version",
    "",
  );
  const token =
    ctx.state.config.getString("validator", "reward_token", "") || "SPS";

  if (rewardVersion === "per_block_capped") {
    // Dynamic reward based on remaining pool balance
    const BLOCKS_PER_MONTH = 864000;
    const balance = ctx.state.balances.get("$VALIDATOR_REWARDS", token);
    const Y = balance / BLOCKS_PER_MONTH;
    const X = tokensPerBlock;
    const o1 = X * 0.7;
    const o2 = Math.min(Y * 0.05, X * 0.9);
    const reward = Math.max(o1, o2);
    return { reward, token };
  } else {
    // Legacy reduction formula
    const reductionBlocks = ctx.state.config.getNumber(
      "validator",
      "reduction_blocks",
      0,
    );
    const reductionPct = ctx.state.config.getNumber(
      "validator",
      "reduction_pct",
      0,
    );
    let reward = tokensPerBlock;
    if (reductionBlocks > 0 && reductionPct > 0 && elapsed > 0) {
      const periods = parseInt(`${elapsed / reductionBlocks}`);
      reward = +(
        tokensPerBlock *
        (1 - (periods * reductionPct) / 100)
      ).toFixed(3);
    }
    return { reward, token };
  }
}

export function handleValidateBlock(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { block_num, hash, version } = action.params as {
    block_num?: number;
    hash?: string;
    version?: string;
  };
  const player = action.players[0];

  if (block_num === undefined || !hash) {
    return errorResult(1, "Missing block_num or hash");
  }

  const maxAge = ctx.state.config.getNumber("validator", "max_block_age", 100);
  if (ctx.blockNum - block_num > maxAge) {
    return errorResult(2, "Block too old to validate");
  }

  // Verify the validator is the selected validator for the referenced block
  const refBlock = ctx.state.blocks.get(block_num);
  if (refBlock && refBlock.l2_block_id !== hash) {
    return errorResult(3, "Hash mismatch");
  }

  let events: EventLog[] = [];

  // Update block record with validator and validation_tx
  if (refBlock) {
    refBlock.validator = player;
    refBlock.validation_tx = action.trxId;
    ctx.state.blocks.set(refBlock);

    events.push({
      object_type: "blocks",
      event_type: "update",
      data: {
        block_num: refBlock.block_num,
        block_id: refBlock.block_id,
        prev_block_id: refBlock.prev_block_id,
        l2_block_id: refBlock.l2_block_id,
        block_time: refBlock.block_time.toJSON(),
        validator: player,
        validation_tx: action.trxId,
      },
    });
  }

  // Calculate and distribute validator reward
  const blockReward = calculateBlockReward(ctx);
  if (blockReward && blockReward.reward > 0 && refBlock) {
    const { reward, token } = blockReward;

    // Get the validator's reward account
    const validator = ctx.state.validators.get(player);
    const rewardAccount = validator?.reward_account ?? player;

    const sub = subtractBalance(
      ctx,
      "$VALIDATOR_REWARDS",
      token,
      reward,
      rewardAccount,
    );
    if (sub) {
      const add = addBalance(ctx, rewardAccount, token, reward, "$VALIDATOR_REWARDS");
      events = combineBalanceEvents(events, sub, add);
    }
  }

  // Update validator version if changed
  if (version) {
    const validator = ctx.state.validators.get(player);
    if (validator && validator.last_version !== version) {
      validator.last_version = version;
      ctx.state.validators.set(validator);

      events.push({
        object_type: "validators",
        event_type: "update",
        data: {
          account_name: validator.account_name,
          is_active: validator.is_active,
          post_url: validator.post_url,
          api_url: validator.api_url,
          total_votes: validator.total_votes,
          missed_blocks: validator.missed_blocks,
          reward_account: validator.reward_account,
          last_version: validator.last_version,
        },
      });
    }
  }

  return successResult(events);
}
