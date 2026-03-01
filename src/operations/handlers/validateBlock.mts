import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";

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

  return successResult([
    {
      type: "validate_block",
      data: { validator: player, block_num, hash },
    },
  ]);
}
