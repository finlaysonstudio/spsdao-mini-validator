import type { PRNG } from "seedrandom";

export type EventType = "update" | "upsert" | "insert" | "delete";

/** Key order matters for hashing: upstream serialises object_type, event_type, data. */
export class EventLog<D = unknown> {
  public readonly object_type: string;
  public readonly event_type: EventType;
  public readonly data: D;
  constructor(event_type: EventType, object_type: string, data: D) {
    this.object_type = object_type;
    this.event_type = event_type;
    this.data = data;
  }
}

export const EventTypes = {
  UPDATE: "update",
  UPSERT: "upsert",
  INSERT: "insert",
  DELETE: "delete",
} as const;

export type Payout = [number, string] | 0;

export interface BlockRef {
  block_num: number;
  block_id: string;
  previous: string;
  block_time: Date;
  prng: PRNG;
}

/** Mirrors upstream OperationData */
export interface OperationData {
  readonly active_auth: boolean;
  readonly account: string;
  readonly block_num: number;
  readonly block_time: Date;
  readonly block_reward: Payout;
  readonly block: BlockRef;
  readonly trx_op_id: string;
  readonly transaction_id: string;
}

export interface TransactionEntity {
  id: string;
  created_date: Date;
  block_num: number;
  index: number;
  block_id: string;
  prev_block_id: string;
  type: string;
  player: string;
  data: string;
  success: boolean | null;
  error: string | null;
  result: string | null;
}

export interface BlockRow {
  block_num: number;
  block_id: string;
  prev_block_id: string;
  l2_block_id: string;
  block_time: Date;
  validator: string | null;
  validation_tx: string | null;
}

export type CustomJsonPayload = {
  required_auths: string[];
  required_posting_auths: string[];
  id: string;
  json: unknown;
};

/** A virtual op payload: ['custom_json', {...}] */
export type ProcessResult = ["custom_json", CustomJsonPayload];
