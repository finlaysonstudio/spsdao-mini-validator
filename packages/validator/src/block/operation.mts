import type { ActionRouter } from "../actions/index.mjs";
import type { ExecutableAction } from "../actions/base.mjs";
import type { PrefixOpts } from "../services.mjs";
import type { BlockRef, CustomJsonPayload, OperationData, Payout, ProcessResult } from "../types.mjs";
import { OperationError } from "../util/errors.mjs";

const posting_auth_actions = [
  "token_award",
  "stake_tokens",
  "stake_tokens_multi",
  "unstake_tokens",
  "claim_staking_rewards",
  "cancel_unstake_tokens",
  "delegate_tokens",
  "undelegate_tokens",
  "undelegate_tokens_multi",
  "return_tokens",
  "fulfill_promise",
  "fulfill_promise_multi",
  "activate_license",
  "deactivate_license",
  "validate_block",
  "check_in_validator",
  "price_feed",
];

function tryParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export class ActionOrBust {
  constructor(private readonly router: ActionRouter) {}

  createAction(op: Operation, data: any, index?: number): ExecutableAction | null {
    if (typeof data?.action !== "string") return null;
    const isAuthorized = posting_auth_actions.includes(data.action) || op.active_auth;
    if (!isAuthorized) return null;
    const factory = this.router.route(op.block_num, data.action, op.isVirtual);
    if (!factory) return null;
    try {
      const action = factory(op, data, index);
      return action.isSupported() ? action : null;
    } catch {
      return null;
    }
  }
}

export type CustomJsonOp = ["custom_json", CustomJsonPayload];

export class Operation implements OperationData {
  readonly active_auth: boolean;
  readonly account: string;
  readonly id: string;
  readonly block_num: number;
  readonly block_time: Date;
  readonly actions: ExecutableAction[];
  private readonly base_id: string;

  constructor(
    actionOrBust: ActionOrBust,
    private readonly cfg: PrefixOpts,
    readonly block: BlockRef,
    readonly block_reward: Payout,
    readonly op: CustomJsonOp | ProcessResult,
    readonly transaction_id: string,
    readonly op_index: number,
    readonly isVirtual = false,
  ) {
    this.block_num = block.block_num;
    this.block_time = block.block_time;
    const payload = op[1];
    this.active_auth = !!(payload.required_auths && payload.required_auths.length > 0);
    this.account = this.active_auth ? payload.required_auths[0] : payload.required_posting_auths[0];
    this.id = payload.id;
    this.base_id = this.id.replace(this.cfg.custom_json_prefix, "");

    const data = typeof payload.json === "object" ? payload.json : tryParse(payload.json as string);
    let actions: Array<ExecutableAction | null>;
    if (this.id === this.cfg.custom_json_id) {
      actions = Array.isArray(data) ? data.map((a, i) => actionOrBust.createAction(this, a, i)) : [actionOrBust.createAction(this, data)];
    } else if (this.id.startsWith(this.cfg.custom_json_prefix)) {
      actions = [actionOrBust.createAction(this, { action: this.base_id, params: data })];
    } else if (this.base_id === this.id) {
      actions = [actionOrBust.createAction(this, { action: this.base_id, params: data })];
    } else {
      actions = [];
    }
    this.actions = actions.filter((a): a is ExecutableAction => a !== null);
  }

  process(): void {
    for (const a of this.actions) {
      try {
        a.execute();
      } catch (err) {
        if (err instanceof OperationError) throw err;
        throw new OperationError({ block_num: this.block_num, trx_id: a.unique_trx_id, action: a.id, account: this.account }, err);
      }
    }
  }

  get trx_op_id(): string {
    return this.op_index && this.op_index > 0 ? `${this.transaction_id}-${this.op_index}` : this.transaction_id;
  }
}
