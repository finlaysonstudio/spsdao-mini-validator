import type { StateStore, ConfigRow } from "../state/index.mjs";
import { EventLog } from "../types.mjs";
import { log } from "../util/log.mjs";

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

/**
 * Mirrors SpsConfigLoader: a parsed view of the config table plus the
 * `updateConfig` event producer.
 */
export class ConfigLoader {
  private parsed: Record<string, any> = {};

  constructor(private readonly state: StateStore) {
    this.reload();
  }

  reload(): void {
    const rows = this.state.config.all().sort((a, b) => {
      if (a.group_name !== b.group_name) return a.group_name < b.group_name ? -1 : 1;
      return a.index - b.index;
    });
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
    this.parsed = config;
  }

  get value(): Record<string, any> {
    return this.parsed;
  }

  get validator(): ValidatorConfig | undefined {
    return this.parsed.validator;
  }

  /** `pools` watcher: the `sps` group (pool settings + accumulators). */
  get pools(): Record<string, any> | undefined {
    return this.parsed.sps;
  }

  unstaking(token: string): UnstakingSettings | undefined {
    // SpsConfigLoader validates the `sps` group as unstaking configuration for all tokens.
    const sps = this.parsed.sps;
    if (!sps) return undefined;
    void token;
    return { unstaking_interval_seconds: sps.unstaking_interval_seconds, unstaking_periods: sps.unstaking_periods };
  }

  get validator_check_in(): CheckInConfig | undefined {
    return this.parsed.validator_check_in;
  }

  get delegation_rental(): DelegationRentalConfig | undefined {
    return this.parsed.delegation_rental;
  }

  get price_feed(): { interval_blocks: number } | undefined {
    return this.parsed.price_feed;
  }

  get shop(): Record<string, unknown> | undefined {
    return this.parsed.shop;
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
    if (!row) throw new Error(`config ${group_name}.${name} does not exist`);
    row.value = value;
    return row;
  }

  /** updateConfig: writes the row and patches the cache without a full reload. */
  updateConfig(group_name: string, name: string, value: ConfigData): EventLog {
    const row = this.writeRow(group_name, name, unparseValue(value));
    if (group_name === "$root") this.parsed[name] = value;
    else {
      if (!this.parsed[group_name]) this.parsed[group_name] = {};
      this.parsed[group_name][name] = value;
    }
    return this.rowEvent(row);
  }

  /** reloadingUpdateConfig: writes the row and reloads everything. */
  reloadingUpdateConfig(group_name: string, name: string, value: ConfigData): EventLog {
    const row = this.writeRow(group_name, name, unparseValue(value));
    log(`Updated config value [${group_name}.${name}] to ${value}, reloading.`);
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

  // PoolUpdater
  updateLastRewardBlock(pool_name: string, block_num: number): EventLog[] {
    return [this.updateConfig("sps", `${pool_name}_last_reward_block`, block_num)];
  }

  updateAccTokensPerShare(pool_name: string, tokens_per_share: number): EventLog[] {
    return [this.updateConfig("sps", `${pool_name}_acc_tokens_per_share`, tokens_per_share)];
  }

  updateStopBlock(pool_name: string, stop_block: number): EventLog[] {
    const existing = this.pools![pool_name];
    const updated = { ...existing, stop_block };
    return [this.updateConfig("sps", pool_name, updated)];
  }

  // ValidatorUpdater
  updateLastCheckedBlock(block_num: number): EventLog[] {
    return [this.updateConfig("validator", "last_checked_block", block_num)];
  }
}
