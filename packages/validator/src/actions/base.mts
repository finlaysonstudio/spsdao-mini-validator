import type { Schema } from "../schema.mjs";
import type { EventLog, OperationData } from "../types.mjs";
import { ActionError, ErrorType, ValidationError, type LogObj } from "../util/errors.mjs";
import type { ConfigLoader } from "../repos/config.mjs";
import type { IAction } from "../repos/context.mjs";

export class ActionConstructionError extends Error {}

export interface ExecutableAction extends IAction {
  readonly index: number;
  success: boolean | undefined;
  error: LogObj | undefined;
  result: EventLog[] | undefined;
  isSupported(): boolean;
  execute(): void;
}

export type ActionFactory = (op: OperationData, data: unknown, index?: number) => ExecutableAction;

export abstract class Action<P = any> implements ExecutableAction {
  protected readonly action_name: string;
  public readonly id: string;
  public readonly params: P;
  public readonly players: string[];
  public success: boolean | undefined = undefined;
  public result: EventLog[] | undefined = undefined;
  public error: LogObj | undefined = undefined;

  protected constructor(schema: Schema<any>, public readonly op: OperationData, data: unknown, public readonly index = 0) {
    this.action_name = schema.action_name;
    let v;
    try {
      v = schema.validateWrapped(data);
    } catch (e) {
      throw new ActionConstructionError(`Data could not be validated for action ${this.action_name}: ${(e as Error).message}`);
    }
    this.id = v.action;
    this.params = v.params as P;
    this.players = [this.op.account];
  }

  execute(): void {
    try {
      this.validate();
      this.result = this.process();
      if (this.players.length > 1) this.players.splice(0, this.players.length, ...new Set(this.players));
      this.success = true;
    } catch (err) {
      this.success = false;
      if (err instanceof ValidationError) {
        this.error = err.log_obj;
      } else {
        throw err;
      }
    }
  }

  protected abstract validate(): boolean;
  protected abstract process(): EventLog[];

  isSupported(): boolean {
    return true;
  }

  get unique_trx_id(): string {
    return this.index > 0 ? `${this.op.trx_op_id}.${this.index}` : this.op.trx_op_id;
  }

  protected err(message: string, code: ErrorType): ValidationError {
    return new ValidationError(message, this.id, code);
  }
}

export abstract class AdminAction<P = any> extends Action<P> {
  protected constructor(protected readonly config: ConfigLoader, schema: Schema<any>, op: OperationData, data: unknown, index?: number) {
    super(schema, op, data, index);
  }

  validate(): boolean {
    if (!this.config.isAdmin(this.op.account)) {
      throw new ValidationError("Only an administrator account may perform this action.", this.id, ErrorType.AdminOnly);
    }
    return true;
  }
}

export { ActionError };
