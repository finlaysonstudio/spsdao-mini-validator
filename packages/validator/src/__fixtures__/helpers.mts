import { readFileSync } from "node:fs";
import { StateStore } from "../state/index.mjs";
import type { ActionContext, ParsedAction } from "../operations/types.mjs";
import type { HiveBlock, HiveTransaction } from "../hive/types.mjs";
import type { SeedFile } from "../bootstrap/types.mjs";

export const FIXTURE_BLOCK_NUM = 100001;
export const FIXTURE_BLOCK_ID =
  "0001869b0000000000000000000000000000000000000000000000000000dead";
export const FIXTURE_PREV_BLOCK_ID =
  "0001869a0000000000000000000000000000000000000000000000000000beef";
export const FIXTURE_BLOCK_TIME = new Date("2024-01-15T12:00:03.000Z");
export const FIXTURE_PREV_L2_HASH =
  "abc123def456abc123def456abc123def456abc123def456abc123def456abcd";

const seedPath = new URL("./seed-minimal.json", import.meta.url);

function loadSeed(): SeedFile {
  return JSON.parse(readFileSync(seedPath, "utf-8"));
}

export function createStateStore(): StateStore {
  const state = new StateStore();
  const seed = loadSeed();

  state.config.load(seed.config ?? []);
  state.balances.load(seed.balances ?? []);
  state.validators.load(seed.validators ?? []);
  state.delegations.load(seed.active_delegations ?? []);
  state.unstaking.load(seed.token_unstaking ?? []);
  state.pools.load(seed.pools ?? [], seed.staking_pool_reward_debt ?? []);

  const promises = (seed.promises ?? []).map((p) => ({
    id: String(p.id),
    type: p.type,
    controller: p.controller ?? p.controllers?.[0] ?? "",
    fulfilled_by: p.fulfilled_by,
    params: p.params ?? {},
    status: p.status,
    created_block_num: p.created_block_num ?? 0,
    expiration_block_num: p.expiration_block_num,
  }));
  state.promises.load(promises);

  const checkIns = (seed.check_ins ?? []).map((ci) => ({
    account: ci.account,
    block_num: ci.block_num ?? ci.last_check_in_block_num ?? 0,
    hash: ci.hash ?? "",
    status: ci.status ?? "active",
  }));
  state.checkIns.load(checkIns);

  const hiveAccounts =
    seed.hive_accounts?.map((a: string | { name: string }) =>
      typeof a === "string" ? a : a.name,
    ) ?? [];
  state.hiveAccounts.load(hiveAccounts);

  if (seed.price_history) {
    state.priceHistory.load(seed.price_history);
  }

  state.blocks.set({
    block_num: seed.block_num,
    block_id: seed.block_id,
    prev_block_id: seed.prev_block_id ?? "",
    block_time: new Date(seed.block_time),
    l2_block_id: seed.l2_block_id,
  });

  return state;
}

export function createActionContext(
  overrides: Partial<ActionContext> = {},
): ActionContext {
  return {
    state: overrides.state ?? createStateStore(),
    blockNum: overrides.blockNum ?? FIXTURE_BLOCK_NUM,
    blockTime: overrides.blockTime ?? FIXTURE_BLOCK_TIME,
    blockId: overrides.blockId ?? FIXTURE_BLOCK_ID,
    prevBlockId: overrides.prevBlockId ?? FIXTURE_PREV_BLOCK_ID,
    trxId: overrides.trxId ?? "test-trx-id-001",
    actionType: overrides.actionType ?? "test_action",
  };
}

export function createParsedAction(
  overrides: Partial<ParsedAction> = {},
): ParsedAction {
  return {
    name: overrides.name ?? "test_action",
    players: overrides.players ?? ["alice"],
    params: overrides.params ?? {},
    trxId: overrides.trxId ?? "test-trx-id-001",
    opIndex: overrides.opIndex ?? 0,
    actionIndex: overrides.actionIndex ?? 0,
  };
}

export function makeHiveBlock(
  overrides: Partial<{
    block_id: string;
    previous: string;
    timestamp: string;
    transactions: HiveTransaction[];
    transaction_ids: string[];
  }> = {},
): HiveBlock {
  return {
    block_id: overrides.block_id ?? FIXTURE_BLOCK_ID,
    previous: overrides.previous ?? FIXTURE_PREV_BLOCK_ID,
    timestamp: overrides.timestamp ?? "2024-01-15T12:00:03",
    transactions: overrides.transactions ?? [],
    transaction_ids: overrides.transaction_ids ?? [],
  };
}

export function makeCustomJsonTx(
  id: string,
  json: unknown,
  opts: {
    required_auths?: string[];
    required_posting_auths?: string[];
  } = {},
): { tx: HiveTransaction; txId: string } {
  return {
    tx: {
      ref_block_num: 0,
      ref_block_prefix: 0,
      expiration: "2024-01-15T12:01:00",
      operations: [
        {
          type: "custom_json_operation",
          value: {
            id,
            json: JSON.stringify(json),
            required_auths: opts.required_auths ?? [],
            required_posting_auths: opts.required_posting_auths ?? [],
          },
        },
      ],
      extensions: [],
      signatures: [],
    },
    txId: `trx-${id}-${Date.now()}`,
  };
}
