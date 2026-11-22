/**
 * In-memory state. Numeric columns are stored as scaled BigInts (thousandths
 * for numeric(x,3)) so that arithmetic matches PostgreSQL exactly.
 */
import { Hash64Map, Hash64Set } from "../util/hash64.mjs";
import { formatScaled, scaledToNumber } from "../util/num.mjs";
import { pgCompare } from "../util/collate.mjs";
import type { BlockRow } from "../types.mjs";

const SEP = "\u0000";

// ---------------------------------------------------------------------------
// balances
// ---------------------------------------------------------------------------
export class Balances {
  private map = new Map<string, bigint>();
  private byPlayer = new Map<string, Set<string>>();

  /** Scaled (thousandths) balance; 0n if no row. */
  getScaled(player: string, token: string): bigint {
    return this.map.get(player + SEP + token) ?? 0n;
  }

  /** parseFloat(numeric text) like upstream getBalance. */
  get(player: string, token: string): number {
    return scaledToNumber(this.getScaled(player, token), 3);
  }

  getText(player: string, token: string): string {
    return formatScaled(this.getScaled(player, token), 3);
  }

  set(player: string, token: string, scaled: bigint): void {
    const key = player + SEP + token;
    if (!this.map.has(key)) {
      let tokens = this.byPlayer.get(player);
      if (!tokens) {
        tokens = new Set();
        this.byPlayer.set(player, tokens);
      }
      tokens.add(token);
    }
    this.map.set(key, scaled);
  }

  /** Ensure a row exists (upstream getBalance inserts a zero row). */
  ensure(player: string, token: string): void {
    if (!this.map.has(player + SEP + token)) this.set(player, token, 0n);
  }

  /** Whether a balances row exists (a JOIN on balances needs the row, not a zero default). */
  has(player: string, token: string): boolean {
    return this.map.has(player + SEP + token);
  }

  /** Every row (unordered). */
  *rows(): IterableIterator<{ player: string; token: string; balance: bigint }> {
    for (const [k, balance] of this.map) {
      const i = k.lastIndexOf(SEP);
      yield { player: k.slice(0, i), token: k.slice(i + 1), balance };
    }
  }

  /** Rows for a player ordered by token (pg collation). */
  getBalances(player: string): { player: string; token: string; balance: number }[] {
    const tokens = Array.from(this.byPlayer.get(player) ?? []);
    tokens.sort(pgCompare);
    return tokens.map((token) => ({ player, token, balance: this.get(player, token) }));
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// hive accounts
// ---------------------------------------------------------------------------
export class HiveAccounts {
  private names: Hash64Set;
  private authority = new Map<string, Record<string, string[]>>();

  constructor(expected = 3_000_000) {
    this.names = new Hash64Set(expected);
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  add(name: string): void {
    this.names.add(name);
  }

  getAuthority(name: string): Record<string, string[]> | undefined {
    if (!this.names.has(name)) return undefined;
    return this.authority.get(name) ?? {};
  }

  setAuthority(name: string, authority: Record<string, string[]>): void {
    this.authority.set(name, authority);
  }

  /** Names are stored only as 64-bit hashes; export/import them as such. */
  nameHashes(): IterableIterator<[number, number]> {
    return this.names.hashes();
  }

  addHash(a: number, b: number): void {
    this.names.addHash(a, b);
  }

  authorities(): IterableIterator<[string, Record<string, string[]>]> {
    return this.authority.entries();
  }

  get size(): number {
    return this.names.size;
  }
}

// ---------------------------------------------------------------------------
// validators & votes
// ---------------------------------------------------------------------------
export interface ValidatorRow {
  account_name: string;
  reward_account: string | null;
  is_active: boolean;
  post_url: string | null;
  total_votes: bigint; // numeric(12,3) scaled
  missed_blocks: number;
  api_url: string | null;
  last_version: string | null;
  consecutive_missed_blocks: number;
}

export class Validators {
  private map = new Map<string, ValidatorRow>();

  get(account: string): ValidatorRow | undefined {
    return this.map.get(account);
  }

  set(row: ValidatorRow): void {
    this.map.set(row.account_name, row);
  }

  all(): ValidatorRow[] {
    return Array.from(this.map.values());
  }
}

export class Votes {
  /** voter -> validator -> vote_weight (numeric(12,3) scaled) */
  private byVoter = new Map<string, Map<string, bigint>>();
  private byValidator = new Map<string, Set<string>>();

  getByVoter(voter: string): { voter: string; validator: string; vote_weight: bigint }[] {
    const m = this.byVoter.get(voter);
    if (!m) return [];
    return Array.from(m.entries()).map(([validator, vote_weight]) => ({ voter, validator, vote_weight }));
  }

  /** Every vote row, in insertion order. */
  *rows(): IterableIterator<{ voter: string; validator: string; vote_weight: bigint }> {
    for (const [voter, m] of this.byVoter) for (const [validator, vote_weight] of m) yield { voter, validator, vote_weight };
  }

  /** Every voter with at least one vote (unordered). */
  voters(): string[] {
    return Array.from(this.byVoter.keys());
  }

  votersOf(validator: string): string[] {
    return Array.from(this.byValidator.get(validator) ?? []);
  }

  set(voter: string, validator: string, weight: bigint): void {
    let m = this.byVoter.get(voter);
    if (!m) {
      m = new Map();
      this.byVoter.set(voter, m);
    }
    m.set(validator, weight);
    let s = this.byValidator.get(validator);
    if (!s) {
      s = new Set();
      this.byValidator.set(validator, s);
    }
    s.add(voter);
  }

  delete(voter: string, validator: string): bigint | undefined {
    const m = this.byVoter.get(voter);
    if (!m) return undefined;
    const w = m.get(validator);
    if (w === undefined) return undefined;
    m.delete(validator);
    if (m.size === 0) this.byVoter.delete(voter);
    this.byValidator.get(validator)?.delete(voter);
    return w;
  }

  /** SUM(vote_weight) for a validator, exact. */
  sum(validator: string): bigint {
    let total = 0n;
    for (const voter of this.byValidator.get(validator) ?? []) {
      total += this.byVoter.get(voter)!.get(validator)!;
    }
    return total;
  }
}

// ---------------------------------------------------------------------------
// check-ins
// ---------------------------------------------------------------------------
export interface CheckInRow {
  account: string;
  status: "active" | "inactive";
  last_check_in_block_num: number;
  last_check_in: Date;
}

export class CheckIns {
  private map = new Map<string, CheckInRow>();
  get(account: string): CheckInRow | undefined {
    return this.map.get(account);
  }
  set(row: CheckInRow): void {
    this.map.set(row.account, row);
  }
  all(): CheckInRow[] {
    return Array.from(this.map.values());
  }
}

// ---------------------------------------------------------------------------
// token unstaking
// ---------------------------------------------------------------------------
export interface UnstakingRow {
  player: string;
  unstake_tx: string;
  unstake_start_date: Date;
  is_active: boolean;
  token: string;
  total_qty: bigint; // scaled 3
  next_unstake_date: Date;
  total_unstaked: bigint; // scaled 3
  unstaking_periods: number;
  unstaking_interval_seconds: number;
  cancel_tx: string | null;
}

export class Unstaking {
  private map = new Map<string, UnstakingRow>();

  get(unstakeTx: string): UnstakingRow | undefined {
    return this.map.get(unstakeTx);
  }

  set(row: UnstakingRow): void {
    this.map.set(row.unstake_tx, row);
  }

  /** Active record for player/token (upstream `lookup`, first match). */
  lookupActive(player: string, token: string): UnstakingRow | undefined {
    for (const r of this.map.values()) {
      if (r.is_active && r.player === player && r.token === token) return r;
    }
    return undefined;
  }

  active(): UnstakingRow[] {
    return Array.from(this.map.values()).filter((r) => r.is_active);
  }

  all(): UnstakingRow[] {
    return Array.from(this.map.values());
  }

  /** Drop inactive rows to bound memory (they are never read again). */
  prune(): void {
    for (const [k, r] of this.map) if (!r.is_active) this.map.delete(k);
  }
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
export interface ConfigRow {
  group_name: string;
  group_type: string;
  name: string;
  index: number;
  value_type: string;
  value: string | null;
  last_updated_date: Date | null;
  last_updated_tx: string | null;
}

export class ConfigRows {
  private rows = new Map<string, ConfigRow>();
  get(group: string, name: string): ConfigRow | undefined {
    return this.rows.get(group + SEP + name);
  }
  set(row: ConfigRow): void {
    this.rows.set(row.group_name + SEP + row.name, row);
  }
  all(): ConfigRow[] {
    return Array.from(this.rows.values());
  }
}

// ---------------------------------------------------------------------------
// promises
// ---------------------------------------------------------------------------
export type PromiseStatus = "open" | "fulfilled" | "completed" | "cancelled";

export interface PromiseRow {
  ext_id: string;
  type: string;
  status: PromiseStatus;
  params: unknown;
  controllers: string[];
  fulfill_timeout_seconds: number | null;
  fulfilled_by: string | null;
  fulfilled_at: Date | null;
  fulfilled_expiration: Date | null;
  created_date: Date;
  updated_date: Date;
}

/** Compact record for promises that are no longer open/fulfilled. */
export interface ClosedPromise {
  status: PromiseStatus;
  lender: string | undefined;
  controllers: string[];
}

export class Promises {
  /** open / fulfilled promises, full rows, keyed by type|ext_id */
  private live = new Map<string, PromiseRow>();
  /** completed / cancelled promises, compact */
  private closed: Hash64Map;
  private lenders: string[] = [];
  private lenderIdx = new Map<string, number>();
  private controllerSets: string[][] = [];
  private controllerIdx = new Map<string, number>();

  constructor(expectedClosed = 2_000_000) {
    this.closed = new Hash64Map(expectedClosed);
  }

  private key(type: string, id: string): string {
    return type + SEP + id;
  }

  getLive(type: string, id: string): PromiseRow | undefined {
    return this.live.get(this.key(type, id));
  }

  getClosed(type: string, id: string): ClosedPromise | undefined {
    const v = this.closed.get(this.key(type, id));
    if (v === undefined) return undefined;
    const status = (v & 3) === 1 ? "completed" : "cancelled";
    const controllers = this.controllerSets[(v >>> 2) & 0xff];
    const lenderI = v >>> 10;
    const lender = lenderI === 0 ? undefined : this.lenders[lenderI - 1];
    return { status, lender, controllers };
  }

  setLive(row: PromiseRow): void {
    this.live.set(this.key(row.type, row.ext_id), row);
  }

  /** Move a promise into the compact closed store. */
  close(type: string, id: string, status: "completed" | "cancelled", lender: string | undefined, controllers: string[]): void {
    this.live.delete(this.key(type, id));
    this.closed.set(this.key(type, id), this.pack(status, lender, controllers));
  }

  pack(status: "completed" | "cancelled", lender: string | undefined, controllers: string[]): number {
    const s = status === "completed" ? 1 : 2;
    const ckey = controllers.join(",");
    let ci = this.controllerIdx.get(ckey);
    if (ci === undefined) {
      ci = this.controllerSets.length;
      if (ci > 255) throw new Error("too many distinct controller sets");
      this.controllerSets.push(controllers.slice());
      this.controllerIdx.set(ckey, ci);
    }
    let li = 0;
    if (lender !== undefined) {
      const existing = this.lenderIdx.get(lender);
      if (existing === undefined) {
        this.lenders.push(lender);
        li = this.lenders.length;
        this.lenderIdx.set(lender, li);
      } else {
        li = existing;
      }
    }
    if (li >= 1 << 21) throw new Error("too many lenders");
    return (li << 10) | (ci << 2) | s;
  }

  addClosedPacked(type: string, id: string, packed: number): void {
    this.closed.set(this.key(type, id), packed);
  }

  /** Lookup tables the packed closed values index into. */
  closedTables(): { lenders: string[]; controller_sets: string[][] } {
    return { lenders: this.lenders.slice(), controller_sets: this.controllerSets.map((c) => c.slice()) };
  }

  /** Replace the lookup tables (seed import, before addClosedHash). */
  setClosedTables(t: { lenders: string[]; controller_sets: string[][] }): void {
    this.lenders = t.lenders.slice();
    this.lenderIdx = new Map(this.lenders.map((l, i) => [l, i + 1]));
    this.controllerSets = t.controller_sets.map((c) => c.slice());
    this.controllerIdx = new Map(this.controllerSets.map((c, i) => [c.join(","), i]));
  }

  closedEntries(): IterableIterator<[number, number, number]> {
    return this.closed.entries();
  }

  addClosedHash(a: number, b: number, packed: number): void {
    this.closed.setHash(a, b, packed);
  }

  liveRows(): PromiseRow[] {
    return Array.from(this.live.values());
  }

  get liveCount(): number {
    return this.live.size;
  }

  get closedCount(): number {
    return this.closed.size;
  }
}

// ---------------------------------------------------------------------------
// rental delegations
// ---------------------------------------------------------------------------
export type RentalStatus = "pending" | "active" | "expired" | "cancelled";

export interface RentalRow {
  id: string;
  promise_type: string;
  promise_ext_id: string;
  lender: string;
  borrower: string;
  token: string;
  qty: bigint; // scaled 3
  expiration_block: number;
  start_block: number;
  expiration_blocks: number;
  status: RentalStatus;
  created_date: Date;
  updated_date: Date;
}

export class Rentals {
  private active = new Map<string, RentalRow>();
  private allIds: Hash64Set;
  private byPair = new Map<string, Set<string>>();
  private byExpiration = new Map<number, Set<string>>();

  constructor(expectedAll = 2_000_000) {
    this.allIds = new Hash64Set(expectedAll);
  }

  private pairKey(lender: string, borrower: string, token: string): string {
    return lender + SEP + borrower + SEP + token;
  }

  exists(id: string): boolean {
    return this.allIds.has(id);
  }

  getActive(id: string): RentalRow | undefined {
    return this.active.get(id);
  }

  /** Register an id without storing the row (for historical rentals). */
  rememberId(id: string): void {
    this.allIds.add(id);
  }

  insertActive(row: RentalRow): void {
    this.allIds.add(row.id);
    this.active.set(row.id, row);
    const pk = this.pairKey(row.lender, row.borrower, row.token);
    let s = this.byPair.get(pk);
    if (!s) {
      s = new Set();
      this.byPair.set(pk, s);
    }
    s.add(row.id);
    let e = this.byExpiration.get(row.expiration_block);
    if (!e) {
      e = new Set();
      this.byExpiration.set(row.expiration_block, e);
    }
    e.add(row.id);
  }

  deactivate(id: string): void {
    const row = this.active.get(id);
    if (!row) return;
    this.active.delete(id);
    const pk = this.pairKey(row.lender, row.borrower, row.token);
    this.byPair.get(pk)?.delete(id);
    if (this.byPair.get(pk)?.size === 0) this.byPair.delete(pk);
    this.byExpiration.get(row.expiration_block)?.delete(id);
    if (this.byExpiration.get(row.expiration_block)?.size === 0) this.byExpiration.delete(row.expiration_block);
  }

  /** Active rentals with expiration_block <= block, ordered by expiration_block, id. */
  expired(block: number): RentalRow[] {
    const blocks = Array.from(this.byExpiration.keys())
      .filter((b) => b <= block)
      .sort((a, b) => a - b);
    const out: RentalRow[] = [];
    for (const b of blocks) {
      const ids = Array.from(this.byExpiration.get(b)!).sort(pgCompare);
      for (const id of ids) out.push(this.active.get(id)!);
    }
    return out;
  }

  countExpired(block: number): number {
    let n = 0;
    for (const [b, s] of this.byExpiration) if (b <= block) n += s.size;
    return n;
  }

  hasPair(lender: string, borrower: string, token: string): boolean {
    return (this.byPair.get(this.pairKey(lender, borrower, token))?.size ?? 0) > 0;
  }

  /** SUM(qty) of active rentals lender→borrower for token, exact. */
  activeQty(lender: string, borrower: string, token: string): bigint {
    let total = 0n;
    for (const id of this.byPair.get(this.pairKey(lender, borrower, token)) ?? []) {
      total += this.active.get(id)!.qty;
    }
    return total;
  }

  get activeCount(): number {
    return this.active.size;
  }

  activeRows(): IterableIterator<RentalRow> {
    return this.active.values();
  }

  idHashes(): IterableIterator<[number, number]> {
    return this.allIds.hashes();
  }

  addIdHash(a: number, b: number): void {
    this.allIds.addHash(a, b);
  }
}

// ---------------------------------------------------------------------------
// active delegations
// ---------------------------------------------------------------------------
export interface DelegationRow {
  token: string;
  delegator: string;
  delegatee: string;
  amount: bigint; // scaled 3
  last_delegation_tx: string;
  last_delegation_date: Date;
  last_undelegation_date: Date | null;
  last_undelegation_tx: string | null;
}

export class Delegations {
  private map = new Map<string, DelegationRow>();
  private byDelegator = new Map<string, Set<string>>();

  private key(delegator: string, delegatee: string, token: string): string {
    return delegator + SEP + delegatee + SEP + token;
  }

  get(delegator: string, delegatee: string, token: string): DelegationRow | undefined {
    return this.map.get(this.key(delegator, delegatee, token));
  }

  set(row: DelegationRow): void {
    this.map.set(this.key(row.delegator, row.delegatee, row.token), row);
    let s = this.byDelegator.get(row.delegator);
    if (!s) {
      s = new Set();
      this.byDelegator.set(row.delegator, s);
    }
    s.add(row.delegatee + SEP + row.token);
  }

  delete(delegator: string, delegatee: string, token: string): void {
    this.map.delete(this.key(delegator, delegatee, token));
    this.byDelegator.get(delegator)?.delete(delegatee + SEP + token);
  }

  /** Rows for delegator→(delegatees) for token, ordered by delegator, delegatee. */
  getMany(delegator: string, delegatees: string[], token: string): DelegationRow[] {
    const wanted = new Set(delegatees);
    const rows: DelegationRow[] = [];
    for (const d of wanted) {
      const r = this.get(delegator, d, token);
      if (r) rows.push(r);
    }
    rows.sort((a, b) => pgCompare(a.delegatee, b.delegatee));
    return rows;
  }

  get size(): number {
    return this.map.size;
  }

  rows(): IterableIterator<DelegationRow> {
    return this.map.values();
  }
}

// ---------------------------------------------------------------------------
// staking pool reward debt
// ---------------------------------------------------------------------------
export class RewardDebts {
  private map = new Map<string, bigint>();
  private sums = new Map<string, bigint>();

  get(pool: string, player: string): bigint | undefined {
    return this.map.get(pool + SEP + player);
  }

  set(pool: string, player: string, debt: bigint): void {
    const key = pool + SEP + player;
    const prev = this.map.get(key) ?? 0n;
    this.map.set(key, debt);
    this.sums.set(pool, (this.sums.get(pool) ?? 0n) + debt - prev);
  }

  sum(pool: string): bigint {
    return this.sums.get(pool) ?? 0n;
  }

  *rows(): IterableIterator<{ pool_name: string; player: string; reward_debt: bigint }> {
    for (const [k, reward_debt] of this.map) {
      const i = k.indexOf(SEP);
      yield { pool_name: k.slice(0, i), player: k.slice(i + 1), reward_debt };
    }
  }

  /** SUM() over an empty set is NULL in SQL. */
  hasPool(pool: string): boolean {
    return this.sums.has(pool);
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// price history
// ---------------------------------------------------------------------------
export interface PriceRow {
  validator: string;
  token: string;
  block_num: number;
  block_time: Date;
  token_price: bigint; // numeric(12,6) scaled
}

export class PriceHistory {
  private map = new Map<string, PriceRow>();
  get(validator: string, token: string): PriceRow | undefined {
    return this.map.get(validator + SEP + token);
  }
  set(row: PriceRow): void {
    this.map.set(row.validator + SEP + row.token, row);
  }
  all(): PriceRow[] {
    return Array.from(this.map.values());
  }
}

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------
export class Blocks {
  private map = new Map<number, BlockRow>();
  private latest = 0;

  constructor(private readonly retention = 5000) {}

  get(blockNum: number): BlockRow | undefined {
    return this.map.get(blockNum);
  }

  set(row: BlockRow): void {
    this.map.set(row.block_num, row);
    if (row.block_num > this.latest) this.latest = row.block_num;
    const cutoff = this.latest - this.retention;
    if (this.map.size > this.retention + 100) {
      for (const k of this.map.keys()) if (k < cutoff) this.map.delete(k);
    }
  }

  /** Retained rows in insertion order. */
  rows(): IterableIterator<BlockRow> {
    return this.map.values();
  }

  getLatestBlockNum(): number {
    return this.latest;
  }

  getEarliestBlockNum(): number {
    let min = Number.MAX_SAFE_INTEGER;
    for (const k of this.map.keys()) if (k < min) min = k;
    return min === Number.MAX_SAFE_INTEGER ? 0 : min;
  }

  /** blocks in (after, upTo] with validator set and no validation_tx, ascending */
  missed(after: number, upTo: number): BlockRow[] {
    const out: BlockRow[] = [];
    for (let b = after + 1; b <= upTo; b++) {
      const row = this.map.get(b);
      if (row && row.validator !== null && row.validation_tx === null) out.push(row);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// token transfer keys
// ---------------------------------------------------------------------------
export class TransferKeys {
  private set = new Set<string>();
  has(account: string, key: string): boolean {
    return this.set.has(account + SEP + key);
  }
  add(account: string, key: string): void {
    this.set.add(account + SEP + key);
  }
  *rows(): IterableIterator<{ account: string; key: string }> {
    for (const k of this.set) {
      const i = k.indexOf(SEP);
      yield { account: k.slice(0, i), key: k.slice(i + 1) };
    }
  }
}

// ---------------------------------------------------------------------------
export class StateStore {
  balances = new Balances();
  hiveAccounts = new HiveAccounts();
  validators = new Validators();
  votes = new Votes();
  checkIns = new CheckIns();
  unstaking = new Unstaking();
  config = new ConfigRows();
  promises = new Promises();
  rentals = new Rentals();
  delegations = new Delegations();
  rewardDebts = new RewardDebts();
  priceHistory = new PriceHistory();
  blocks = new Blocks();
  transferKeys = new TransferKeys();
}
