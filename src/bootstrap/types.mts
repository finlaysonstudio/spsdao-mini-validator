export interface SeedFile {
  block_num: number;
  l2_block_id: string;
  block_id: string;
  block_time: string;

  balances: { player: string; token: string; balance: number }[];

  validators: {
    account_name: string;
    is_active: boolean;
    total_votes: number;
    missed_blocks?: number;
    post_url?: string;
    block_num?: number;
  }[];

  active_delegations: {
    delegator: string;
    delegatee: string;
    token: string;
    amount: number;
    last_delegation_tx?: string;
    last_undelegation_date?: string;
  }[];

  token_unstaking: {
    player: string;
    unstake_tx: string;
    token: string;
    quantity: number;
    quantity_left: number;
    total_qty: number;
    next_unstake_date: string;
    is_active: boolean;
  }[];

  pools: {
    name: string;
    token: string;
    reward_token: string;
    tokens_per_block: number;
    start_block: number;
    acc_tokens_per_share: number;
    last_reward_block: number;
    is_active: boolean;
  }[];

  staking_pool_reward_debt: {
    player: string;
    pool_name: string;
    reward_debt: number;
  }[];

  promises: {
    id: string;
    type: string;
    controller: string;
    fulfilled_by?: string;
    params: Record<string, unknown>;
    status: "open" | "fulfilled" | "completed" | "cancelled" | "reversed";
    created_block_num: number;
    expiration_block_num?: number;
  }[];

  config: { group_name: string; name: string; value: string }[];

  check_ins: {
    account: string;
    block_num: number;
    hash: string;
  }[];

  hive_accounts: string[];

  /** Optional: known hashes for verification */
  known_hashes?: { block_num: number; l2_block_id: string }[];
}
