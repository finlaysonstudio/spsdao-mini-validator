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

interface NamedVirtualSource {
  name: string;
  fn: VirtualSource;
}

/**
 * Virtual operation sources in exact registration order.
 * This order is critical for hash determinism.
 */
const VIRTUAL_SOURCES: NamedVirtualSource[] = [
  { name: "tokenUnstaking", fn: generateTokenUnstaking }, // 1. token_unstaking
  { name: "poolClaims", fn: generatePoolClaims }, // 2. claim_pool
  { name: "clearBurned", fn: generateClearBurned }, // 3. burn
  { name: "expirePromises", fn: generateExpirePromises }, // 4. expire_promises
  { name: "expireCheckIns", fn: generateExpireCheckIns }, // 5. expire_check_ins
  { name: "updateMissedBlocks", fn: generateUpdateMissedBlocks }, // 6. update_missed_blocks
  { name: "transitions", fn: generateTransitions }, // 7. transition_* ops
];

export interface VirtualOpResult {
  action: ParsedAction;
  result: OperationResult;
  source: string;
}

export function runVirtualOperations(
  state: StateStore,
  blockNum: number,
  blockTime: Date,
): VirtualOpResult[] {
  const allResults: VirtualOpResult[] = [];

  for (const { name, fn } of VIRTUAL_SOURCES) {
    const results = fn(state, blockNum, blockTime);
    for (const r of results) {
      allResults.push({ ...r, source: name });
    }
  }

  return allResults;
}
