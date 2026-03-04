import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";

export function handlePriceFeed(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { token, token_price } = action.params as {
    token?: string;
    token_price?: number;
  };
  const player = action.players[0];

  if (!token || token_price === undefined) {
    return errorResult(1, "Missing token or price");
  }

  // Verify the player is a validator
  const validator = ctx.state.validators.get(player);
  if (!validator || !validator.is_active) {
    return errorResult(2, "Not an active validator");
  }

  ctx.state.priceHistory.add({
    validator: player,
    token,
    block_num: ctx.blockNum,
    block_time: ctx.blockTime,
    token_price,
  });

  return successResult([
    {
      object_type: "price_history",
      event_type: "insert",
      data: { validator: player, token, price: token_price },
    },
  ]);
}
