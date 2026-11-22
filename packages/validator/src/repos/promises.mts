import type { PromiseRow, PromiseStatus, StateStore } from "../state/index.mjs";
import type { BlockRef, ProcessResult } from "../types.mjs";
import { EventLog } from "../types.mjs";
import { pgCompare } from "../util/collate.mjs";
import { ErrorType, UnsupportedPathError, ValidationError } from "../util/errors.mjs";
import { jsonbCanonical } from "../util/json.mjs";
import { warn } from "../util/log.mjs";
import { Err, Ok, OkVoid, type Result } from "../util/result.mjs";
import { delegation_offer_fulfill_metadata_schema, delegation_offer_params_schema, delegation_promise_params_schema } from "../schema.mjs";
import type { ConfigLoader } from "./config.mjs";
import { ACCOUNTS, type IAction } from "./context.mjs";
import type { DelegationManager, RentalDelegationRepository } from "./delegations.mjs";
import { TRANSITION_POINTS } from "./transitions.mjs";

export type PromiseAction = "create" | "fulfill" | "reverse" | "cancel" | "complete";

/** Upstream PromiseEntity minus the serial id. `compact` rows come from the closed store. */
export type PromiseEntity = PromiseRow & { compact?: boolean };

export type PromiseInsert = {
  actor: string;
  type: string;
  ext_id: string;
  controllers: string[];
  params: unknown;
  fulfill_timeout_seconds: number | null;
  status: PromiseStatus;
};

export type PromiseUpdate = {
  action: PromiseAction;
  previous_status: PromiseStatus;
  actor: string;
  type: string;
  ext_id: string;
  status: PromiseStatus;
  fulfilled_at: Date | null;
  fulfilled_by: string | null;
  fulfilled_expiration: Date | null;
};

function entityData(p: PromiseRow) {
  return {
    ext_id: p.ext_id,
    type: p.type,
    status: p.status,
    params: jsonbCanonical(p.params),
    controllers: p.controllers,
    fulfill_timeout_seconds: p.fulfill_timeout_seconds,
    fulfilled_by: p.fulfilled_by,
    fulfilled_at: p.fulfilled_at,
    fulfilled_expiration: p.fulfilled_expiration,
    created_date: p.created_date,
    updated_date: p.updated_date,
  };
}

export class PromiseRepository {
  constructor(private readonly state: StateStore) {}

  getPromiseByTypeAndId(type: string, id: string): PromiseEntity | null {
    const live = this.state.promises.getLive(type, id);
    if (live) return live;
    const closed = this.state.promises.getClosed(type, id);
    if (!closed) return null;
    return {
      compact: true,
      ext_id: id,
      type,
      status: closed.status,
      params: closed.lender === undefined ? {} : { lender: closed.lender },
      controllers: closed.controllers,
      fulfill_timeout_seconds: null,
      fulfilled_by: null,
      fulfilled_at: null,
      fulfilled_expiration: null,
      created_date: new Date(0),
      updated_date: new Date(0),
    };
  }

  getPromisesByTypeAndIds(type: string, ids: string[]): PromiseEntity[] {
    const out: PromiseEntity[] = [];
    for (const id of ids) {
      const p = this.getPromiseByTypeAndId(type, id);
      if (p) out.push(p);
    }
    return out.sort((a, b) => pgCompare(a.ext_id, b.ext_id));
  }

  countExpiredPromises(now: Date): number {
    let n = 0;
    for (const p of this.state.promises.liveRows()) {
      if (p.status === "fulfilled" && p.fulfilled_expiration !== null && p.fulfilled_expiration <= now) n++;
    }
    return n;
  }

  getExpiredPromises(now: Date): PromiseEntity[] {
    return this.state.promises
      .liveRows()
      .filter((p) => p.status === "fulfilled" && p.fulfilled_expiration !== null && p.fulfilled_expiration <= now)
      .sort((a, b) => pgCompare(a.ext_id, b.ext_id));
  }

  /** WHERE type AND status = 'open' ORDER BY ext_id */
  getOpenPromisesByType(type: string): PromiseRow[] {
    return this.state.promises
      .liveRows()
      .filter((p) => p.type === type && p.status === "open")
      .sort((a, b) => pgCompare(a.ext_id, b.ext_id));
  }

  insert(promise: PromiseInsert, action: IAction): [PromiseEntity, EventLog[]] {
    const row: PromiseRow = {
      ext_id: promise.ext_id,
      type: promise.type,
      status: promise.status,
      params: jsonbCanonical(promise.params),
      controllers: promise.controllers,
      fulfill_timeout_seconds: promise.fulfill_timeout_seconds,
      fulfilled_by: null,
      fulfilled_at: null,
      fulfilled_expiration: null,
      created_date: action.op.block_time,
      updated_date: action.op.block_time,
    };
    this.state.promises.setLive(row);
    const events = [new EventLog("insert", "promise", entityData(row)), ...this.historyEvents([row], { actor: promise.actor, action: "create" }, action)];
    return [row, events];
  }

  private live(type: string, ext_id: string): PromiseRow {
    const row = this.state.promises.getLive(type, ext_id);
    if (!row) throw new UnsupportedPathError(`promise ${type}/${ext_id} is not in the live store`);
    return row;
  }

  update(promise: PromiseUpdate, action: IAction): [PromiseEntity, EventLog[]] {
    const row = this.live(promise.type, promise.ext_id);
    row.status = promise.status;
    row.fulfilled_at = promise.fulfilled_at;
    row.fulfilled_by = promise.fulfilled_by;
    row.fulfilled_expiration = promise.fulfilled_expiration;
    row.updated_date = action.op.block_time;
    const events = [
      new EventLog("update", "promise", entityData(row)),
      ...this.historyEvents([row], { actor: promise.actor, action: promise.action, previous_status: promise.previous_status }, action),
    ];
    this.maybeClose(row);
    return [row, events];
  }

  updateMultiple(update: Omit<PromiseUpdate, "ext_id"> & { ext_ids: string[] }, action: IAction): [PromiseEntity[], EventLog[]] {
    warn(`updateMultiple on ${update.ext_ids.length} promises: RETURNING order is not reproducible, using ext_id order`);
    const rows: PromiseRow[] = [];
    for (const id of update.ext_ids) {
      const row = this.live(update.type, id);
      row.status = update.status;
      row.fulfilled_at = update.fulfilled_at;
      row.fulfilled_by = update.fulfilled_by;
      row.fulfilled_expiration = update.fulfilled_expiration;
      row.updated_date = action.op.block_time;
      rows.push(row);
    }
    const updateLogs = rows.map((p) => new EventLog("update", "promise", entityData(p)));
    const history = this.historyEvents(rows, { actor: update.actor, action: update.action, previous_status: update.previous_status }, action);
    for (const row of rows) this.maybeClose(row);
    return [rows, [...updateLogs, ...history]];
  }

  updateParams(type: string, ext_id: string, params: unknown, action: IAction): EventLog[] {
    const row = this.live(type, ext_id);
    row.params = jsonbCanonical(params);
    row.updated_date = action.op.block_time;
    return [new EventLog("update", "promise", entityData(row))];
  }

  /** Called after the events for a status change have been produced. */
  closeIfFinal(type: string, ext_id: string): void {
    const row = this.state.promises.getLive(type, ext_id);
    if (row) this.maybeClose(row);
  }

  private maybeClose(row: PromiseRow): void {
    if (row.status !== "completed" && row.status !== "cancelled") return;
    const lender = (row.params as { lender?: string } | null)?.lender;
    this.state.promises.close(row.type, row.ext_id, row.status, typeof lender === "string" ? lender : undefined, row.controllers);
  }

  private historyEvents(promises: PromiseRow[], meta: { previous_status?: PromiseStatus; actor: string; action: PromiseAction }, action: IAction): EventLog[] {
    return promises.map(
      (p) =>
        new EventLog("insert", "promise_history", {
          type: p.type,
          ext_id: p.ext_id,
          player: meta.actor,
          action: meta.action,
          previous_status: meta.previous_status ?? null,
          new_status: p.status,
          trx_id: action.unique_trx_id,
          created_date: action.op.block_time,
        }),
    );
  }
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------
export type HandlerCreatePromiseRequest = { type: string; id: string | undefined | null; params: unknown; fulfill_timeout_seconds?: number };
export type HandlerCreatePromiseResult = { allowNonAdmin?: boolean };
export type HandlerCreateResult = { logs: EventLog[]; params?: unknown };
export type HandlerFulfillPromiseRequest = { type: string; id: string; metadata: unknown };
export type HandlerFulfillPromisesRequest = { type: string; ids: string[]; metadata: unknown };
export type HandlerFulfillPromiseResult = { logs: EventLog[]; status?: PromiseStatus; updatedParams?: unknown };
export type HandlerPromiseRequest = { type: string; id: string };

export abstract class PromiseHandler {
  abstract validateCreatePromise(request: HandlerCreatePromiseRequest, action: IAction): Result<HandlerCreatePromiseResult>;
  abstract createPromise(request: HandlerCreatePromiseRequest, action: IAction): HandlerCreateResult;
  abstract validateFulfillPromise(request: HandlerFulfillPromiseRequest, promise: PromiseEntity, action: IAction): Result;
  abstract fulfillPromise(request: HandlerFulfillPromiseRequest, promise: PromiseEntity, action: IAction): HandlerFulfillPromiseResult;
  abstract validateFulfillPromises(request: HandlerFulfillPromisesRequest, promises: PromiseEntity[], action: IAction): Result;
  abstract fulfillPromises(request: HandlerFulfillPromisesRequest, promises: PromiseEntity[], action: IAction): HandlerFulfillPromiseResult;
  abstract validateReversePromise(request: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): Result;
  abstract reversePromise(request: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): EventLog[];
  abstract validateCompletePromise(request: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): Result;
  abstract completePromise(request: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): EventLog[];

  validateCancelPromise(_request: HandlerPromiseRequest, _promise: PromiseEntity, _action: IAction): Result {
    return OkVoid();
  }
  cancelPromise(_request: HandlerPromiseRequest, _promise: PromiseEntity, _action: IAction): EventLog[] {
    return [];
  }
  getPromisesNotFoundErrorMessage(ids: string[]): string {
    return `Some promises not found: ${ids.join(", ")}`;
  }
  getPromisesNotOpenErrorMessage(ids: string[]): string {
    return `Some promises are not open: ${ids.join(", ")}`;
  }
}

type DelegationPromiseParams = { token: string; to: string; qty: number; player?: string };

export class DelegationPromiseHandler extends PromiseHandler {
  constructor(private readonly delegationManager: DelegationManager) {
    super();
  }

  validateCreatePromise(request: HandlerCreatePromiseRequest, action: IAction): Result<HandlerCreatePromiseResult> {
    const params = request.params as DelegationPromiseParams;
    if (params.player != null) {
      return Err(new ValidationError("player parameter cannot be used in delegation promises.", action.id, ErrorType.DelegationAuthorityNotAllowed));
    } else if (!request.fulfill_timeout_seconds) {
      return Err(new ValidationError("fulfill_timeout_seconds parameter is required for delegation promises.", action.id, ErrorType.InvalidPromiseParams));
    } else if (!request.id) {
      return Err(new ValidationError("id parameter is required for delegation promises.", action.id, ErrorType.InvalidPromiseParams));
    }
    const v = this.delegationManager.validateDelegationPromise(params, action);
    if (!v.ok) return Err(v.error);
    return Ok({});
  }

  createPromise(): HandlerCreateResult {
    return { logs: [] };
  }

  validateFulfillPromise(_request: HandlerFulfillPromiseRequest, promise: PromiseEntity, action: IAction): Result {
    if (!delegation_promise_params_schema.isValidSync(promise.params)) {
      return Err(new ValidationError("Invalid fill delegation promise parameters.", action.id, ErrorType.InvalidPromiseParams));
    }
    const params = promise.params as DelegationPromiseParams;
    if (params.player) {
      return Err(new ValidationError("player parameter cannot be used in delegation promises.", action.id, ErrorType.DelegationAuthorityNotAllowed));
    }
    const v = this.delegationManager.validateDelegation({ ...params, from: action.op.account, allowSystemAccounts: false }, action);
    if (!v.ok) return Err(v.error);
    return OkVoid();
  }

  fulfillPromise(_request: HandlerFulfillPromiseRequest, promise: PromiseEntity, action: IAction): HandlerFulfillPromiseResult {
    const params = promise.params as DelegationPromiseParams;
    const logs = this.delegationManager.delegate({ ...params, to: ACCOUNTS.DELEGATION_PROMISES, from: action.op.account, allowSystemAccounts: true }, action);
    return { logs };
  }

  validateFulfillPromises(_request: HandlerFulfillPromisesRequest, promises: PromiseEntity[], action: IAction): Result {
    const promiseParams = promises.map((p) => p.params as DelegationPromiseParams);
    const allSameToken = promiseParams.every((p) => p.token === promiseParams[0].token);
    if (!allSameToken) {
      return Err(new ValidationError("All delegation bids must be for the same token.", action.id, ErrorType.DelegationPromiseTokenMismatch));
    }
    const v = this.delegationManager.validateDelegationMulti(
      { from: action.op.account, token: promiseParams[0].token, to: promiseParams.map((p) => [ACCOUNTS.DELEGATION_PROMISES, p.qty]), allowSystemAccounts: true },
      action,
    );
    if (!v.ok) return Err(v.error);
    return OkVoid();
  }

  fulfillPromises(_request: HandlerFulfillPromisesRequest, promises: PromiseEntity[], action: IAction): HandlerFulfillPromiseResult {
    const logs: EventLog[] = [];
    for (const p of promises) {
      const params = p.params as DelegationPromiseParams;
      logs.push(...this.delegationManager.delegate({ ...params, to: ACCOUNTS.DELEGATION_PROMISES, from: action.op.account, allowSystemAccounts: true }, action));
    }
    return { logs };
  }

  private controllerCheck(promise: PromiseEntity, action: IAction): Result {
    if (!promise.controllers.includes(action.op.account)) {
      return Err(new ValidationError("Account is not a controller of the promise", action.id, ErrorType.NotPromiseController));
    }
    return OkVoid();
  }

  validateReversePromise(_r: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): Result {
    return this.controllerCheck(promise, action);
  }

  reversePromise(_r: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): EventLog[] {
    const params = promise.params as DelegationPromiseParams;
    return this.delegationManager.undelegate(
      { ...params, account: promise.fulfilled_by!, to: promise.fulfilled_by!, from: ACCOUNTS.DELEGATION_PROMISES, allowSystemAccounts: true },
      action,
    );
  }

  override validateCancelPromise(_r: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): Result {
    return this.controllerCheck(promise, action);
  }

  validateCompletePromise(_r: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): Result {
    return this.controllerCheck(promise, action);
  }

  completePromise(_r: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): EventLog[] {
    const params = promise.params as DelegationPromiseParams;
    const undelegateLogs = this.delegationManager.undelegate(
      { ...params, account: promise.fulfilled_by!, to: promise.fulfilled_by!, from: ACCOUNTS.DELEGATION_PROMISES, allowSystemAccounts: true },
      action,
    );
    const delegateLogs = this.delegationManager.delegate({ ...params, from: promise.fulfilled_by!, allowSystemAccounts: false }, action);
    return [...undelegateLogs, ...delegateLogs];
  }

  override getPromisesNotFoundErrorMessage(ids: string[]): string {
    return `Delegation bids with ids [${ids.join(", ")}] not found.`;
  }
  override getPromisesNotOpenErrorMessage(ids: string[]): string {
    return `Delegation bids with ids [${ids.join(", ")}] are not open.`;
  }
}

type DelegationOfferParams = { token: string; qty: number; lender: string; price: number; qty_remaining?: number; source_promise_id?: string };
type DelegationOfferFulfillMetadata = { borrower: string; rental_id: string; qty: number; expiration_blocks: number };

export class DelegationOfferPromiseHandler extends PromiseHandler {
  private static readonly DEFAULT_QTY_DIVISOR = 500;
  private static readonly DEFAULT_MIN_QTY = 500;

  constructor(
    private readonly delegationManager: DelegationManager,
    private readonly rentals: RentalDelegationRepository,
    private readonly promises: PromiseRepository,
    private readonly config: ConfigLoader,
  ) {
    super();
  }

  private get qtyDivisor(): number {
    return this.config.delegation_rental?.qty_divisor ?? DelegationOfferPromiseHandler.DEFAULT_QTY_DIVISOR;
  }
  private get minQty(): number {
    return this.config.delegation_rental?.min_qty ?? DelegationOfferPromiseHandler.DEFAULT_MIN_QTY;
  }

  validateCreatePromise(request: HandlerCreatePromiseRequest, action: IAction): Result<HandlerCreatePromiseResult> {
    if (request.fulfill_timeout_seconds !== undefined && request.fulfill_timeout_seconds !== null) {
      return Err(new ValidationError("Delegation offer promises cannot have a fulfill_timeout_seconds.", action.id, ErrorType.InvalidPromiseParams));
    } else if (request.id) {
      return Err(new ValidationError("id parameter must not be provided. Promise ID is auto-generated by the system.", action.id, ErrorType.InvalidPromiseParams));
    }
    if (!delegation_offer_params_schema.isValidSync(request.params)) {
      return Err(new ValidationError("Invalid delegation offer parameters.", action.id, ErrorType.InvalidPromiseParams));
    }
    const params = request.params as DelegationOfferParams;
    const qtyDivisor = this.qtyDivisor;
    if (qtyDivisor > 1 && params.qty % qtyDivisor !== 0) {
      return Err(new ValidationError(`Offer qty must be a multiple of ${qtyDivisor}.`, action.id, ErrorType.InvalidPromiseParams));
    }
    const minQty = this.minQty;
    if (minQty > 0 && params.qty < minQty) {
      return Err(new ValidationError(`Offer qty must be at least ${minQty}.`, action.id, ErrorType.InvalidPromiseParams));
    }
    if (params.lender !== action.op.account) {
      if (!params.source_promise_id) {
        return Err(new ValidationError("Controller must provide source_promise_id to create offer on behalf of lender.", action.id, ErrorType.NoAuthority));
      }
      const sourcePromise = this.promises.getPromiseByTypeAndId("delegation_offer", params.source_promise_id);
      if (!sourcePromise) {
        return Err(new ValidationError(`Source promise ${params.source_promise_id} not found.`, action.id, ErrorType.InvalidPromise));
      }
      if (!sourcePromise.controllers.includes(action.op.account)) {
        return Err(new ValidationError("Account is not a controller on the source promise.", action.id, ErrorType.NotPromiseController));
      }
      const sourceParams = sourcePromise.params as DelegationOfferParams;
      if (sourceParams.lender !== params.lender) {
        return Err(new ValidationError("Source promise lender does not match the lender in the new promise.", action.id, ErrorType.NoAuthority));
      }
    }
    const v = this.delegationManager.validateDelegation(
      { from: params.lender, to: ACCOUNTS.DELEGATION_PROMISES, qty: params.qty, token: params.token, allowSystemAccounts: true, skipAuthorityCheck: true },
      action,
    );
    if (!v.ok) return Err(v.error);
    return Ok({ allowNonAdmin: true });
  }

  createPromise(request: HandlerCreatePromiseRequest, action: IAction): HandlerCreateResult {
    const params = request.params as DelegationOfferParams;
    const storedParams: DelegationOfferParams = { ...params, qty_remaining: params.qty };
    const logs = this.delegationManager.delegate(
      { from: params.lender, to: ACCOUNTS.DELEGATION_PROMISES, qty: params.qty, token: params.token, allowSystemAccounts: true, skipDateUpdate: true },
      action,
    );
    return { logs, params: storedParams };
  }

  validateFulfillPromise(request: HandlerFulfillPromiseRequest, promise: PromiseEntity, action: IAction): Result {
    if (!delegation_offer_params_schema.isValidSync(promise.params)) {
      return Err(new ValidationError("Invalid delegation offer promise parameters.", action.id, ErrorType.InvalidPromiseParams));
    }
    if (!delegation_offer_fulfill_metadata_schema.isValidSync(request.metadata)) {
      return Err(new ValidationError("Invalid delegation offer fulfill metadata. Must include borrower, rental_id, and qty.", action.id, ErrorType.InvalidPromiseParams));
    }
    const params = promise.params as DelegationOfferParams;
    const metadata = request.metadata as DelegationOfferFulfillMetadata;
    const qtyRemaining = params.qty_remaining ?? params.qty;
    if (!promise.controllers.includes(action.op.account)) {
      return Err(new ValidationError("Only controllers can fulfill delegation offers.", action.id, ErrorType.NoAuthority));
    }
    if (metadata.borrower === params.lender) {
      return Err(new ValidationError("Cannot rent delegation to yourself.", action.id, ErrorType.CannotDelegateToSelf));
    }
    if (metadata.qty > qtyRemaining) {
      return Err(new ValidationError(`Fill qty ${metadata.qty} exceeds remaining offer qty ${qtyRemaining}.`, action.id, ErrorType.InsufficientBalance));
    }
    const qtyDivisor = this.qtyDivisor;
    if (qtyDivisor > 1 && metadata.qty % qtyDivisor !== 0) {
      return Err(new ValidationError(`Fill qty must be a multiple of ${qtyDivisor}.`, action.id, ErrorType.InvalidPromiseParams));
    }
    const minQty = this.minQty;
    if (minQty > 0 && metadata.qty < minQty) {
      return Err(new ValidationError(`Fill qty must be at least ${minQty}.`, action.id, ErrorType.InvalidPromiseParams));
    }
    if (this.rentals.exists(metadata.rental_id)) {
      return Err(new ValidationError(`Rental delegation with id ${metadata.rental_id} already exists.`, action.id, ErrorType.PromiseAlreadyExists));
    }
    return OkVoid();
  }

  fulfillPromise(request: HandlerFulfillPromiseRequest, promise: PromiseEntity, action: IAction): HandlerFulfillPromiseResult {
    const params = promise.params as DelegationOfferParams;
    const metadata = request.metadata as DelegationOfferFulfillMetadata;
    const fillQty = metadata.qty;
    const qtyRemaining = params.qty_remaining ?? params.qty;
    const newQtyRemaining = qtyRemaining - fillQty;
    const logs: EventLog[] = [];
    logs.push(
      ...this.delegationManager.undelegate(
        { account: params.lender, to: params.lender, from: ACCOUNTS.DELEGATION_PROMISES, qty: fillQty, token: params.token, allowSystemAccounts: true, skipDateUpdate: true },
        action,
      ),
    );
    logs.push(
      ...this.delegationManager.delegate(
        { from: params.lender, to: metadata.borrower, qty: fillQty, token: params.token, allowSystemAccounts: false, skipDateUpdate: true },
        action,
      ),
    );
    const [, rentalLogs] = this.rentals.create(
      {
        id: metadata.rental_id,
        promise_type: "delegation_offer",
        promise_ext_id: promise.ext_id,
        lender: params.lender,
        borrower: metadata.borrower,
        token: params.token,
        qty: fillQty,
        expiration_blocks: metadata.expiration_blocks,
        start_block: action.op.block_num,
      },
      action,
    );
    logs.push(...rentalLogs);
    const updatedParams: DelegationOfferParams = { ...params, qty_remaining: newQtyRemaining };
    return { logs, updatedParams, status: newQtyRemaining > 0 ? "open" : "completed" };
  }

  validateFulfillPromises(request: HandlerFulfillPromisesRequest, promises: PromiseEntity[], action: IAction): Result {
    for (const promise of promises) {
      const r = this.validateFulfillPromise({ type: request.type, id: promise.ext_id, metadata: request.metadata }, promise, action);
      if (!r.ok) return r;
    }
    return OkVoid();
  }

  fulfillPromises(request: HandlerFulfillPromisesRequest, promises: PromiseEntity[], action: IAction): HandlerFulfillPromiseResult {
    const logs: EventLog[] = [];
    let last: HandlerFulfillPromiseResult = { logs: [] };
    for (const promise of promises) {
      last = this.fulfillPromise({ type: request.type, id: promise.ext_id, metadata: request.metadata }, promise, action);
      logs.push(...last.logs);
    }
    return { logs, status: last.status, updatedParams: last.updatedParams };
  }

  validateReversePromise(_r: HandlerPromiseRequest, _p: PromiseEntity, action: IAction): Result {
    return Err(new ValidationError("Delegation offer promises cannot be reversed.", action.id, ErrorType.InvalidPromiseStatus));
  }
  reversePromise(): EventLog[] {
    return [];
  }
  validateCompletePromise(_r: HandlerPromiseRequest, _p: PromiseEntity, action: IAction): Result {
    return Err(
      new ValidationError("Delegation offer promises are completed automatically when fully filled. Manual completion is not allowed.", action.id, ErrorType.InvalidPromiseStatus),
    );
  }
  completePromise(): EventLog[] {
    return [];
  }
  override validateCancelPromise(_r: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): Result {
    const params = promise.params as DelegationOfferParams;
    if (action.op.account !== params.lender) {
      return Err(new ValidationError("Only the lender can cancel delegation offer promises.", action.id, ErrorType.NoAuthority));
    }
    return OkVoid();
  }
  override cancelPromise(_r: HandlerPromiseRequest, promise: PromiseEntity, action: IAction): EventLog[] {
    const params = promise.params as DelegationOfferParams;
    const qtyRemaining = params.qty_remaining ?? params.qty;
    const logs: EventLog[] = [];
    if (qtyRemaining > 0) {
      logs.push(
        ...this.delegationManager.undelegate(
          { account: params.lender, to: params.lender, from: ACCOUNTS.DELEGATION_PROMISES, qty: qtyRemaining, token: params.token, allowSystemAccounts: true, skipDateUpdate: true },
          action,
        ),
      );
    }
    return logs;
  }
  override getPromisesNotFoundErrorMessage(ids: string[]): string {
    return `Delegation offers with ids [${ids.join(", ")}] not found.`;
  }
  override getPromisesNotOpenErrorMessage(ids: string[]): string {
    return `Delegation offers with ids [${ids.join(", ")}] are not open.`;
  }
}

// ---------------------------------------------------------------------------
// manager
// ---------------------------------------------------------------------------
export type CreatePromiseRequest = { type: string; id: string | null; controllers: string[]; fulfill_timeout_seconds?: number; params: unknown };
export type FulfillPromiseRequest = { type: string; id: string; metadata: unknown };
export type FulfillPromisesRequest = { type: string; ids: string[]; metadata: unknown };

export class PromiseManager {
  private static readonly EXPIRATION_ACCOUNT = ACCOUNTS.PROMISE_EXPIRATION;

  constructor(
    private readonly customJsonId: string,
    private readonly config: ConfigLoader,
    private readonly promises: PromiseRepository,
    private readonly delegationHandler: DelegationPromiseHandler,
    private readonly delegationOfferHandler: DelegationOfferPromiseHandler,
  ) {}

  private route(block_num: number, type: string): PromiseHandler | null {
    const t = TRANSITION_POINTS.delegation_offer_block;
    if (type === "delegation" && block_num < t) return this.delegationHandler;
    if (type === "delegation_offer" && block_num >= t) return this.delegationOfferHandler;
    return null;
  }

  process(block: BlockRef): ProcessResult[] {
    if (this.promises.countExpiredPromises(block.block_time) === 0) return [];
    return [
      [
        "custom_json",
        {
          required_auths: [PromiseManager.EXPIRATION_ACCOUNT],
          required_posting_auths: [],
          id: this.customJsonId,
          json: { action: "expire_promises", params: { now: block.block_time } },
        },
      ],
    ];
  }

  trx_id(block: BlockRef): string {
    return `sl_expire_promises_${block.block_num}`;
  }

  expirePromises(now: Date, action: IAction): EventLog[] {
    const logs: EventLog[] = [];
    for (const p of this.promises.getExpiredPromises(now)) {
      logs.push(...this.reversePromise({ type: p.type, id: p.ext_id }, action));
    }
    return logs;
  }

  private resolvePromiseId(request: CreatePromiseRequest, action: IAction): string {
    return request.id ?? action.unique_trx_id;
  }

  validateCreatePromise(request: CreatePromiseRequest, action: IAction): Result {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) return Err(new ValidationError("Invalid promise type", action.id, ErrorType.InvalidPromiseType));
    const hr = handler.validateCreatePromise(request, action);
    if (!hr.ok) return hr;
    const promiseId = this.resolvePromiseId(request, action);
    const allowNonAdmin = hr.value.allowNonAdmin ?? false;
    if (!allowNonAdmin && !this.config.isAdmin(action.op.account)) {
      return Err(new ValidationError("Only admins can create promises", action.id, ErrorType.AdminOnly));
    }
    if (this.promises.getPromiseByTypeAndId(request.type, promiseId)) {
      return Err(new ValidationError("Promise already exists", action.id, ErrorType.PromiseAlreadyExists));
    }
    return OkVoid();
  }

  createPromise(request: CreatePromiseRequest, action: IAction): EventLog[] {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) throw new Error("Invalid promise type");
    const promiseId = this.resolvePromiseId(request, action);
    const hr = handler.createPromise({ ...request, id: promiseId }, action);
    const [, insertLogs] = this.promises.insert(
      {
        actor: action.op.account,
        type: request.type,
        ext_id: promiseId,
        controllers: request.controllers,
        params: hr.params ?? request.params,
        fulfill_timeout_seconds: request.fulfill_timeout_seconds ?? null,
        status: "open",
      },
      action,
    );
    return [...insertLogs, ...hr.logs];
  }

  validateFulfillPromise(request: FulfillPromiseRequest, action: IAction): Result {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) return Err(new ValidationError("Invalid promise type", action.id, ErrorType.InvalidPromiseType));
    const promise = this.promises.getPromiseByTypeAndId(request.type, request.id);
    if (!promise) return Err(new ValidationError(handler.getPromisesNotFoundErrorMessage([request.id]), action.id, ErrorType.InvalidPromise));
    if (promise.status !== "open") return Err(new ValidationError(handler.getPromisesNotOpenErrorMessage([request.id]), action.id, ErrorType.InvalidPromiseStatus));
    const hr = handler.validateFulfillPromise(request, promise, action);
    if (!hr.ok) return hr;
    return OkVoid();
  }

  fulfillPromise(request: FulfillPromiseRequest, action: IAction): EventLog[] {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) throw new Error("Invalid promise type");
    const promise = this.promises.getPromiseByTypeAndId(request.type, request.id)!;
    const hr = handler.fulfillPromise(request, promise, action);
    const targetStatus = hr.status ?? "fulfilled";
    if (targetStatus === "open") {
      const [, updateLogs] = this.promises.update(
        { action: "fulfill", previous_status: promise.status, actor: action.op.account, type: promise.type, ext_id: promise.ext_id, status: "open", fulfilled_at: null, fulfilled_by: null, fulfilled_expiration: null },
        action,
      );
      const paramLogs: EventLog[] = [];
      if (hr.updatedParams) paramLogs.push(...this.promises.updateParams(promise.type, promise.ext_id, hr.updatedParams, action));
      return [...updateLogs, ...paramLogs, ...hr.logs];
    }
    const fulfillExpiration = promise.fulfill_timeout_seconds !== null ? new Date(action.op.block_time.getTime() + promise.fulfill_timeout_seconds * 1000) : null;
    // params must be updated before the row is moved to the compact store
    const prevStatus = promise.status;
    const row = promise;
    row.status = targetStatus;
    row.fulfilled_at = action.op.block_time;
    row.fulfilled_by = action.op.account;
    row.fulfilled_expiration = targetStatus === "completed" ? null : fulfillExpiration;
    row.updated_date = action.op.block_time;
    const updateLogs = [
      new EventLog("update", "promise", entityData(row)),
      new EventLog("insert", "promise_history", {
        type: row.type,
        ext_id: row.ext_id,
        player: action.op.account,
        action: targetStatus === "completed" ? "complete" : "fulfill",
        previous_status: prevStatus,
        new_status: row.status,
        trx_id: action.unique_trx_id,
        created_date: action.op.block_time,
      }),
    ];
    const paramLogs: EventLog[] = [];
    if (hr.updatedParams) paramLogs.push(...this.promises.updateParams(promise.type, promise.ext_id, hr.updatedParams, action));
    this.promises.closeIfFinal(promise.type, promise.ext_id);
    return [...updateLogs, ...paramLogs, ...hr.logs];
  }

  validateFulfillPromises(request: FulfillPromisesRequest, action: IAction): Result {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) return Err(new ValidationError("Invalid promise type", action.id, ErrorType.InvalidPromiseType));
    const ids = [...new Set(request.ids)];
    const promises = this.promises.getPromisesByTypeAndIds(request.type, ids);
    const notFound = ids.filter((id) => !promises.some((p) => p.ext_id === id));
    if (notFound.length > 0) return Err(new ValidationError(handler.getPromisesNotFoundErrorMessage(notFound), action.id, ErrorType.InvalidPromise));
    const notOpen = promises.filter((p) => p.status !== "open").map((p) => p.ext_id);
    if (notOpen.length > 0) return Err(new ValidationError(handler.getPromisesNotOpenErrorMessage(notOpen), action.id, ErrorType.InvalidPromiseStatus));
    const hr = handler.validateFulfillPromises(request, promises, action);
    if (!hr.ok) return hr;
    return OkVoid();
  }

  fulfillPromises(request: FulfillPromisesRequest, action: IAction): EventLog[] {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) throw new Error("Invalid promise type");
    const ids = [...new Set(request.ids)];
    const promises = this.promises.getPromisesByTypeAndIds(request.type, ids);
    const hr = handler.fulfillPromises(request, promises, action);
    const targetStatus = hr.status ?? "fulfilled";
    if (targetStatus === "open") {
      const [, updateLogs] = this.promises.updateMultiple(
        { action: "fulfill", previous_status: "open", actor: action.op.account, type: request.type, ext_ids: promises.map((p) => p.ext_id), status: "open", fulfilled_at: null, fulfilled_by: null, fulfilled_expiration: null },
        action,
      );
      if (hr.updatedParams) for (const p of promises) updateLogs.push(...this.promises.updateParams(p.type, p.ext_id, hr.updatedParams, action));
      return [...updateLogs, ...hr.logs];
    }
    const grouped = new Map<number | null, PromiseEntity[]>();
    const groupedDates = new Map<number | null, Date | null>();
    for (const p of promises) {
      const expiration = p.fulfill_timeout_seconds !== null ? new Date(action.op.block_time.getTime() + p.fulfill_timeout_seconds * 1000) : null;
      // upstream keys the map by Date object identity: every non-null date is its own group
      const key = expiration === null ? null : grouped.size + 1;
      grouped.set(key, [...(grouped.get(key) ?? []), p]);
      groupedDates.set(key, expiration);
    }
    const updateLogs: EventLog[] = [];
    const final: PromiseEntity[] = [];
    for (const [key, group] of grouped) {
      const expiration = groupedDates.get(key) ?? null;
      for (const p of group) {
        const prev = p.status;
        p.status = targetStatus;
        p.fulfilled_at = action.op.block_time;
        p.fulfilled_by = action.op.account;
        p.fulfilled_expiration = targetStatus === "completed" ? null : expiration;
        p.updated_date = action.op.block_time;
        updateLogs.push(new EventLog("update", "promise", entityData(p)));
        updateLogs.push(
          new EventLog("insert", "promise_history", {
            type: p.type,
            ext_id: p.ext_id,
            player: action.op.account,
            action: targetStatus === "completed" ? "complete" : "fulfill",
            previous_status: prev,
            new_status: p.status,
            trx_id: action.unique_trx_id,
            created_date: action.op.block_time,
          }),
        );
        final.push(p);
      }
    }
    if (hr.updatedParams) for (const p of promises) updateLogs.push(...this.promises.updateParams(p.type, p.ext_id, hr.updatedParams, action));
    for (const p of final) this.promises.closeIfFinal(p.type, p.ext_id);
    return [...updateLogs, ...hr.logs];
  }

  validateReversePromise(request: HandlerPromiseRequest, action: IAction): Result {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) return Err(new ValidationError("Invalid promise type", action.id, ErrorType.InvalidPromiseType));
    const promise = this.promises.getPromiseByTypeAndId(request.type, request.id);
    if (!promise) return Err(new ValidationError("Promise not found", action.id, ErrorType.InvalidPromise));
    if (promise.status !== "fulfilled") return Err(new ValidationError("Promise is not fulfilled", action.id, ErrorType.InvalidPromiseStatus));
    const hr = handler.validateReversePromise(request, promise, action);
    if (!hr.ok) return hr;
    return OkVoid();
  }

  reversePromise(request: HandlerPromiseRequest, action: IAction): EventLog[] {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) throw new Error("Invalid promise type");
    const promise = this.promises.getPromiseByTypeAndId(request.type, request.id)!;
    const handlerLogs = handler.reversePromise(request, promise, action);
    const [, updateLogs] = this.promises.update(
      { action: "reverse", previous_status: promise.status, actor: action.op.account, type: promise.type, ext_id: promise.ext_id, status: "open", fulfilled_at: null, fulfilled_by: null, fulfilled_expiration: null },
      action,
    );
    return [...updateLogs, ...handlerLogs];
  }

  validateCancelPromise(request: HandlerPromiseRequest, action: IAction): Result {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) return Err(new ValidationError("Invalid promise type", action.id, ErrorType.InvalidPromiseType));
    const promise = this.promises.getPromiseByTypeAndId(request.type, request.id);
    if (!promise) return Err(new ValidationError("Promise not found", action.id, ErrorType.InvalidPromise));
    if (promise.status !== "open" && promise.status !== "fulfilled") return Err(new ValidationError("Promise is not open", action.id, ErrorType.InvalidPromiseStatus));
    const hr = handler.validateCancelPromise(request, promise, action);
    if (!hr.ok) return hr;
    return OkVoid();
  }

  cancelPromise(request: HandlerPromiseRequest, action: IAction): EventLog[] {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) throw new Error("Invalid promise type");
    const promise = this.promises.getPromiseByTypeAndId(request.type, request.id)!;
    const handlerLogs: EventLog[] = [];
    if (promise.status === "fulfilled") handlerLogs.push(...handler.reversePromise({ type: request.type, id: request.id }, promise, action));
    handlerLogs.push(...handler.cancelPromise(request, promise, action));
    const [, updateLogs] = this.promises.update(
      { action: "cancel", previous_status: promise.status, actor: action.op.account, type: promise.type, ext_id: promise.ext_id, status: "cancelled", fulfilled_at: null, fulfilled_by: null, fulfilled_expiration: null },
      action,
    );
    return [...updateLogs, ...handlerLogs];
  }

  validateCompletePromise(request: HandlerPromiseRequest, action: IAction): Result {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) return Err(new ValidationError("Invalid promise type", action.id, ErrorType.InvalidPromiseType));
    const promise = this.promises.getPromiseByTypeAndId(request.type, request.id);
    if (!promise) return Err(new ValidationError("Promise not found", action.id, ErrorType.InvalidPromise));
    if (promise.status !== "fulfilled") return Err(new ValidationError("Promise is not fulfilled", action.id, ErrorType.InvalidPromiseStatus));
    const hr = handler.validateCompletePromise(request, promise, action);
    if (!hr.ok) return hr;
    return OkVoid();
  }

  completePromise(request: HandlerPromiseRequest, action: IAction): EventLog[] {
    const handler = this.route(action.op.block_num, request.type);
    if (!handler) throw new Error("Invalid promise type");
    const promise = this.promises.getPromiseByTypeAndId(request.type, request.id)!;
    const handlerLogs = handler.completePromise(request, promise, action);
    const [, updateLogs] = this.promises.update(
      { action: "complete", previous_status: promise.status, actor: action.op.account, type: promise.type, ext_id: promise.ext_id, status: "completed", fulfilled_at: action.op.block_time, fulfilled_by: action.op.account, fulfilled_expiration: null },
      action,
    );
    return [...updateLogs, ...handlerLogs];
  }
}
