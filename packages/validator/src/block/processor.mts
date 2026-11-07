import { sha256 } from "js-sha256";
import seedrandom from "seedrandom";
import { ActionRouter } from "../actions/index.mjs";
import type { ExecutableAction } from "../actions/base.mjs";
import type { HiveBlock } from "../hive/types.mjs";
import { ACCOUNTS } from "../repos/context.mjs";
import type { Services } from "../services.mjs";
import type { BlockRef, BlockRow, CustomJsonPayload, Payout, TransactionEntity } from "../types.mjs";
import { stringify } from "../util/json.mjs";
import { ActionOrBust, Operation, type CustomJsonOp } from "./operation.mjs";
import { virtualSources, type VirtualPayloadSource } from "../virtual/sources.mjs";

/**
 * Upstream SpsBlockProcessor.transformBlock (apps/sps-validator/src/sps/processor.ts): at these
 * transition points the block's Hive transactions are dropped (microforks read by the reference
 * nodes) and the header is replaced by these hard-coded values. Virtual ops still run.
 */
const BAD_BLOCKS = new Map<number, Pick<HiveBlock, "timestamp" | "block_id" | "previous">>([
  [96950550, { timestamp: "2025-06-20T15:36:51.000", block_id: "05c7591683e0102605a769a6935275a5e760353c", previous: "05c75915721349cfbd6c42ff962cf4d66ec2b05e" }],
  [101201159, { timestamp: "2025-11-15T09:55:21.000", block_id: "06083507a197f20ccb1863411d94d3c7d69657c7", previous: "0608350699812e651235fec8b7249a3ed178d4b0" }],
  [101387262, { timestamp: "2025-11-21T21:27:54.000", block_id: "060b0bfeecfece0743f61e8b0f26335839f6557f", previous: "060b0bfd484a25cd78093ddfdbf09a28342c4df8" }],
]);

export function transformBlock(block_num: number, block: HiveBlock): HiveBlock {
  const bad = BAD_BLOCKS.get(block_num);
  if (!bad) return block;
  return { ...bad, transactions: [], transaction_ids: [] };
}

export type ProcessedBlock = {
  block_num: number;
  l2_block_id: string;
  validator: string | null;
  transactions: TransactionEntity[];
  reward: Payout;
};

export class BlockProcessor {
  private readonly actionOrBust: ActionOrBust;
  private readonly sources: VirtualPayloadSource[];

  constructor(private readonly svc: Services) {
    this.actionOrBust = new ActionOrBust(new ActionRouter(svc));
    this.sources = virtualSources(svc);
  }

  process(block_num: number, rawBlock: HiveBlock, prev_l2_block_id: string): ProcessedBlock {
    const block = transformBlock(block_num, rawBlock);
    const ref: BlockRef = {
      block_num,
      block_id: block.block_id,
      previous: block.previous,
      block_time: new Date(block.timestamp + "Z"),
      prng: seedrandom(`${block.block_id}${block.previous}`),
    };
    const operations: Operation[] = [];
    const reward = this.calculateBlockReward(ref);

    // two-phase: every virtual source computes its payloads against block-start state
    const wrapped = this.sources.map((s) => ({ trx_id: s.trx_id(ref), payloads: s.process(ref) }));
    for (const { trx_id, payloads } of wrapped) {
      for (let i = 0; i < payloads.length; i++) {
        const op = new Operation(this.actionOrBust, this.svc.prefix, ref, reward, payloads[i], trx_id, i, true);
        operations.push(op);
        op.process();
      }
    }

    for (let t = 0; t < block.transactions.length; t++) {
      const trx = block.transactions[t];
      const trx_id = block.transaction_ids[t];
      for (let op_index = 0; op_index < trx.operations.length; op_index++) {
        const raw = trx.operations[op_index];
        const name = raw.type.replace(/_operation$/, "");
        if (name === "account_create" || name === "account_create_with_delegation" || name === "create_claimed_account") {
          this.svc.hiveAccounts.upsert(raw.value.new_account_name as string);
          continue;
        }
        if (name !== "custom_json") continue;
        const payload = raw.value as unknown as CustomJsonPayload;
        if (!(payload.id === this.svc.prefix.custom_json_id || payload.id.startsWith(this.svc.prefix.custom_json_prefix))) continue;
        const op: CustomJsonOp = ["custom_json", payload];
        const operation = new Operation(this.actionOrBust, this.svc.prefix, ref, reward, op, trx_id, op_index);
        operations.push(operation);
        operation.process();
      }
    }

    const validator = this.svc.validators.getBlockValidator(ref);
    const actions = operations.flatMap((o) => o.actions);
    const transactions = actions.map((a, index) => BlockProcessor.toEntity(ref, a, index));
    const hash = sha256(`${prev_l2_block_id}.${JSON.stringify(transactions)}`);
    const row: BlockRow = {
      block_num,
      block_id: ref.block_id,
      prev_block_id: ref.previous,
      l2_block_id: hash,
      block_time: ref.block_time,
      validator: validator?.account_name ?? null,
      validation_tx: null,
    };
    this.svc.blocks.insertProcessed(row);
    return { block_num, l2_block_id: hash, validator: row.validator, transactions, reward };
  }

  private static toEntity(ref: BlockRef, action: ExecutableAction, index: number): TransactionEntity {
    return {
      id: action.unique_trx_id,
      created_date: ref.block_time,
      block_num: ref.block_num,
      index,
      block_id: ref.block_id,
      prev_block_id: ref.previous,
      type: action.id,
      player: action.players[0],
      data: stringify(action.params),
      success: action.success ?? null,
      error: action.error === undefined ? null : JSON.stringify(action.error.code),
      result: action.result === undefined ? null : stringify({ events: action.result }),
    };
  }

  private calculateBlockReward(block: BlockRef): Payout {
    const validator = this.svc.config.validator;
    if (validator === undefined) return 0;
    const elapsed_blocks = block.block_num - validator.reward_start_block;
    if (elapsed_blocks < 0) return 0;
    if (validator.reward_version === "per_block_capped") {
      const blocks_per_month = 864000;
      const token = validator.reward_token;
      const balance = this.svc.balances.getBalance(ACCOUNTS.VALIDATOR_REWARDS, token);
      const num_blocks = 1;
      const Y = (balance / blocks_per_month) * num_blocks;
      const X = validator.tokens_per_block * num_blocks;
      const o1 = X * 0.7;
      const o2 = Math.min(Y * 0.05, X * 0.9);
      const Z = Math.max(o1, o2);
      return [Z, token];
    }
    const token = validator.reward_token;
    const reward = +(validator.tokens_per_block * (1 - (parseInt(`${elapsed_blocks / validator.reduction_blocks}`) * validator.reduction_pct) / 100)).toFixed(3);
    return [reward, token];
  }
}
