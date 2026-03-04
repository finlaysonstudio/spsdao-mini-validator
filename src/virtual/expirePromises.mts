import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult, EventLog } from "../types.mjs";

export function generateExpirePromises(
  state: StateStore,
  blockNum: number,
  _blockTime: Date,
): { action: ParsedAction; result: OperationResult }[] {
  const expired = state.promises.getExpired(blockNum);
  if (expired.length === 0) return [];

  const events: EventLog[] = [];

  for (const promise of expired) {
    promise.status = "cancelled";
    state.promises.set(promise);
    events.push({
      object_type: "promises",
      event_type: "update",
      data: { id: promise.id },
    });
  }

  return [
    {
      action: {
        name: "expire_promises",
        players: ["$PROMISE_EXPIRATION"],
        params: { count: expired.length },
        trxId: `sl_expire_promises_${blockNum}`,
        opIndex: 0,
        actionIndex: 0,
      },
      result: { success: true, events },
    },
  ];
}
