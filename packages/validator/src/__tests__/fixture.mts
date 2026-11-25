/**
 * Test fixture mirroring upstream apps/sps-validator/src/__tests__ (Fixture,
 * TestHelper, OpsHelper), so ported tests read line for line against the
 * originals. Upstream restores an empty, schema-only database before each
 * test; here that is a fresh, empty StateStore.
 */
import seedrandom from "seedrandom";
import { ActionRouter } from "../actions/index.mjs";
import type { ExecutableAction } from "../actions/base.mjs";
import { ActionOrBust, Operation } from "../block/operation.mjs";
import type { IAction } from "../repos/context.mjs";
import { TOKENS } from "../repos/context.mjs";
import { TRANSITION_POINTS } from "../repos/transitions.mjs";
import { Services } from "../services.mjs";
import { StateStore } from "../state/index.mjs";
import type { OperationData, Payout } from "../types.mjs";
import { numberToScaled, scaledToNumber } from "../util/num.mjs";

const PREFIX = { custom_json_id: "sm_sps", custom_json_prefix: "sm_" };

/** SpsConfigLoader.DEFAULT */
export const DEFAULT_CONFIG = {
  validator: {
    reward_start_block: 60963785,
    paused_until_block: 0,
    last_checked_block: 60963784,
    tokens_per_block: 4.34,
    min_validators: 3,
    reduction_blocks: 864000,
    max_block_age: 100,
    reduction_pct: 1,
    max_votes: 10,
    num_top_validators: 10,
    reward_token: TOKENS.SPS,
    consecutive_missed_blocks_threshold: 5,
  },
  sps: {
    unstaking_interval_seconds: 1,
    unstaking_periods: 1,
    staking_rewards_acc_tokens_per_share: 1,
    staking_rewards_last_reward_block: 0,
    staking_rewards: { start_block: 1, tokens_per_block: 1 },
    validator_rewards_acc_tokens_per_share: 1,
    validator_rewards_last_reward_block: 0,
    validator_rewards: { start_block: 1, tokens_per_block: 1 },
  },
  validator_check_in: { check_in_window_blocks: 300, check_in_interval_blocks: 28800, paused_until_block: 0 },
  price_feed: { interval_blocks: 200 },
  delegation_rental: { qty_divisor: 1, min_qty: 0, min_price: 0.001 },
} as const;

/** upstream db-helpers payloads */
export const emoji_payload =
  "🍮🌖🐶💰🔪🐃 📼💉🍉👺 🕦💨🍶🔁🍯🐠 🌐📢🍼📎👻📵 🍁🌚💉📛🍶📀🔠🔥 🎹💀🐸🍂🐾🔼 🕟🔀🔐🔢 🏄🎢👈🍹👚🎥 🗽👢🐽🌘💃🌁💎 " +
  "🍱💹🔘🍥. 🔺🎷💫👍🔴🔌 👋🎂👅💆🐟🏡 🕖🎓🌂🏠🍵 🌹🔳💅📟🕥👩 🎑🌙👸💠🍖🔺🌅 📧🔍🕓🌸👌 👅💅🍴📮📋🏈 💪🏭💾🌠🏈 🎵🔌🐯💋";
export const garbage_payload = { value: "bagels_are_not_booleans" };

/** Upstream TestHelper, over the in-memory store. */
export class TestHelper {
  constructor(private readonly fx: Fixture) {}

  private get state() {
    return this.fx.state;
  }

  insertDefaultConfiguration(): void {
    for (const [group_name, group] of Object.entries(DEFAULT_CONFIG)) {
      for (const [name, value] of Object.entries(group)) {
        // value_type 'object' for everything: upstream's "HACK, yet works for everything we have"
        this.state.config.set({ group_name, group_type: "object", name, index: 0, value_type: "object", value: JSON.stringify(value), last_updated_date: null, last_updated_tx: null });
      }
    }
  }

  /** Upstream insertExistingAdmins: upsert `$root.admin_accounts`. */
  insertExistingAdmins(admins: string[]): void {
    this.state.config.set({ group_name: "$root", group_type: "object", name: "admin_accounts", index: 0, value_type: "array", value: JSON.stringify(admins), last_updated_date: null, last_updated_tx: null });
  }

  /** A config row as upstream tests insert it with `insertItem` (no last_updated fields). */
  insertConfig(group_name: string, name: string, value_type: string, value: string): void {
    this.state.config.set({ group_name, group_type: "object", name, index: 0, value_type, value, last_updated_date: null, last_updated_tx: null });
  }

  /** A processed block row (upstream tests insert into `blocks` / update LastBlockCache). */
  insertBlock(block_num: number, block_time: Date): void {
    this.state.blocks.set({ block_num, block_id: "", prev_block_id: "", l2_block_id: "", block_time, validator: null, validation_tx: null });
  }

  insertDummyValidator(account_name: string, is_active = true, total_votes = 0, reward_account: string | null = null, consecutive_missed_blocks = 0): void {
    this.state.validators.set({
      account_name,
      reward_account,
      is_active,
      post_url: null,
      total_votes: numberToScaled(total_votes, 3),
      missed_blocks: consecutive_missed_blocks,
      api_url: null,
      last_version: null,
      consecutive_missed_blocks,
    });
  }

  insertDummyVote(voter: string, validator: string, vote_weight = 1): void {
    this.state.votes.set(voter, validator, numberToScaled(vote_weight, 3));
  }

  votesForValidator(validator: string): { voter: string; validator: string; vote_weight: number }[] {
    return this.state.votes.votersOf(validator).map((voter) => {
      const v = this.state.votes.getByVoter(voter).find((x) => x.validator === validator)!;
      return { voter, validator, vote_weight: scaledToNumber(v.vote_weight, 3) };
    });
  }

  validator(account_name: string) {
    const r = this.state.validators.get(account_name);
    return r ? { ...r, total_votes: scaledToNumber(r.total_votes, 3) } : null;
  }

  getDummyToken(account_name: string, token: string = TOKENS.SPS): { player: string; token: string; balance: number } | null {
    if (!this.state.balances.has(account_name, token)) return null;
    return { player: account_name, token, balance: this.state.balances.get(account_name, token) };
  }

  setDummyToken(account_name: string, amount: number, token: string = TOKENS.SPS): void {
    // upstream insertItem: a duplicate (player, token) would violate the primary key
    if (this.state.balances.has(account_name, token)) throw new Error(`duplicate balance ${account_name}/${token}`);
    this.state.balances.set(account_name, token, numberToScaled(amount, 3));
  }

  setStaked(account: string, amount: number): void {
    this.setDummyToken(account, amount, TOKENS.SPSP);
  }

  setLiquidSPSBalance(account: string, amount: number): void {
    this.setDummyToken(account, amount, TOKENS.SPS);
  }

  setHiveAccount(name: string, authority?: Record<string, string[]>): void {
    this.state.hiveAccounts.add(name);
    if (authority) this.state.hiveAccounts.setAuthority(name, authority);
  }
}

type OpOpts = { transaction: string; block_num: number; is_active: boolean; block_time: Date; is_virtual: boolean; block_reward: Payout };

/** Upstream OpsHelper: runs one custom_json through the real Operation/ActionRouter pipeline. */
export class OpsHelper {
  constructor(private readonly fx: Fixture) {}

  processVirtualOp(
    method: string,
    username: string,
    payload: unknown,
    { transaction = "some-trx", block_num = 1, is_active = true, block_time = new Date(), is_virtual = true, block_reward = 0 }: Partial<OpOpts> = {},
  ): ExecutableAction[] {
    const auth = is_active ? { required_auths: [username], required_posting_auths: [] } : { required_auths: [], required_posting_auths: [username] };
    const id = method === PREFIX.custom_json_id ? method : `${PREFIX.custom_json_prefix}${method}`;
    const block_id = "1";
    const previous = "0";
    const op = new Operation(
      new ActionOrBust(new ActionRouter(this.fx.svc)),
      PREFIX,
      { block_num, block_id, previous, block_time, prng: seedrandom(`${block_id}${previous}`) },
      block_reward,
      ["custom_json", { ...auth, id, json: payload } as never],
      transaction,
      0,
      is_virtual,
    );
    op.process();
    return op.actions;
  }

  processOp(method: string, username: string, payload: unknown, opts?: Partial<OpOpts>): ExecutableAction[] {
    const stringified = typeof payload === "string" ? payload : JSON.stringify(payload);
    return this.processVirtualOp(method, username, stringified, { ...opts, is_virtual: false });
  }
}

export class Fixture {
  state = new StateStore();
  svc = new Services(this.state, PREFIX);
  readonly testHelper = new TestHelper(this);
  readonly opsHelper = new OpsHelper(this);

  /** Upstream restore(): an empty database. */
  restore(): void {
    this.state = new StateStore();
    this.svc = new Services(this.state, PREFIX);
  }

  /** Upstream loader.load(): re-read the config table. */
  load(): void {
    this.svc.config.reload();
  }

  get loader() {
    return this.svc.config;
  }

  readonly transitionPoints = { transition_points: TRANSITION_POINTS };
}

/** Minimal IAction for calling repositories directly. */
export function fakeAction(block_num: number, account = "$TRANSITIONS", params: unknown = {}): IAction {
  const op = { block_num, account, block_time: new Date("2025-01-01T00:00:00Z"), trx_op_id: `trx_${block_num}`, transaction_id: `trx_${block_num}` } as unknown as OperationData;
  return { id: `trx_${block_num}`, op, unique_trx_id: `trx_${block_num}`, params, players: [account] };
}
