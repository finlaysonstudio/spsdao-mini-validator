/**
 * The schemas SpsConfigLoader asserts config groups against (validator/src/config/index.ts,
 * validator/src/config/pools.ts, features/{validator,price_feed}/config.ts,
 * features/delegation/delegation_offer_promises.ts, entities/bookkeeping.ts), copied verbatim
 * for yup 0.32.11 so validation results and messages are identical.
 */
import yup from "yup";
import { POOLS } from "./context.mjs";

const { object, number, string, mixed, array, date } = yup;
type AnyObjectSchema = yup.AnyObjectSchema;

export const token_schema = object({
  inflation_pools: array().optional(),
  token_records: array().optional(),
});

export const validator_schema = object({
  reward_version: string().oneOf(["per_block", "per_block_capped"]).optional(),
  reward_start_block: number().integer().positive().required(),
  paused_until_block: number().integer().required(),
  tokens_per_block: number().min(0).required(),
  reward_token: string().strict().required(),
  min_validators: number().min(0).required(),
  reduction_blocks: number().integer().positive().required(),
  max_block_age: number().integer().positive().required(),
  reduction_pct: number().min(0).required(),
  max_votes: number().positive().required(),
  num_top_validators: number().positive().required(),
  last_checked_block: number().integer().positive().required(),
  consecutive_missed_blocks_threshold: number().integer().min(0).optional(),
});

export const shop_entries_schema = object({
  validator_tranch_0: mixed().required(),
  validator_tranch_1: mixed().required(),
  validator_tranch_2: mixed().required(),
  validator_tranch_3: mixed().required(),
  validator_tranch_4: mixed().required(),
  validator_tranch_5: mixed().required(),
  validator_tranch_6: mixed().required(),
  validator_tranch_7: mixed().required(),
});

export const bookkeeping_entries_schema = object({
  accounts: array().of(string().required()).required(),
});

export const validator_check_in_schema = object({
  check_in_window_blocks: number().required(),
  check_in_interval_blocks: number().required(),
  paused_until_block: number().required(),
});

export const price_feed_schema = object({
  interval_blocks: number().required(),
});

export const delegation_rental_schema = object({
  qty_divisor: number().required().min(1),
  min_qty: number().required().min(0),
});

export const unstaking_settings_schema = object({
  unstaking_interval_seconds: number().integer().positive().required(),
  unstaking_periods: number().integer().required().positive(),
});

const per_block_pool_settings_schema = object({
  type: string().oneOf(["per_block", undefined]).optional(),
  tokens_per_block: number().min(0).required(),
  reduction_pct: number().min(0).max(100).optional(),
  reduction_blocks: number().positive().optional(),
  start_block: number().integer().positive().required(),
  stop_date_utc: date().optional(),
  stop_block: number().integer().positive().optional(),
});

const per_block_capped_pool_settings_schema = object({
  type: string().oneOf(["per_block_capped"]).required(),
  tokens_per_block: number().min(0).required(),
  start_block: number().integer().positive().required(),
  stop_date_utc: date().optional(),
  stop_block: number().integer().positive().optional(),
});

const pool_settings_schema = mixed().test(
  "is-pool-settings",
  "Must be a valid PoolSettings object",
  (value) => {
    const schemas = [
      per_block_pool_settings_schema,
      per_block_capped_pool_settings_schema,
    ];
    return schemas.some((schema) => schema.isValidSync(value));
  },
);

/** PoolsHelper.poolValidator, one per award pool (ValidatorPools order). */
function poolSchema(name: string): AnyObjectSchema {
  return object({
    [name]: pool_settings_schema,
    [`${name}_acc_tokens_per_share`]: number(),
    [`${name}_last_reward_block`]: number().integer().min(0),
  });
}

/**
 * One assertion of an asserter watcher: the group value must validate against every schema
 * in order (PoolsHelper.validate runs one validator per pool).
 */
export type ConfigAssertion = {
  readonly name: string;
  readonly schemas: readonly AnyObjectSchema[];
};
export type ConfigAsserter = {
  readonly key: string;
  readonly assertions: readonly ConfigAssertion[];
};

/** SpsConfigLoader constructor: asserter watchers in registration order. */
export const CONFIG_ASSERTERS: readonly ConfigAsserter[] = [
  {
    key: "sps",
    assertions: [
      { name: "token", schemas: [token_schema] },
      { name: "unstaking", schemas: [unstaking_settings_schema] },
      { name: "pools", schemas: POOLS.map((p) => poolSchema(p.name)) },
    ],
  },
  {
    key: "validator",
    assertions: [{ name: "validator", schemas: [validator_schema] }],
  },
  {
    key: "validator_check_in",
    assertions: [
      { name: "validator_check_in", schemas: [validator_check_in_schema] },
    ],
  },
  {
    key: "shop",
    assertions: [{ name: "shop", schemas: [shop_entries_schema] }],
  },
  {
    key: "bookkeeping",
    assertions: [
      { name: "bookkeeping", schemas: [bookkeeping_entries_schema] },
    ],
  },
  {
    key: "price_feed",
    assertions: [{ name: "price_feed", schemas: [price_feed_schema] }],
  },
  {
    key: "delegation_rental",
    assertions: [
      { name: "delegation_rental", schemas: [delegation_rental_schema] },
    ],
  },
];

/** Run one assertion; throws what yup throws. */
export function assertConfig(assertion: ConfigAssertion, value: unknown): void {
  for (const schema of assertion.schemas) schema.validateSync(value);
}

/**
 * Whether replacing one key of a group that satisfied `assertion` keeps it satisfied. None of
 * these object schemas has cross-field rules, so only that key's own field schema can fail.
 */
export function fieldStillValid(
  assertion: ConfigAssertion,
  name: string,
  value: unknown,
): boolean {
  for (const schema of assertion.schemas) {
    const field = (schema.fields as Record<string, yup.AnySchema | undefined>)[
      name
    ];
    if (field && !field.isValidSync(value)) return false;
  }
  return true;
}

/** `Validation failed for ${key}.${name}: ...` as SpsConfigLoader.validateUpdateConfig words it. */
export function assertionErrorText(err: unknown): string {
  if (err instanceof yup.ValidationError) return err.errors.join(", ");
  return `${err}`;
}
