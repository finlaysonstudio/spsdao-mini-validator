import { sha256 } from "js-sha256";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";

export function handleCheckInValidator(
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

  const validator = ctx.state.validators.get(player);
  if (!validator) {
    return errorResult(2, "Validator not found");
  }

  // Verify the referenced block is within the check-in window
  const windowBlocks = ctx.state.config.getNumber(
    "validator_check_in",
    "check_in_window_blocks",
    300,
  );
  if (ctx.blockNum - block_num > windowBlocks) {
    return errorResult(3, "Referenced block is too old");
  }

  // Verify hash
  const refBlock = ctx.state.blocks.get(block_num);
  if (refBlock) {
    const expectedHash = sha256(refBlock.l2_block_id + player);
    if (hash !== expectedHash) {
      return errorResult(4, "Invalid check-in hash");
    }
  }

  ctx.state.checkIns.set({
    account: player,
    block_num: ctx.blockNum,
    hash,
  });

  return successResult([
    { type: "check_in", data: { account: player, block_num: ctx.blockNum } },
  ]);
}
