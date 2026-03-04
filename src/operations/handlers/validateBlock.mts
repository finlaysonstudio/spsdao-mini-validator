import type { OperationResult, EventLog } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "../balanceOps.mjs";

export function handleValidateBlock(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { block_num, hash } = action.params as {
    block_num?: number;
    hash?: string;
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

  const otherEvents: EventLog[] = [];

  // Update block record with validator and validation_tx
  if (refBlock) {
    refBlock.validator = player;
    refBlock.validation_tx = action.trxId;
    ctx.state.blocks.set(refBlock);

    otherEvents.push({
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
  const tokensPerBlock = ctx.state.config.getNumber(
    "validator",
    "tokens_per_block",
    0,
  );
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
  const rewardStartBlock = ctx.state.config.getNumber(
    "validator",
    "reward_start_block",
    0,
  );

  if (tokensPerBlock > 0 && refBlock) {
    let reward = tokensPerBlock;

    if (reductionBlocks > 0 && reductionPct > 0 && rewardStartBlock > 0) {
      const elapsed = refBlock.block_num - rewardStartBlock;
      if (elapsed > 0) {
        const periods = Math.floor(elapsed / reductionBlocks);
        if (periods > 0) {
          reward =
            tokensPerBlock * (1 - ((periods - 1) * reductionPct) / 100);
        }
      }
    }

    if (reward > 0) {
      // Get the validator's reward account
      const validator = ctx.state.validators.get(player);
      const rewardAccount = validator?.reward_account ?? player;

      const sub = subtractBalance(
        ctx,
        "$VALIDATOR_REWARDS",
        "SPS",
        reward,
        rewardAccount,
      );
      if (sub) {
        const add = addBalance(
          ctx,
          rewardAccount,
          "SPS",
          reward,
          "$VALIDATOR_REWARDS",
        );
        return successResult(combineBalanceEvents(otherEvents, sub, add));
      }
    }
  }

  return successResult(otherEvents);
}
