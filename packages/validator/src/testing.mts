/** Test helpers (imported only by *.spec.mts). */
import type { IAction } from "./repos/context.mjs";
import type { OperationData } from "./types.mjs";

export function fakeAction(block_num: number, account = "$TRANSITIONS", params: unknown = {}): IAction {
  const op = { block_num, account, block_time: new Date("2025-01-01T00:00:00Z"), trx_op_id: `trx_${block_num}`, transaction_id: `trx_${block_num}` } as unknown as OperationData;
  return { id: `trx_${block_num}`, op, unique_trx_id: `trx_${block_num}`, params, players: [account] };
}
