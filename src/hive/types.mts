export interface HiveOperation {
  type: string;
  value: Record<string, unknown>;
}

export interface HiveTransaction {
  ref_block_num: number;
  ref_block_prefix: number;
  expiration: string;
  operations: [string, Record<string, unknown>][];
  extensions: unknown[];
  signatures: string[];
}

export interface HiveBlock {
  block_id: string;
  previous: string;
  timestamp: string;
  transactions: HiveTransaction[];
  transaction_ids: string[];
}
