import type { EventLog, OperationResult } from "../types.mjs";
import type { StateStore } from "../state/index.mjs";

export interface ActionContext {
  state: StateStore;
  blockNum: number;
  blockTime: Date;
  blockId: string;
  prevBlockId: string;
  trxId: string;
  actionType: string;
}

export type OperationHandler = (
  action: ParsedAction,
  ctx: ActionContext,
) => OperationResult | null;

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
