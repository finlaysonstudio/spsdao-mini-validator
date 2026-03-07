export interface EventLog {
  object_type: string;
  event_type: string;
  data: Record<string, unknown>;
}

export interface OperationResult {
  success: boolean;
  error?: { code: number; message?: string };
  events: EventLog[];
}

export interface Action {
  name: string;
  players: string[];
  params: Record<string, unknown>;
  trxId: string;
  opIndex: number;
  actionIndex: number;
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
  data: string | null;
  success: boolean | null;
  error: string | null;
  result: string | null;
}

export interface BlockRef {
  block_num: number;
  block_id: string;
  prev_block_id: string;
  block_time: Date;
  l2_block_id: string;
  validator?: string;
  validation_tx?: string;
}
