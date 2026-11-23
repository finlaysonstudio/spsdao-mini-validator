import type { StateStore, ConfigRow } from "../state/index.mjs";
import { EventLog } from "../types.mjs";
import { pgCompare } from "../util/collate.mjs";
import { log, warn } from "../util/log.mjs";
import { CONFIG_ASSERTERS, assertConfig, assertionErrorText, fieldStillValid } from "./config_schema.mjs";

export type ConfigData = number | Date | object | Array<unknown> | string | boolean;

export type ValidatorConfig = {
  reward_version?: "per_block" | "per_block_capped";
  reward_start_block: number;
  tokens_per_block: number;
  paused_until_block: number;
  reward_token: string;
  min_validators: number;
  reduction_blocks: number;
  max_block_age: number;
  reduction_pct: number;
  max_votes: number;
  num_top_validators: number;
  last_checked_block: number;
  consecutive_missed_blocks_threshold?: number;
};

export type PoolSettings = {
  type?: "per_block" | "per_block_capped";
  tokens_per_block: number;
  reduction_pct?: number;
  reduction_blocks?: number;
  start_block: number;
  stop_date_utc?: Date | string;
  stop_block?: number;
};

export type UnstakingSettings = { unstaking_interval_seconds: number; unstaking_periods: number };

export type CheckInConfig = {
  check_in_window_blocks: number;
  check_in_interval_blocks: number;
  paused_until_block: number;
};

export type DelegationRentalConfig = { qty_divisor: number; min_qty: number; min_price?: number };

function parseValue(value: string, type: string): ConfigData {
  try {
    switch (type) {
      case "number":
        return parseFloat(value);
      case "date":
        return new Date(value);
      case "object":
      case "array":
        return JSON.parse(value);
      case "string":
        return value;
      case "boolean":
        return !!JSON.parse(value);
      default:
        throw Error("Stored config in db cannot be parsed");
    }
  } catch {
    return value;
  }
}

/** ConfigRepository.value_type */
export function configValueType(value: ConfigData): string {
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      if (Array.isArray(value)) return "array";
      if (value instanceof Date) return "date";
      return "object";
    default:
      throw new Error(`unsupported config value type ${typeof value}`);
  }
}

export function unparseValue(value: ConfigData): string {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      return value.toString();
    case "object":
      if (Array.isArray(value)) return JSON.stringify(value);
      if (value instanceof Date) return value.toISOString();
      return JSON.stringify(value);
    case "boolean":
      return JSON.stringify(value);
    default:
      throw Error("Config for db cannot be unparsed");
  }
}

type ConfigRecord = Pick<ConfigRow, "group_name" | "group_type" | "name" | "index" | "value_type" | "value">;

/** ConfigRepository.load: ORDER BY group_name, index (text order under the database collation). */
function sortRecords<T extends ConfigRecord>(rows: T[]): T[] {
  return rows.sort((a, b) => pgCompare(a.group_name, b.group_name) || a.index - b.index);
}

/** ConfigRepository.applyConfigRecords */
function applyConfigRecords(rows: ConfigRecord[]): Record<string, any> {
  const config: Record<string, any> = {};
  for (const r of rows) {
    const parsed = parseValue(r.value!, r.value_type);
    if (!r.group_name || r.group_name === "$root") {
      config[r.name] = parsed;
      continue;
    }
    const isArray = r.group_type === "array";
    if (!config[r.group_name]) config[r.group_name] = isArray ? [] : {};
    if (isArray) config[r.group_name].push(parsed);
    else config[r.group_name][r.name] = parsed;
  }
  return config;
}

export type ConfigChangeHandler = () => void;

/**
 * Mirrors SpsConfigLoader: a parsed view of the config table, the asserter watchers that derive
 * the validated domain objects (`validator`, `pools`, `unstaking`, `shop`, ...) from their group,
 * change handlers for other derived state (pool manager, shop), and the event producers.
 *
 * Upstream keeps the config in an atom: every update replaces the changed top-level key with a new
 * object and the watchers of that key run (validation first, then the other handlers). A reload
 * replaces every group. Updates here are copy-on-write for the same reason.
 */
export class ConfigLoader {
  private parsed: Record<string, any> = {};
  /** Domain objects whose assertion failed (upstream sets them to undefined). */
  private readonly invalid = new Set<string>();
  private readonly handlers = new Map<string, ConfigChangeHandler[]>();

  constructor(private readonly state: StateStore) {
    this.reload();
  }

  /** Register a watcher on a top-level config key (`addTokenWatcher`, `addShopWatcher`, ...). */
  onChange(key: string, handler: ConfigChangeHandler): void {
    const list = this.handlers.get(key) ?? [];
    list.push(handler);
    this.handlers.set(key, list);
  }

  reload(): void {
    const previous = this.parsed;
    this.parsed = applyConfigRecords(sortRecords(this.state.config.all()));
    const keys = new Set([...Object.keys(previous), ...Object.keys(this.parsed)]);
    for (const key of keys) {
      if (previous[key] === this.parsed[key]) continue;
      this.changed(key);
    }
  }

  /** The asserter watcher for `key` (full validation, or one changed field), then the other handlers. */
  private changed(key: string, field?: { name: string; value: unknown }): void {
    const asserter = CONFIG_ASSERTERS.find((a) => a.key === key);
    if (asserter) {
      const next = this.parsed[key];
      for (const assertion of asserter.assertions) {
        if (field && !this.invalid.has(assertion.name) && fieldStillValid(assertion, field.name, field.value)) continue;
        try {
          assertConfig(assertion, next);
          this.invalid.delete(assertion.name);
        } catch (err) {
          if (next !== undefined) warn(`Config validation failed for ${key}.${assertion.name}: ${err}`);
          this.invalid.add(assertion.name);
        }
      }
    }
    for (const handler of this.handlers.get(key) ?? []) handler();
  }

  private domain<T>(name: string, group: string): T | undefined {
    return this.invalid.has(name) ? undefined : (this.parsed[group] as T | undefined);
  }

  get value(): Record<string, any> {
    return this.parsed;
  }

  get validator(): ValidatorConfig | undefined {
    return this.domain("validator", "validator");
  }

  /** `pools` watcher: the `sps` group (pool settings + accumulators). */
  get pools(): Record<string, any> | undefined {
    return this.domain("pools", "sps");
  }

  /** `token` watcher: the `sps` group (`inflation_pools`, `token_records`). */
  get token(): { inflation_pools?: unknown[]; token_records?: unknown[] } | undefined {
    return this.domain("token", "sps");
  }

  unstaking(token: string): UnstakingSettings | undefined {
    // SpsConfigLoader validates the `sps` group as unstaking configuration for all tokens.
    const sps = this.domain<Record<string, any>>("unstaking", "sps");
    if (!sps) return undefined;
    void token;
    return { unstaking_interval_seconds: sps.unstaking_interval_seconds, unstaking_periods: sps.unstaking_periods };
  }

  get validator_check_in(): CheckInConfig | undefined {
    return this.domain("validator_check_in", "validator_check_in");
  }

  get delegation_rental(): DelegationRentalConfig | undefined {
    return this.domain("delegation_rental", "delegation_rental");
  }

  get price_feed(): { interval_blocks: number } | undefined {
    return this.domain("price_feed", "price_feed");
  }

  get shop(): Record<string, unknown> | undefined {
    return this.domain("shop", "shop");
  }

  isAdmin(account: string): boolean {
    const adminAccounts = this.parsed.admin_accounts;
    return account === "steemmonsters" || (adminAccounts && (adminAccounts as string[]).includes(account));
  }

  private rowEvent(row: ConfigRow): EventLog {
    return new EventLog("update", "config", {
      group_name: row.group_name,
      group_type: row.group_type,
      name: row.name,
      index: row.index,
      value_type: row.value_type,
      value: row.value,
      last_updated_date: row.last_updated_date,
      last_updated_tx: row.last_updated_tx,
    });
  }

  private writeRow(group_name: string, name: string, value: string): ConfigRow {
    const row = this.state.config.get(group_name, name);
    // ConfigRepository.updateReturning: UPDATE ... RETURNING * matches no row, and typed-knex then
    // throws a TypeError mapping the missing row. The action fails outside validation and the
    // upstream node stops on this block.
    if (!row) throw new Error(`config row ${group_name}.${name} does not exist; upstream updateReturning throws here and the node stops`);
    row.value = value;
    return row;
  }

  /** updateConfig: writes the row and patches the cache without a full reload. */
  updateConfig(group_name: string, name: string, value: ConfigData): EventLog {
    const row = this.writeRow(group_name, name, unparseValue(value));
    // SpsConfigLoader.updateImpl
    if (group_name === "$root") {
      this.parsed = { ...this.parsed, [name]: value };
      this.changed(name);
    } else {
      this.parsed = { ...this.parsed, [group_name]: { ...this.parsed[group_name], [name]: value } };
      this.changed(group_name, { name, value });
    }
    return this.rowEvent(row);
  }

  /**
   * SpsConfigLoader.validateUpdateConfig: the row must exist, the value must unparse, and the
   * group (re-read with the new value, parsed by the row's value_type) must satisfy every
   * assertion of its asserter. Returns the error texts (empty when valid).
   */
  validateUpdateConfig(group_name: string, name: string, value: unknown): string[] {
    if (!this.exists(group_name, name)) return [`Config entry ${group_name}.${name} does not exist.`];
    let unparsed: string;
    try {
      unparsed = unparseValue(value as ConfigData);
    } catch (err) {
      return [`Config entry ${group_name}.${name} could not be unparsed: ${err instanceof Error ? err.message : String(err)}`];
    }
    // ConfigRepository.testUpdate
    const records = sortRecords(this.state.config.all().map((r) => ({ ...r })));
    const match = records.find((r) => r.group_name === group_name && r.name === name);
    if (match) match.value = unparsed;
    const newConfig = applyConfigRecords(records);
    const errors: string[] = [];
    for (const asserter of CONFIG_ASSERTERS) {
      if (asserter.key !== group_name) continue;
      for (const assertion of asserter.assertions) {
        try {
          assertConfig(assertion, newConfig[group_name]);
        } catch (err) {
          errors.push(`Validation failed for ${asserter.key}.${assertion.name}: ${assertionErrorText(err)}`);
        }
      }
    }
    return errors;
  }

  /** reloadingUpdateConfig: writes the row and reloads everything. */
  reloadingUpdateConfig(group_name: string, name: string, value: ConfigData): EventLog {
    const row = this.writeRow(group_name, name, unparseValue(value));
    log(`Updated config value [${group_name}.${name}] to ${value}, reloading database.`);
    this.reload();
    return this.rowEvent(row);
  }

  /**
   * SpsConfigLoader.reloadingUpsertConfig: INSERT (index 0) ... ON CONFLICT (group_name, name)
   * DO UPDATE SET value, value_type; RETURNING *; then a full reload.
   */
  reloadingUpsertConfig(group_name: string, group_type: string, name: string, value: ConfigData): EventLog {
    const unparsed = unparseValue(value);
    const value_type = configValueType(value);
    let row = this.state.config.get(group_name, name);
    if (row) {
      row.value = unparsed;
      row.value_type = value_type;
    } else {
      row = { group_name, group_type, name, index: 0, value_type, value: unparsed, last_updated_date: null, last_updated_tx: null };
      this.state.config.set(row);
    }
    log(`Inserted config value [${group_name}.${name}] to ${value}, reloading database.`);
    this.reload();
    const ev = this.rowEvent(row);
    return new EventLog("upsert", "config", ev.data);
  }

  exists(group_name: string, name: string): boolean {
    return this.state.config.get(group_name, name) !== undefined;
  }

  // PoolSerializer
  store(pools: unknown[]): EventLog {
    return this.updateConfig("sps", "inflation_pools", pools);
  }

  // PoolUpdater
  updateLastRewardBlock(pool_name: string, block_num: number): EventLog[] {
    return [this.updateConfig("sps", `${pool_name}_last_reward_block`, block_num)];
  }

  updateAccTokensPerShare(pool_name: string, tokens_per_share: number): EventLog[] {
    return [this.updateConfig("sps", `${pool_name}_acc_tokens_per_share`, tokens_per_share)];
  }

  updateStopBlock(pool_name: string, stop_block: number): EventLog[] {
    const p = this.pools;
    if (p === undefined || p === null) throw new Error("assertNonNull called with null or undefined");
    const existing = p[pool_name];
    const updated = { ...existing, stop_block };
    return [this.updateConfig("sps", pool_name, updated)];
  }

  // ValidatorUpdater
  updateLastCheckedBlock(block_num: number): EventLog[] {
    return [this.updateConfig("validator", "last_checked_block", block_num)];
  }
}
