import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "../balanceOps.mjs";

export function handleCreatePromise(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const {
    id,
    type,
    params: promiseParams,
    expiration_block_num,
  } = action.params as {
    id?: string;
    type?: string;
    params?: Record<string, unknown>;
    expiration_block_num?: number;
  };
  const player = action.players[0];

  if (!id || !type) {
    return errorResult(1, "Missing promise id or type");
  }

  const existing = ctx.state.promises.get(id);
  if (existing) {
    return errorResult(2, "Promise already exists");
  }

  ctx.state.promises.set({
    id,
    type,
    controller: player,
    params: promiseParams ?? {},
    status: "open",
    created_block_num: ctx.blockNum,
    expiration_block_num,
  });

  return successResult([
    {
      object_type: "promises",
      event_type: "insert",
      data: { id, promise_type: type },
    },
  ]);
}

export function handleFulfillPromise(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { id } = action.params as { id?: string };
  const player = action.players[0];

  if (!id) {
    return errorResult(1, "Missing promise id");
  }

  const promise = ctx.state.promises.get(id);
  if (!promise || promise.status !== "open") {
    return errorResult(2, "Promise not found or not open");
  }

  promise.status = "fulfilled";
  promise.fulfilled_by = player;
  ctx.state.promises.set(promise);

  const otherEvents = [
    {
      object_type: "promises",
      event_type: "update",
      data: { id, fulfilled_by: player },
    },
  ];

  // Handle token escrow if applicable
  const { token, qty } = promise.params as { token?: string; qty?: number };
  if (token && qty) {
    const amount = round3(qty);
    const sub = subtractBalance(ctx, player, token, amount);
    if (!sub) {
      promise.status = "open";
      promise.fulfilled_by = undefined;
      ctx.state.promises.set(promise);
      return errorResult(3, "Insufficient balance for fulfillment");
    }
    return successResult(combineBalanceEvents(otherEvents, sub));
  }

  return successResult(otherEvents);
}

export function handleFulfillPromiseMulti(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { ids } = action.params as { ids?: string[] };
  const player = action.players[0];

  if (!ids || ids.length === 0) {
    return errorResult(1, "Missing promise ids");
  }

  const events = [];
  for (const id of ids) {
    const promise = ctx.state.promises.get(id);
    if (!promise || promise.status !== "open") continue;

    promise.status = "fulfilled";
    promise.fulfilled_by = player;
    ctx.state.promises.set(promise);

    events.push({
      object_type: "promises",
      event_type: "update",
      data: { id, fulfilled_by: player },
    });
  }

  return successResult(events);
}

export function handleCompletePromise(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { id } = action.params as { id?: string };

  if (!id) {
    return errorResult(1, "Missing promise id");
  }

  const promise = ctx.state.promises.get(id);
  if (!promise || promise.status !== "fulfilled") {
    return errorResult(2, "Promise not found or not fulfilled");
  }

  promise.status = "completed";
  ctx.state.promises.set(promise);

  const otherEvents = [
    { object_type: "promises", event_type: "update", data: { id } },
  ];

  const { token, qty } = promise.params as { token?: string; qty?: number };
  if (token && qty && promise.fulfilled_by) {
    const amount = round3(qty);
    const add = addBalance(ctx, promise.controller, token, amount);
    return successResult(combineBalanceEvents(otherEvents, add));
  }

  return successResult(otherEvents);
}

export function handleCancelPromise(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { id } = action.params as { id?: string };

  if (!id) {
    return errorResult(1, "Missing promise id");
  }

  const promise = ctx.state.promises.get(id);
  if (!promise || promise.status !== "open") {
    return errorResult(2, "Promise not found or not open");
  }

  promise.status = "cancelled";
  ctx.state.promises.set(promise);

  return successResult([
    { object_type: "promises", event_type: "update", data: { id } },
  ]);
}

export function handleReversePromise(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { id } = action.params as { id?: string };

  if (!id) {
    return errorResult(1, "Missing promise id");
  }

  const promise = ctx.state.promises.get(id);
  if (!promise || promise.status !== "fulfilled") {
    return errorResult(2, "Promise not found or not fulfilled");
  }

  promise.status = "reversed";
  ctx.state.promises.set(promise);

  const otherEvents = [
    { object_type: "promises", event_type: "update", data: { id } },
  ];

  const { token, qty } = promise.params as { token?: string; qty?: number };
  if (token && qty && promise.fulfilled_by) {
    const amount = round3(qty);
    const add = addBalance(ctx, promise.fulfilled_by, token, amount);
    return successResult(combineBalanceEvents(otherEvents, add));
  }

  return successResult(otherEvents);
}
