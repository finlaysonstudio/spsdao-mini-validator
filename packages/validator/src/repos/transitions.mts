import type { BlockRef, ProcessResult } from "../types.mjs";
import { ACCOUNTS } from "./context.mjs";

export const TRANSITION_POINTS = {
  fix_vote_weight: 95026480,
  bad_block_96950550: 96950550,
  validator_transition_cleanup: 100342741,
  bad_block_101201159: 101201159,
  bad_block_101387262: 101387262,
  adjust_token_distribution_strategy: 101928051,
  fix_multi_undelegate_crash: 103680250,
  delegation_offer_block: 105920215,
} as const;

export type TransitionPointName = keyof typeof TRANSITION_POINTS;

export class TransitionManager {
  readonly transitionAccount = ACCOUNTS.TRANSITIONS;

  constructor(private readonly customJsonId: string, readonly transitionPoints: Record<TransitionPointName, number> = TRANSITION_POINTS) {}

  isTransitionPoint(name: TransitionPointName, block_num: number): boolean {
    return this.transitionPoints[name] === block_num;
  }

  isTransitioned(name: TransitionPointName, block_num: number): boolean {
    return this.transitionPoints[name] <= block_num;
  }

  private payload(action: string, block_num: number): ProcessResult {
    return [
      "custom_json",
      {
        required_auths: [this.transitionAccount],
        required_posting_auths: [],
        id: this.customJsonId,
        json: { action, params: { block_num } },
      },
    ];
  }

  process(block: BlockRef): ProcessResult[] {
    const b = block.block_num;
    if (this.isTransitionPoint("fix_vote_weight", b)) return [this.payload("transition_fix_vote_weight", b)];
    if (this.isTransitionPoint("validator_transition_cleanup", b))
      return [this.payload("transition_cleanup_lite_accounts", b), this.payload("transition_balance_token_staking_spsp", b)];
    if (this.isTransitionPoint("adjust_token_distribution_strategy", b))
      return [this.payload("transition_adjust_token_distribution_strategy", b)];
    if (this.isTransitionPoint("delegation_offer_block", b)) return [this.payload("transition_cancel_delegation_promises", b)];
    return [];
  }

  trx_id(block: BlockRef): string {
    return `sl_transition_point_${block.block_num}`;
  }
}
