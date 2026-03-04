import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";

export function handleAddPool(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { name, token, reward_token, tokens_per_block } = action.params as {
    name?: string;
    token?: string;
    reward_token?: string;
    tokens_per_block?: number;
  };

  if (!name || !token || !reward_token) {
    return errorResult(1, "Missing pool params");
  }

  const existing = ctx.state.pools.getPool(name);
  if (existing) {
    return errorResult(2, "Pool already exists");
  }

  ctx.state.pools.setPool({
    name,
    token,
    reward_token,
    tokens_per_block: tokens_per_block ?? 0,
    start_block: ctx.blockNum,
    acc_tokens_per_share: 0,
    last_reward_block: ctx.blockNum,
    is_active: true,
  });

  return successResult([
    {
      object_type: "staking_pools",
      event_type: "insert",
      data: { name, token, reward_token },
    },
  ]);
}

export function handleUpdatePool(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { name, tokens_per_block } = action.params as {
    name?: string;
    tokens_per_block?: number;
  };

  if (!name) {
    return errorResult(1, "Missing pool name");
  }

  const pool = ctx.state.pools.getPool(name);
  if (!pool) {
    return errorResult(2, "Pool not found");
  }

  if (tokens_per_block !== undefined) {
    pool.tokens_per_block = tokens_per_block;
  }

  ctx.state.pools.setPool(pool);

  return successResult([
    { object_type: "staking_pools", event_type: "update", data: { name } },
  ]);
}

export function handleDisablePool(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { name } = action.params as { name?: string };

  if (!name) {
    return errorResult(1, "Missing pool name");
  }

  const pool = ctx.state.pools.getPool(name);
  if (!pool) {
    return errorResult(2, "Pool not found");
  }

  pool.is_active = false;
  ctx.state.pools.setPool(pool);

  return successResult([
    { object_type: "staking_pools", event_type: "update", data: { name } },
  ]);
}
