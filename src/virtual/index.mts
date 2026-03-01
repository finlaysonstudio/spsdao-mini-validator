import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult } from "../types.mjs";
import { generateTokenUnstaking } from "./tokenUnstaking.mjs";
import { generatePoolClaims } from "./poolClaims.mjs";
import { generateClearBurned } from "./clearBurned.mjs";
import { generateExpirePromises } from "./expirePromises.mjs";
import { generateExpireCheckIns } from "./expireCheckIns.mjs";
import { generateUpdateMissedBlocks } from "./updateMissedBlocks.mjs";
import { generateTransitions } from "./transitions.mjs";

type VirtualSource = (
  state: StateStore,
  blockNum: number,
  blockTime: Date,
) => { action: ParsedAction; result: OperationResult }[];

/**
 * Virtual operation sources in exact registration order.
 * This order is critical for hash determinism.
 */
const VIRTUAL_SOURCES: VirtualSource[] = [
  generateTokenUnstaking, // 1. token_unstaking
  generatePoolClaims, // 2. claim_pool
  generateClearBurned, // 3. burn
  generateExpirePromises, // 4. expire_promises
  generateExpireCheckIns, // 5. expire_check_ins
  generateUpdateMissedBlocks, // 6. update_missed_blocks
  generateTransitions, // 7. transition_* ops
];

export function runVirtualOperations(
  state: StateStore,
  blockNum: number,
  blockTime: Date,
): { action: ParsedAction; result: OperationResult }[] {
  const allResults: { action: ParsedAction; result: OperationResult }[] = [];

  for (const source of VIRTUAL_SOURCES) {
    const results = source(state, blockNum, blockTime);
    allResults.push(...results);
  }

  return allResults;
}
