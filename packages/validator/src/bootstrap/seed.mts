/**
 * Seed loader. The seed is NDJSON: one `{"t": <table>, "r": <row>}` per line,
 * first line `{"t":"meta", ...}`. See tools/extract-seed.mts for the writer.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import type { StateStore } from "../state/index.mjs";
import { toScaled } from "../util/num.mjs";
import { log } from "../util/log.mjs";

export type SeedMeta = { block_num: number; l2_block_id: string; block_id: string; extracted_at: string };

const d = (v: string | null): Date | null => (v === null || v === undefined ? null : new Date(v));

export async function loadSeed(state: StateStore, path: string): Promise<SeedMeta> {
  let meta: SeedMeta | undefined;
  const counts: Record<string, number> = {};
  let input: NodeJS.ReadableStream = createReadStream(path);
  if (path.endsWith(".gz")) input = input.pipe(createGunzip());
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const { t, r } = JSON.parse(line);
    counts[t] = (counts[t] ?? 0) + 1;
    switch (t) {
      case "meta":
        meta = r;
        break;
      case "blocks":
        state.blocks.set({ ...r, block_time: new Date(r.block_time) });
        break;
      case "config":
        state.config.set({ ...r, last_updated_date: d(r.last_updated_date) });
        break;
      case "balances":
        state.balances.set(r.player, r.token, toScaled(r.balance, 3));
        break;
      case "hive_accounts":
        state.hiveAccounts.add(r.name);
        if (r.authority) state.hiveAccounts.setAuthority(r.name, r.authority);
        break;
      case "validators":
        state.validators.set({ ...r, total_votes: toScaled(r.total_votes, 3) });
        break;
      case "validator_votes":
        state.votes.set(r.voter, r.validator, toScaled(r.vote_weight, 3));
        break;
      case "validator_check_in":
        state.checkIns.set({ ...r, last_check_in: new Date(r.last_check_in) });
        break;
      case "token_unstaking":
        state.unstaking.set({
          ...r,
          unstake_start_date: new Date(r.unstake_start_date),
          next_unstake_date: new Date(r.next_unstake_date),
          total_qty: toScaled(r.total_qty, 3),
          total_unstaked: toScaled(r.total_unstaked, 3),
        });
        break;
      case "price_history":
        state.priceHistory.set({ ...r, block_time: new Date(r.block_time), token_price: toScaled(r.token_price, 6) });
        break;
      case "staking_pool_reward_debt":
        state.rewardDebts.set(r.pool_name, r.player, toScaled(r.reward_debt, 3));
        break;
      case "active_delegations":
        state.delegations.set({
          ...r,
          amount: toScaled(r.amount, 3),
          last_delegation_date: new Date(r.last_delegation_date),
          last_undelegation_date: d(r.last_undelegation_date),
        });
        break;
      case "token_transfer_keys":
        state.transferKeys.add(r.account, r.key);
        break;
      case "promise":
        state.promises.setLive({
          ...r,
          fulfilled_at: d(r.fulfilled_at),
          fulfilled_expiration: d(r.fulfilled_expiration),
          created_date: new Date(r.created_date),
          updated_date: new Date(r.updated_date),
        });
        break;
      case "promise_closed":
        state.promises.addClosedPacked(r.type, r.ext_id, state.promises.pack(r.status, r.lender ?? undefined, r.controllers ?? []));
        break;
      case "rental_delegations":
        state.rentals.insertActive({ ...r, qty: toScaled(r.qty, 3), created_date: new Date(r.created_date), updated_date: new Date(r.updated_date) });
        break;
      case "rental_ids":
        state.rentals.rememberId(r.id);
        break;
      default:
        throw new Error(`unknown seed table ${t}`);
    }
  }
  if (!meta) throw new Error("seed has no meta line");
  log(`Seed loaded at block ${meta.block_num}: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  return meta;
}
