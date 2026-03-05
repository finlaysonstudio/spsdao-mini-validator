export interface SeedFile {
  block_num: number;
  l2_block_id: string;
  block_id: string;
  prev_block_id?: string;
  block_time: string;

  balances: { player: string; token: string; balance: number }[];

  validators: {
    account_name: string;
    is_active: boolean;
    total_votes: number;
    missed_blocks?: number;
    post_url?: string;
    reward_account?: string;
    api_url?: string;
    last_version?: string;
  }[];

  validator_votes?: {
    voter: string;
    validator: string;
    vote_weight: number;
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
    unstaking_periods?: number;
    unstaking_interval_seconds?: number;
  }[];

  /** Pool config is stored in the config table; this is optional for explicit pools */
  pools?: {
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
    id: number | string;
    ext_id?: string;
    type: string;
    status: "open" | "fulfilled" | "completed" | "cancelled" | "reversed";
    params: Record<string, unknown>;
    controllers?: string[];
    controller?: string;
    fulfill_timeout_seconds?: number;
    fulfilled_by?: string;
    fulfilled_at?: string;
    fulfilled_expiration?: string;
    created_date?: string;
    updated_date?: string;
    created_block_num?: number;
    expiration_block_num?: number;
  }[];

  config: {
    group_name: string;
    name: string;
    index?: number;
    value_type?: string;
    value: string;
  }[];

  check_ins: {
    account: string;
    status?: string;
    last_check_in_block_num?: number;
    last_check_in?: string;
    /** Legacy format */
    block_num?: number;
    hash?: string;
  }[];

  hive_accounts:
    | string[]
    | { name: string; authority?: Record<string, unknown> }[];

  price_history?: {
    validator: string;
    token: string;
    block_num: number;
    block_time: string;
    token_price: number;
  }[];

  recent_blocks?: {
    block_num: number;
    block_id: string;
    prev_block_id: string;
    l2_block_id: string;
    block_time: string;
    validator?: string;
    validation_tx?: string;
  }[];

  known_hashes?: { block_num: number; l2_block_id: string }[];

  _meta?: Record<string, unknown>;
}
