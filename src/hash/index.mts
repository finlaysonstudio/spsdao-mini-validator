import { sha256 } from "js-sha256";
import type { TransactionEntity } from "../types.mjs";

/**
 * Compute the L2 block hash.
 *
 * Formula: SHA256(prev_l2_hash + "." + JSON.stringify(transactions))
 *
 * prev_l2_hash comes from the previous block's stored l2_block_id.
 * Date.toJSON() produces "YYYY-MM-DDTHH:mm:ss.sssZ" which is the exact
 * format that goes into the hash.
 */
export function computeL2Hash(
  prevL2Hash: string,
  transactions: TransactionEntity[],
): string {
  const payload = `${prevL2Hash}.${JSON.stringify(transactions)}`;
  return sha256(payload);
}
