import type { EventLog, OperationResult } from "../types.mjs";
import type { StateStore } from "../state/index.mjs";

export interface ActionContext {
  state: StateStore;
  blockNum: number;
  blockTime: Date;
  blockId: string;
  prevBlockId: string;
}

export type OperationHandler = (
  action: ParsedAction,
  ctx: ActionContext,
) => OperationResult;

export interface ParsedAction {
  name: string;
  players: string[];
  params: Record<string, unknown>;
  trxId: string;
  opIndex: number;
  actionIndex: number;
}

export function successResult(events: EventLog[] = []): OperationResult {
  return { success: true, events };
}

export function errorResult(code: number, message?: string): OperationResult {
  return {
    success: false,
    error: { code, message },
    events: [],
  };
}

export function balanceEvent(
  player: string,
  token: string,
  amount: number,
  type: string = "balance_update",
): EventLog {
  return {
    type,
    data: { player, token, amount },
  };
}
