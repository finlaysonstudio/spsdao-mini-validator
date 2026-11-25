import type { StateStore, ValidatorRow } from "../state/index.mjs";
import type { BlockRef } from "../types.mjs";
import { EventLog } from "../types.mjs";
import { pgCompare } from "../util/collate.mjs";
import { addScaled, formatScaled, numberToScaled, scaledToNumber } from "../util/num.mjs";
import type { BalanceRepository } from "./balance.mjs";
import type { ConfigLoader } from "./config.mjs";
import { localeSort, TOKENS, type IAction } from "./context.mjs";
import { TRANSITION_POINTS } from "./transitions.mjs";

/**
 * Upstream ValidatorEntryVersion (SpsValidatorRepository / SpsValidatorVoteRepository):
 * v1 rows omit consecutive_missed_blocks; v2 from adjust_token_distribution_strategy on.
 */
export const isV2 = (block_num: number) => TRANSITION_POINTS.adjust_token_distribution_strategy <= block_num;
function versioned<T extends { consecutive_missed_blocks?: number }>(entry: T, block_num: number): T {
  if (!isV2(block_num)) delete entry.consecutive_missed_blocks;
  return entry;
}

/** Mirrors upstream ValidatorEntry (into: total_votes parsed, v2 keeps consecutive_missed_blocks). */
export type ValidatorEntry = {
  account_name: string;
  reward_account: string | null;
  is_active: boolean;
  post_url: string | null;
  total_votes: number;
  missed_blocks: number;
  api_url: string | null;
  last_version: string | null;
  consecutive_missed_blocks?: number;
};

/** Raw DB row shape (total_votes as numeric text), column order. */
function rawRow(r: ValidatorRow) {
  return {
    account_name: r.account_name,
    reward_account: r.reward_account,
    is_active: r.is_active,
    post_url: r.post_url,
    total_votes: formatScaled(r.total_votes, 3),
    missed_blocks: r.missed_blocks,
    api_url: r.api_url,
    last_version: r.last_version,
    consecutive_missed_blocks: r.consecutive_missed_blocks,
  };
}

function into(r: ValidatorRow, block_num: number): ValidatorEntry {
  return versioned({ ...rawRow(r), total_votes: scaledToNumber(r.total_votes, 3) } as ValidatorEntry, block_num);
}

/** ORDER BY total_votes DESC, account_name */
function orderValidators(rows: ValidatorRow[]): ValidatorRow[] {
  return rows.sort((a, b) => {
    if (a.total_votes !== b.total_votes) return a.total_votes > b.total_votes ? -1 : 1;
    return pgCompare(a.account_name, b.account_name);
  });
}

export class ValidatorRepository {
  constructor(private readonly state: StateStore, private readonly config: ConfigLoader) {}

  register(params: { account: string; is_active: boolean; post_url?: string; reward_account?: string; api_url?: string }, action: IAction): EventLog {
    let row = this.state.validators.get(params.account);
    if (!row) {
      row = {
        account_name: params.account,
        reward_account: params.reward_account ?? null,
        is_active: params.is_active,
        post_url: params.post_url ?? null,
        total_votes: 0n,
        missed_blocks: 0,
        api_url: params.api_url ?? null,
        last_version: null,
        consecutive_missed_blocks: 0,
      };
      this.state.validators.set(row);
    } else {
      row.is_active = params.is_active;
      row.post_url = params.post_url ?? null;
      row.reward_account = params.reward_account ?? null;
      row.api_url = params.api_url ?? null;
    }
    return new EventLog("upsert", "validators", into(row, action.op.block_num));
  }

  private must(account: string): ValidatorRow {
    const row = this.state.validators.get(account);
    if (!row) throw new Error(`validator ${account} not found`);
    return row;
  }

  disable(account: string, action: IAction): EventLog {
    const row = this.must(account);
    row.is_active = false;
    return new EventLog("update", "validators", into(row, action.op.block_num));
  }

  incrementMissedBlocks(account: string, increment: number, action: IAction): EventLog[] {
    const row = this.must(account);
    row.missed_blocks += increment;
    if (isV2(action.op.block_num)) row.consecutive_missed_blocks += increment;
    // explicit RETURNING column list order
    const data = {
      account_name: row.account_name,
      missed_blocks: row.missed_blocks,
      is_active: row.is_active,
      post_url: row.post_url,
      total_votes: scaledToNumber(row.total_votes, 3),
      reward_account: row.reward_account,
      api_url: row.api_url,
      last_version: row.last_version,
      consecutive_missed_blocks: row.consecutive_missed_blocks as number | undefined,
    };
    return [new EventLog("update", "validators", versioned(data, action.op.block_num))];
  }

  updateVersion(account: string, version: string, action: IAction): EventLog[] {
    const row = this.must(account);
    row.last_version = version;
    return [new EventLog("update", "validators", into(row, action.op.block_num))];
  }

  resetConsecutiveMissedBlocks(account: string, action: IAction): EventLog[] {
    const row = this.must(account);
    row.consecutive_missed_blocks = 0;
    return [new EventLog("update", "validators", into(row, action.op.block_num))];
  }

  getValidators(params: { limit?: number; is_active?: boolean; reward_account?: string }): ReturnType<typeof rawRow>[] {
    let rows = this.state.validators.all();
    if (params.is_active !== undefined) rows = rows.filter((r) => r.is_active === params.is_active);
    if (params.reward_account !== undefined) rows = rows.filter((r) => r.reward_account === params.reward_account);
    rows = orderValidators(rows);
    if (params.limit !== undefined) rows = rows.slice(0, params.limit);
    return rows.map(rawRow);
  }

  /** Upstream isTopValidator: active, total_votes > 0, ORDER BY total_votes DESC, account_name, LIMIT n. */
  isTopValidator(account: string, num_top_validators: number): boolean {
    const rows = orderValidators(this.state.validators.all().filter((r) => r.is_active && r.total_votes > 0n)).slice(0, num_top_validators);
    return rows.some((r) => r.account_name === account);
  }

  lookup(account: string, block_num: number): ValidatorEntry | null {
    const row = this.state.validators.get(account);
    return row ? into(row, block_num) : null;
  }

  getBlockValidator(block: Pick<BlockRef, "prng" | "block_num">): ValidatorEntry | null {
    const cfg = this.config.validator;
    if (!cfg) return null;
    if (cfg.paused_until_block > block.block_num) return null;
    const rows = orderValidators(this.state.validators.all().filter((r) => r.is_active && r.total_votes > 0n));
    const valid = rows.map((r) => into(r, block.block_num));
    const min_validators = cfg.min_validators;
    if (min_validators === undefined || rows.length < min_validators) return null;
    const rng = block.prng;
    const total_votes = valid.reduce((t, v) => t + v.total_votes, 0);
    const index = rng() * total_votes;
    let total = 0;
    let i;
    for (i = 0; i < valid.length; i++) {
      total += valid[i].total_votes;
      if (index < total) return valid[i];
    }
    return valid[i] ?? null;
  }

  /** UPDATE validators SET consecutive_missed_blocks = 0, missed_blocks = 0 RETURNING *, sorted with localeCompare. */
  resetMissedBlocksForAllValidators(action: IAction): EventLog[] {
    const rows = this.state.validators.all();
    for (const r of rows) {
      r.consecutive_missed_blocks = 0;
      r.missed_blocks = 0;
    }
    rows.sort((a, b) => localeSort(a.account_name, b.account_name));
    return rows.map((r) => new EventLog("update", "validators", into(r, action.op.block_num)));
  }
}

export class ValidatorVoteRepository {
  constructor(private readonly state: StateStore, private readonly balances: BalanceRepository) {}

  private calculateVoteWeight(account: string): number {
    return this.balances.getBalance(account, TOKENS.SPSP);
  }

  lookupByVoter(voter: string): { voter: string; validator: string; vote_weight: string }[] {
    return this.state.votes.getByVoter(voter).map((v) => ({ voter: v.voter, validator: v.validator, vote_weight: formatScaled(v.vote_weight, 3) }));
  }

  private historyEvent(action: IAction, is_approval: boolean, vote_weight: number): EventLog {
    const validator = action.params?.account_name as string;
    return new EventLog("insert", "validator_vote_history", {
      transaction_id: action.op.trx_op_id,
      created_date: action.op.block_time,
      voter: action.op.account,
      validator,
      is_approval,
      vote_weight: formatScaled(numberToScaled(vote_weight, 3), 3),
    });
  }

  insert(action: IAction): EventLog[] {
    const balance = this.calculateVoteWeight(action.op.account);
    const validator = action.params.account_name as string;
    this.state.votes.set(action.op.account, validator, numberToScaled(balance, 3));
    return [
      ...this.syncValidatorVotes([validator], action.op.block_num),
      this.historyEvent(action, true, balance),
      // upstream logs an un-awaited Promise here, which serialises as {}
      new EventLog("insert", "validator_votes", {}),
    ];
  }

  delete(action: IAction): EventLog[] {
    const balance = this.calculateVoteWeight(action.op.account);
    const validator = action.params.account_name as string;
    const w = this.state.votes.delete(action.op.account, validator);
    const rows = w === undefined ? [] : [{ voter: action.op.account, validator, vote_weight: formatScaled(w, 3) }];
    const deleteVote = new EventLog("delete", "validator_votes", rows);
    const synced = this.syncValidatorVotes([validator], action.op.block_num);
    const history = this.historyEvent(action, false, balance);
    return [deleteVote, ...synced, history];
  }

  incrementVoteWeight(voter: string, amount: number, block_num: number): EventLog[] {
    const votes = this.state.votes.getByVoter(voter);
    const updated = votes.map((v) => {
      const nw = addScaled(v.vote_weight, amount, 3);
      this.state.votes.set(v.voter, v.validator, nw);
      return { voter: v.voter, validator: v.validator, vote_weight: formatScaled(nw, 3) };
    });
    updated.sort((a, b) => localeSort(a.validator, b.validator) || localeSort(a.voter, b.voter));
    const voteEvents = updated.map((v) => new EventLog("update", "validator_votes", v));
    if (updated.length > 0) {
      return [...voteEvents, ...this.syncValidatorVotes(updated.map((v) => v.validator), block_num)];
    }
    return voteEvents;
  }

  /** UPDATE validator_votes SET vote_weight = weight WHERE voter RETURNING *, then sync totals. */
  setVoteWeight(voter: string, weight: number, block_num: number): EventLog[] {
    const scaled = numberToScaled(weight, 3);
    const updated = this.state.votes.getByVoter(voter).map((v) => {
      this.state.votes.set(v.voter, v.validator, scaled);
      return { voter: v.voter, validator: v.validator, vote_weight: formatScaled(scaled, 3) };
    });
    updated.sort((a, b) => localeSort(a.validator, b.validator) || localeSort(a.voter, b.voter));
    const voteEvents = updated.map((v) => new EventLog("update", "validator_votes", v));
    if (updated.length > 0) {
      return [...voteEvents, ...this.syncValidatorVotes(updated.map((v) => v.validator), block_num)];
    }
    return voteEvents;
  }

  private syncValidatorVotes(validators: string[], block_num: number): EventLog[] {
    const updated: ValidatorRow[] = [];
    for (const name of new Set(validators)) {
      const voters = this.state.votes.votersOf(name);
      if (voters.length === 0) continue; // no group row → no update
      const row = this.state.validators.get(name);
      if (!row) continue;
      row.total_votes = this.state.votes.sum(name);
      updated.push(row);
    }
    updated.sort((a, b) => localeSort(a.account_name, b.account_name));
    return updated.map((v) => new EventLog("update", "validators", versioned(rawRow(v) as ReturnType<typeof rawRow> & { consecutive_missed_blocks?: number }, block_num)));
  }
}
