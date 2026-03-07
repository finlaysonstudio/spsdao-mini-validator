/**
 * Construct unique_trx_id from components.
 *
 * transaction_id = hive transaction ID from block.transaction_ids[i]
 *                  (for virtual ops: custom string like "sl_token_unstaking_SPS_12345")
 *
 * op_index = operation index within the Hive transaction
 * trx_op_id = op_index > 0 ? `${transaction_id}-${op_index}` : transaction_id
 *
 * action_index = index of action within a batch (when JSON is an array)
 * unique_trx_id = action_index > 0 ? `${trx_op_id}.${action_index}` : trx_op_id
 */
export function buildTrxId(
  transactionId: string,
  opIndex: number,
  actionIndex: number,
): string {
  const trxOpId = opIndex > 0 ? `${transactionId}-${opIndex}` : transactionId;
  return actionIndex > 0 ? `${trxOpId}.${actionIndex}` : trxOpId;
}
