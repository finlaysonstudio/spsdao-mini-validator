/**
 * One-time transition actions (upstream apps/sps-validator/src/sps/actions/transitions/*).
 * Each runs as a virtual op from $TRANSITIONS exactly at its transition point.
 * The raw SQL queries upstream uses are mirrored over the in-memory state,
 * including their ORDER BY (text columns via pgCompare).
 */
import type { Services } from "../services.mjs";
import type { EventLog } from "../types.mjs";
import { pgCompare } from "../util/collate.mjs";
import { scaledToNumber } from "../util/num.mjs";
import { ACCOUNTS, TOKENS, type IAction } from "../repos/context.mjs";

/** transition_fix_vote_weight (95026480): set every voter's vote weight to their SPSP balance. */
export function fixVoteWeight(svc: Services, action: IAction): EventLog[] {
  const { state } = svc;
  // SELECT voter, MAX(vote_weight), balance FROM balances JOIN (...) WHERE token='SPSP' AND balance != vote_weight ORDER BY voter DESC
  const invalid: { voter: string; balance: number }[] = [];
  for (const voter of state.votes.voters()) {
    if (!state.balances.has(voter, TOKENS.SPSP)) continue;
    const votes = state.votes.getByVoter(voter);
    if (votes.length === 0) continue;
    let max = votes[0].vote_weight;
    for (const v of votes) if (v.vote_weight > max) max = v.vote_weight;
    const bal = state.balances.getScaled(voter, TOKENS.SPSP);
    if (bal !== max) invalid.push({ voter, balance: scaledToNumber(bal, 3) });
  }
  invalid.sort((a, b) => pgCompare(b.voter, a.voter));
  const events: EventLog[] = [];
  for (const { voter, balance } of invalid) events.push(...svc.votes.setVoteWeight(voter, balance, action.op.block_num));
  return events;
}

/** CleanupLiteAccountsRepository.getLiteAccounts */
function getLiteAccounts(svc: Services): { account: string; spsp: number; sps: number }[] {
  const accounts = new Set<string>();
  for (const r of svc.state.balances.rows()) {
    // player LIKE '%\_%' AND player NOT LIKE '$%' AND token IN ('SPS','SPSP') AND balance > 0
    if (r.player.includes("_") && !r.player.startsWith("$") && (r.token === TOKENS.SPS || r.token === TOKENS.SPSP) && r.balance > 0n) accounts.add(r.player);
  }
  const pos = (player: string, token: string) => {
    const b = svc.state.balances.getScaled(player, token);
    return b > 0n ? scaledToNumber(b, 3) : 0;
  };
  return Array.from(accounts)
    .sort((a, b) => pgCompare(b, a))
    .map((account) => ({ account, spsp: pos(account, TOKENS.SPSP), sps: pos(account, TOKENS.SPS) }));
}

/** transition_cleanup_lite_accounts (100342741): unstake lite accounts' SPSP and sweep their SPS to sl-cs-lite. */
export function cleanupLiteAccounts(svc: Services, action: IAction): EventLog[] {
  const events: EventLog[] = [];
  for (const a of getLiteAccounts(svc).filter((x) => x.spsp > 0)) {
    events.push(...svc.stakingRewards.claimAll(a.account, [a.spsp * -1, TOKENS.SPSP], action));
    events.push(...svc.balances.updateBalance(action, a.account, ACCOUNTS.STAKING, TOKENS.SPSP, a.spsp, "token_unstaking"));
    events.push(...svc.balances.updateBalance(action, ACCOUNTS.STAKING, a.account, TOKENS.SPS, a.spsp, "token_unstaking"));
    events.push(...svc.votes.incrementVoteWeight(a.account, a.spsp * -1, action.op.block_num));
  }
  for (const a of getLiteAccounts(svc).filter((x) => x.sps > 0)) {
    events.push(...svc.balances.updateBalance(action, a.account, "sl-cs-lite", TOKENS.SPS, a.sps, "token_transfer"));
  }
  return events;
}

/** transition_balance_token_staking_spsp (100342741): make $TOKEN_STAKING's SPSP mirror the players' total. */
export function balanceTokenStakingAccount(svc: Services, action: IAction): EventLog[] {
  let players = 0n;
  let any = false;
  for (const r of svc.state.balances.rows()) {
    if (r.token === TOKENS.SPSP && !r.player.startsWith("$") && r.player !== "null") {
      players += r.balance;
      any = true;
    }
  }
  if (!any || !svc.state.balances.has(ACCOUNTS.STAKING, TOKENS.SPSP)) return []; // NULL + x is NULL -> Number(null) = 0
  const difference = scaledToNumber(players + svc.state.balances.getScaled(ACCOUNTS.STAKING, TOKENS.SPSP), 3);
  if (difference === 0) return [];
  if (difference < 0) throw new Error(`The staking account's abs SPSP balance '${Math.abs(difference)}' is greater than the sum of all players.`);
  return [
    ...svc.balances.updateBalance(action, "sl-cs-admin", ACCOUNTS.STAKING, TOKENS.SPS, difference, "validator_transition_cleanup"),
    ...svc.balances.updateBalance(action, ACCOUNTS.STAKING, "null", TOKENS.SPSP, difference, "validator_transition_cleanup"),
  ];
}

const TRANSFERS = [
  ["$SPS_STAKING_REWARDS", 79_000_000],
  ["$REWARD_POOLS_LICENSE", 1_000_000],
  ["$REWARD_POOLS_MODERN", 50_000_000],
  ["$REWARD_POOLS_WILD", 50_000_000],
  ["$TOURNAMENTS_DISTRIBUTION", 20_000_000],
] as const;

/** transition_adjust_token_distribution_strategy (101928051). */
export function adjustTokenDistributionStrategy(svc: Services, action: IAction): EventLog[] {
  const events: EventLog[] = [];
  for (const [to, amount] of TRANSFERS) {
    events.push(...svc.balances.updateBalance(action, "$UNCLAIMED_UNISWAP_REWARDS", to, TOKENS.SPS, amount, "adjust_token_distribution_strategy"));
  }
  events.push(
    svc.config.reloadingUpdateConfig("sps", "staking_rewards", {
      type: "per_block_capped",
      tokens_per_block: 5.32407,
      start_block: 56186000,
      unstaking_period: 4,
      unstaking_interval_seconds: 604800,
    }),
    svc.config.reloadingUpdateConfig("sps", "validator_rewards", { type: "per_block_capped", tokens_per_block: 2.63888, start_block: 67857521 }),
    svc.config.reloadingUpdateConfig("validator", "tokens_per_block", 0.40509),
    svc.config.reloadingUpsertConfig("validator", "object", "reward_version", "per_block_capped"),
    svc.config.reloadingUpsertConfig("validator", "object", "consecutive_missed_blocks_threshold", 5),
  );
  events.push(...svc.validators.resetMissedBlocksForAllValidators(action));
  return events;
}

/** transition_cancel_delegation_promises (105920215): cancel every open delegation promise. */
export function cancelDelegationPromises(svc: Services, action: IAction): EventLog[] {
  const events: EventLog[] = [];
  for (const p of svc.promises.getOpenPromisesByType("delegation")) {
    const [, logs] = svc.promises.update(
      {
        action: "cancel",
        previous_status: p.status,
        actor: ACCOUNTS.TRANSITIONS,
        type: p.type,
        ext_id: p.ext_id,
        status: "cancelled",
        fulfilled_at: null,
        fulfilled_by: null,
        fulfilled_expiration: null,
      },
      action,
    );
    events.push(...logs);
  }
  return events;
}
