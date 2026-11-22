import type { OperationData } from "../types.mjs";

/** The subset of upstream IAction that repositories use. */
export interface IAction {
  readonly id: string;
  readonly op: OperationData;
  readonly unique_trx_id: string;
  readonly params: any;
  readonly players: string[];
}

export const TOKENS = {
  SPS: "SPS",
  SPSP: "SPSP",
  SPSP_IN: "SPSP-IN",
  SPSP_OUT: "SPSP-OUT",
  LICENSE: "LICENSE",
  ACTIVATED_LICENSE: "ACTIVATED_LICENSE",
  RUNNING_LICENSE: "RUNNING_LICENSE",
} as const;

export type TokenSupportEntry = {
  token: string;
  precision?: number;
  awardable?: boolean;
  transferable: boolean;
  stakes?: string;
  unstakes?: string;
  delegation?: { out_token: string; in_token: string };
};

export const SUPPORTED_TOKENS: Record<string, TokenSupportEntry> = {
  [TOKENS.SPS]: { token: TOKENS.SPS, transferable: true, awardable: true, stakes: TOKENS.SPSP },
  [TOKENS.SPSP]: {
    token: TOKENS.SPSP,
    transferable: false,
    unstakes: TOKENS.SPS,
    delegation: { in_token: TOKENS.SPSP_IN, out_token: TOKENS.SPSP_OUT },
  },
  [TOKENS.LICENSE]: { token: TOKENS.LICENSE, transferable: true, precision: 0 },
  [TOKENS.ACTIVATED_LICENSE]: { token: TOKENS.ACTIVATED_LICENSE, transferable: false, precision: 0 },
  [TOKENS.RUNNING_LICENSE]: { token: TOKENS.RUNNING_LICENSE, transferable: false, precision: 0 },
};

export const TokenSupport = {
  entry: (t: string) => SUPPORTED_TOKENS[t],
  unstake: (t: string) => SUPPORTED_TOKENS[t]?.unstakes,
  stake: (t: string) => SUPPORTED_TOKENS[t]?.stakes,
  delegation: (t: string) => SUPPORTED_TOKENS[t]?.delegation,
  isSupported: (t: string) => !!SUPPORTED_TOKENS[t]?.transferable,
  isDivisible: (t: string) => !(SUPPORTED_TOKENS[t]?.precision === 0),
  canTransfer: (t: string, qty?: number) => {
    const support = TokenSupport.isSupported(t);
    if (qty === undefined) return support;
    return support && (Number.isSafeInteger(qty) || TokenSupport.isDivisible(t));
  },
};

export const ACCOUNTS = {
  BURN: "null",
  BURNED_LEDGER: "$BURNED",
  STAKING: "$TOKEN_STAKING",
  MISSED_BLOCKS: "$MISSED_BLOCKS",
  DELEGATION: "$DELEGATION",
  DELEGATION_PROMISES: "$DELEGATION_PROMISES",
  VALIDATOR_REWARDS: "$VALIDATOR_REWARDS",
  LICENSE_MANAGER: "$LICENSE_MANAGER",
  PROMISE_EXPIRATION: "$PROMISE_EXPIRATION",
  RENTAL_EXPIRATION: "$RENTAL_EXPIRATION",
  TRANSITIONS: "$TRANSITIONS",
  MINTING: "$MINTING",
} as const;

export const SPS_POOL = { name: "staking_rewards", reward_account: "$SPS_STAKING_REWARDS", token: "SPS", stake: "SPSP" } as const;
export const VALIDATOR_POOL = { name: "validator_rewards", reward_account: "$REWARD_POOLS_LICENSE", token: "SPS", stake: "RUNNING_LICENSE" } as const;
export const POOLS = [SPS_POOL, VALIDATOR_POOL] as const;
export type AwardPool = (typeof POOLS)[number];

/** JS localeCompare, as used by upstream sorts. */
export function localeSort(a: string, b: string): number {
  return a.localeCompare(b);
}
