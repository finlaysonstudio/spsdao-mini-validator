import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult } from "../types.mjs";

/** Hardcoded transition points where protocol changes fire */
const TRANSITIONS = new Map<
  number,
  { name: string; handler: (state: StateStore) => void }
>();

// Transitions would be populated with actual block numbers and handlers
// e.g., TRANSITIONS.set(12345678, { name: "transition_some_feature", handler: ... })

export function generateTransitions(
  state: StateStore,
  blockNum: number,
  _blockTime: Date,
): { action: ParsedAction; result: OperationResult }[] {
  const transition = TRANSITIONS.get(blockNum);
  if (!transition) return [];

  transition.handler(state);

  return [
    {
      action: {
        name: transition.name,
        players: ["$SYSTEM"],
        params: {},
        trxId: `sl_${transition.name}_${blockNum}`,
        opIndex: 0,
        actionIndex: 0,
      },
      result: { success: true, events: [] },
    },
  ];
}
