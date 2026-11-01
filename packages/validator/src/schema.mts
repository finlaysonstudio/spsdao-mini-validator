/**
 * Action schemas, copied from upstream (validator/src/actions/schema.ts and
 * apps/sps-validator/src/sps/actions/schema.ts). We use the same yup version
 * (0.32.11) so casting and validation behave identically.
 */
import yup from "yup";
import { isHiveAccount, isSystemAccount } from "./util/accounts.mjs";

const { object, string, number, boolean, array, mixed, date } = yup;
type AnyObjectSchema = yup.AnyObjectSchema;

function isEmptyOrValidSystemAccount(value: string | undefined): boolean {
  if (!value) return true;
  return isSystemAccount(value);
}

function isEmptyOrValidAccountOrValidSystemAccount(value: string | undefined): boolean {
  if (!value) return true;
  if (isEmptyOrValidSystemAccount(value)) return true;
  return isHiveAccount(value);
}

function isEmptyOrValidAccount(value: string | undefined): boolean {
  if (!value) return true;
  return isHiveAccount(value);
}

export const hiveUsernameOrSystemAccount = string()
  .test("account_validation", "The following input is not a system or hive account.", (v) =>
    isEmptyOrValidAccountOrValidSystemAccount(v),
  )
  .strict();
export const token = string().strict().required();
const maxQty = 99_999_999_999.999;
export const qty = number().required().max(maxQty);
export const systemAccount = string()
  .test("system_account_validation", "The following input is not a system account.", isEmptyOrValidSystemAccount)
  .strict();
export const hiveAccount = string()
  .test("hive_account_validation", "The following input is not a valid hive account.", isEmptyOrValidAccount)
  .strict();

export class Schema<T extends AnyObjectSchema> {
  public readonly actionSchema: T;
  private readonly wrappedSchema;

  constructor(public readonly action_name: string, actionSchema: T) {
    this.actionSchema = actionSchema.unknown(true) as T;
    this.wrappedSchema = object({
      action: string().required(),
      params: this.actionSchema,
    });
  }

  /** Returns the cast params or throws. */
  validateWrapped(value: unknown): { action: string; params: any } {
    return this.wrappedSchema.validateSync(value) as { action: string; params: any };
  }
}

export const test = new Schema(
  "test",
  object({
    type: string().required(),
    quantity: number().integer().min(0).max(100),
    extra: number().min(0),
    data: object({
      a: string().required(),
      b: number().integer().min(0).max(100).required(),
    }).default(undefined),
    values: array().of(number().integer().min(0).max(0)),
    items: array().of(
      object({
        a: string().required(),
        b: number().integer().min(0).max(0).required(),
      }),
    ),
    okay: boolean(),
  }),
);

export const token_award = new Schema(
  "token_award",
  object({
    to: hiveUsernameOrSystemAccount.required(),
    from: hiveUsernameOrSystemAccount.required(),
    token: token,
    qty: qty.positive(),
  }),
);

const tokenTransferKey = mixed().optional();
export const token_transfer = new Schema(
  "token_transfer",
  object({
    to: hiveUsernameOrSystemAccount.required(),
    token: token,
    qty: qty.positive(),
    key: tokenTransferKey,
  }),
);

export const burn = new Schema(
  "burn",
  object({
    account: hiveUsernameOrSystemAccount.required(),
    to: systemAccount.required(),
    token: token,
    qty: qty.positive(),
  }),
);

export const token_transfer_multi = new Schema(
  "token_transfer_multi",
  object({
    type: string().strict().optional(),
    multi: array(
      object({
        token: token,
        to: array(
          object({
            name: hiveUsernameOrSystemAccount.required(),
            qty: qty.positive(),
            memo: string().strict().optional(),
            type: string().strict().optional(),
            key: tokenTransferKey,
          }),
        ).required(),
      }),
    ).required(),
  }),
);

export const delegate_tokens = new Schema(
  "delegate_tokens",
  object({
    token: token,
    to: hiveUsernameOrSystemAccount.required(),
    qty: qty.positive(),
    player: hiveAccount.optional(),
  }),
);

export const undelegate_tokens = new Schema(
  "undelegate_tokens",
  object({
    token: token,
    from: hiveUsernameOrSystemAccount.required(),
    qty: qty.positive(),
    player: hiveAccount.optional(),
  }),
);

export const return_tokens = new Schema(
  "return_tokens",
  object({
    token: token,
    from: hiveUsernameOrSystemAccount.required(),
    qty: qty.positive(),
    player: hiveAccount.optional(),
  }),
);

export const undelegate_tokens_multi = new Schema(
  "undelegate_tokens_multi",
  object({
    token: token,
    data: array(object({ from: hiveUsernameOrSystemAccount.required(), qty: qty.positive() }))
      .required()
      .min(1),
    player: hiveAccount.optional(),
  }),
);

export const stake_tokens = new Schema(
  "stake_tokens",
  object({
    token: token,
    to_player: hiveUsernameOrSystemAccount,
    from_player: systemAccount.optional(),
    qty: qty.positive(),
  }),
);

export const stake_tokens_multi = new Schema(
  "stake_tokens_multi",
  object({
    token: token,
    to_player: hiveUsernameOrSystemAccount,
    multi: array(
      object({
        from: systemAccount.required(),
        qty: qty.positive(),
      }),
    )
      .min(1)
      .required(),
  }),
);

export const unstake_tokens = new Schema(
  "unstake_tokens",
  object({
    token: token,
    qty: qty.positive(),
  }),
);

export const cancel_unstake_tokens = new Schema(
  "cancel_unstake_tokens",
  object({
    token: token,
  }),
);

export const claim_staking_rewards = new Schema("claim_staking_rewards", object({}));

export const update_validator = new Schema(
  "update_validator",
  object({
    is_active: boolean().strict().required(),
    post_url: string().strict().optional().nullable(),
    api_url: string().strict().optional().nullable(),
    reward_account: hiveAccount.optional().nullable(),
  }),
);

const updateFn = mixed()
  .required()
  .test("function", "The following input is not a function", (f) => typeof f === "function");

export const token_unstaking = new Schema(
  "token_unstaking",
  object({
    player: hiveUsernameOrSystemAccount.required(),
    unstake_amount: qty.positive(),
    token: token,
    update: updateFn,
  }),
);

export const approve_validator = new Schema(
  "approve_validator",
  object({
    account_name: hiveUsernameOrSystemAccount.required(),
  }),
);

export const unapprove_validator = new Schema(
  "unapprove_validator",
  object({
    account_name: hiveUsernameOrSystemAccount.required(),
  }),
);

export const validate_block = new Schema(
  "validate_block",
  object({
    block_num: number().integer().required(),
    hash: string().strict().required(),
    version: string().strict().required(),
  }),
);

export const config_update = new Schema(
  "config_update",
  object({
    updates: array()
      .of(
        object({
          group_name: string().strict().required(),
          name: string().strict().required(),
          value: mixed().required(),
        }).unknown(true),
      )
      .required(),
  }),
);

export const price_feed = new Schema(
  "price_feed",
  object({
    updates: array()
      .of(
        object({
          token: token,
          price: qty.positive().required(),
        }),
      )
      .required(),
    metadata: object().unknown(true).optional(),
  }),
);

export const legacy_price_feed = new Schema(
  "price_feed",
  object({
    sps_price: number().positive().required(),
  }),
);

export const shop_purchase = new Schema(
  "shop_purchase",
  object({
    id: string().strict().required(),
    qty: qty.positive().required(),
    discount_token: object({
      token: token,
      qty: qty.integer().positive().required(),
    })
      .optional()
      .default(undefined),
    bonus_token: object({
      token: token,
      qty: qty.integer().positive().required(),
    })
      .optional()
      .default(undefined),
    hash: string().strict().optional(),
  }),
);

export const update_pool = new Schema(
  "update_pool",
  object({
    name: string().strict().required(),
    token: string().strict().optional(),
    beneficiary: string().strict().optional(),
    tokensPerNormalizedDay: qty.min(0).optional(),
    start: date().optional(),
    lastPayout: date().optional(),
  }),
);

export const disable_pool = new Schema(
  "disable_pool",
  object({
    name: string().strict().required(),
  }),
);

export const add_pool = new Schema(
  "add_pool",
  object({
    name: string().strict().required(),
    token: string().strict().required(),
    beneficiary: string().strict().required(),
    tokensPerNormalizedDay: qty.min(0).required(),
    start: date().required(),
    lastPayout: date().optional(),
  }),
);

export const claim_pool = new Schema(
  "claim_pool",
  object({
    now: date().required(),
  }),
);

export const set_authority = new Schema(
  "set_authority",
  object({
    delegation: array(hiveAccount.required()).required(),
  }).unknown(true),
);

export const create_promise_legacy = new Schema(
  "create_promise",
  object({
    controllers: array(string().strict().required()).min(1).required(),
    type: string().strict().required(),
    id: string().strict().required(),
    fulfill_timeout_seconds: number().strict().required(),
    params: object().unknown(true).optional(),
  }),
);

export const create_promise = new Schema(
  "create_promise",
  object({
    controllers: array(string().strict().required()).min(1).required(),
    type: string().strict().required(),
    id: string().strict().nullable().optional(),
    fulfill_timeout_seconds: number().strict().optional(),
    params: object().unknown(true).optional(),
  }),
);

export const cancel_promise = new Schema(
  "cancel_promise",
  object({
    type: string().strict().required(),
    id: string().strict().required(),
  }),
);

export const reverse_promise = new Schema(
  "reverse_promise",
  object({
    type: string().strict().required(),
    id: string().strict().required(),
  }),
);

export const complete_promise = new Schema(
  "complete_promise",
  object({
    type: string().strict().required(),
    id: string().strict().required(),
  }),
);

export const fulfill_promise = new Schema(
  "fulfill_promise",
  object({
    type: string().strict().required(),
    id: string().strict().required(),
    metadata: object().unknown(true).optional(),
  }),
);

export const fulfill_promise_multi = new Schema(
  "fulfill_promise_multi",
  object({
    type: string().strict().required(),
    ids: array(string().strict().required()).min(1).required(),
    metadata: object().unknown(true).optional(),
  }),
);

export const expire_promises = new Schema(
  "expire_promises",
  object({
    now: date().required(),
  }),
);

export const expire_rental_delegations = new Schema(
  "expire_rental_delegations",
  object({
    block_num: number().integer().positive().required(),
  }),
);

export const activate_license = new Schema(
  "activate_license",
  object({
    qty: number().integer().positive().min(1).strict().required(),
  }),
);

export const deactivate_license = new Schema(
  "deactivate_license",
  object({
    qty: number().integer().positive().min(1).strict().required(),
  }),
);

export const check_in_validator = new Schema(
  "check_in_validator",
  object({
    block_num: number().integer().positive().required(),
    hash: string().strict().required(),
    version: string().strict().required(),
  }),
);

export const expire_check_ins = new Schema("expire_check_ins", object({}));

export const update_missed_blocks = new Schema(
  "update_missed_blocks",
  object({
    account: hiveAccount.required(),
    checked_block: number().integer().positive().required(),
    missed_blocks: number().integer().positive().required(),
  }),
);

const transitionSchema = (name: string) =>
  new Schema(
    name,
    object({
      block_num: number().integer().positive().required(),
    }),
  );

export const transition_fix_vote_weight = transitionSchema("transition_fix_vote_weight");
export const transition_cleanup_lite_accounts = transitionSchema("transition_cleanup_lite_accounts");
export const transition_balance_token_staking_spsp = transitionSchema("transition_balance_token_staking_spsp");
export const transition_adjust_token_distribution_strategy = transitionSchema(
  "transition_adjust_token_distribution_strategy",
);
export const transition_cancel_delegation_promises = transitionSchema("transition_cancel_delegation_promises");

/** Schemas used by delegation offer promises (features/delegation). */
export const delegation_offer_params_schema = object({
  token: token,
  qty: qty.positive(),
  lender: hiveAccount.required(),
  price: qty.positive(),
  qty_remaining: number().min(0).optional(),
  source_promise_id: string().strict().optional(),
});

export const delegation_offer_fulfill_metadata_schema = object({
  borrower: hiveAccount.required(),
  rental_id: string().strict().required(),
  qty: qty.positive(),
  expiration_blocks: number().positive().integer().required(),
});

/** Legacy delegation promise params (features/delegation/delegation_promises.ts). */
export const delegation_promise_params_schema = object({
  token: token,
  qty: qty.positive(),
  to: hiveAccount.required(),
  player: hiveAccount.optional(),
});
