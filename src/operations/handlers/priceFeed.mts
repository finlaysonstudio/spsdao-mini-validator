import type { OperationResult, EventLog } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";

export function handlePriceFeed(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const player = action.players[0];

  // Verify the player is a validator
  const validator = ctx.state.validators.get(player);
  if (!validator || !validator.is_active) {
    return errorResult(1, "Not an active validator");
  }

  // Params can be { updates: [{ token, price }] } or flat { token, token_price }
  const updates = action.params.updates as
    | { token: string; price: number }[]
    | undefined;

  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return errorResult(1, "Missing updates");
  }

  const events: EventLog[] = [];

  for (const update of updates) {
    const { token, price } = update;
    if (!token || price === undefined) continue;

    // Round to 6 decimal places to match upstream
    const roundedPrice = +(price).toFixed(6);

    ctx.state.priceHistory.add({
      validator: player,
      token,
      block_num: ctx.blockNum,
      block_time: ctx.blockTime,
      token_price: roundedPrice,
    });

    events.push({
      object_type: "price_history",
      event_type: "upsert",
      data: {
        validator: player,
        token,
        block_num: ctx.blockNum,
        block_time: ctx.blockTime.toJSON(),
        token_price: roundedPrice,
      },
    });
  }

  return successResult(events);
}
