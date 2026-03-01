import { round3 } from "../../state/index.mjs";
import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult, balanceEvent } from "../types.mjs";

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
    { type: "create_promise", data: { id, promise_type: type } },
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

  const events = [];

  // Handle token escrow if applicable
  const { token, qty } = promise.params as { token?: string; qty?: number };
  if (token && qty) {
    const amount = round3(qty);
    if (!ctx.state.balances.subtract(player, token, amount)) {
      promise.status = "open";
      promise.fulfilled_by = undefined;
      ctx.state.promises.set(promise);
      return errorResult(3, "Insufficient balance for fulfillment");
    }
    events.push(balanceEvent(player, token, -amount));
  }

  return successResult([
    { type: "fulfill_promise", data: { id, fulfilled_by: player } },
    ...events,
  ]);
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
      type: "fulfill_promise",
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

  const events = [];
  const { token, qty } = promise.params as { token?: string; qty?: number };
  if (token && qty && promise.fulfilled_by) {
    const amount = round3(qty);
    ctx.state.balances.add(promise.controller, token, amount);
    events.push(balanceEvent(promise.controller, token, amount));
  }

  return successResult([{ type: "complete_promise", data: { id } }, ...events]);
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

  return successResult([{ type: "cancel_promise", data: { id } }]);
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

  const events = [];
  const { token, qty } = promise.params as { token?: string; qty?: number };
  if (token && qty && promise.fulfilled_by) {
    const amount = round3(qty);
    ctx.state.balances.add(promise.fulfilled_by, token, amount);
    events.push(balanceEvent(promise.fulfilled_by, token, amount));
  }

  return successResult([{ type: "reverse_promise", data: { id } }, ...events]);
}
