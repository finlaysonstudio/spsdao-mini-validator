import { readFile } from "node:fs/promises";
import type { StateStore } from "../state/index.mjs";
import type { SeedFile } from "./types.mjs";

export interface BootstrapResult {
  startBlock: number;
  prevL2Hash: string;
  blockId: string;
  blockTime: Date;
  knownHashes: Map<number, string>;
}

export async function bootstrap(
  state: StateStore,
  seedPath: string,
): Promise<BootstrapResult> {
  const raw = await readFile(seedPath, "utf-8");
  const seed: SeedFile = JSON.parse(raw);

  // Load config first (pools are extracted from config entries)
  state.config.load(seed.config ?? []);

  // Load all state stores
  state.balances.load(seed.balances ?? []);
  state.validators.load(seed.validators ?? []);
  state.delegations.load(seed.active_delegations ?? []);
  state.unstaking.load(seed.token_unstaking ?? []);

  state.pools.load(seed.pools ?? [], seed.staking_pool_reward_debt ?? []);

  // Promises — normalize from DB format
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

  // Check-ins — normalize from DB format (last_check_in_block_num → block_num)
  const checkIns = (seed.check_ins ?? []).map((ci) => ({
    account: ci.account,
    block_num: ci.block_num ?? ci.last_check_in_block_num ?? 0,
    hash: ci.hash ?? "",
    status: ci.status ?? "active",
  }));
  state.checkIns.load(checkIns);

  // Hive accounts — handle both string[] and {name}[] formats
  const hiveAccounts =
    seed.hive_accounts?.map((a) => (typeof a === "string" ? a : a.name)) ?? [];
  state.hiveAccounts.load(hiveAccounts);

  // Price history
  if (seed.price_history) {
    state.priceHistory.load(seed.price_history);
  }

  // Store the seed block reference
  state.blocks.set({
    block_num: seed.block_num,
    block_id: seed.block_id,
    prev_block_id: seed.prev_block_id ?? "",
    block_time: new Date(seed.block_time),
    l2_block_id: seed.l2_block_id,
  });

  // Load recent blocks (needed for check-in hash verification)
  if (seed.recent_blocks) {
    for (const rb of seed.recent_blocks) {
      if (rb.block_num === seed.block_num) continue; // already added above
      state.blocks.set({
        block_num: rb.block_num,
        block_id: rb.block_id,
        prev_block_id: rb.prev_block_id,
        block_time: new Date(rb.block_time),
        l2_block_id: rb.l2_block_id,
        validator: rb.validator,
        validation_tx: rb.validation_tx,
      });
    }
  }

  // Build known hashes map for verification
  const knownHashes = new Map<number, string>();
  if (seed.known_hashes) {
    for (const kh of seed.known_hashes) {
      knownHashes.set(kh.block_num, kh.l2_block_id);
    }
  }

  console.log(
    `Bootstrapped from block ${seed.block_num} (L2 hash: ${seed.l2_block_id.slice(0, 12)}...)`,
  );
  console.log(
    `  Balances: ${seed.balances?.length ?? 0}, Validators: ${seed.validators?.length ?? 0}`,
  );
  console.log(`  Known hashes for verification: ${knownHashes.size}`);

  return {
    startBlock: seed.block_num + 1,
    prevL2Hash: seed.l2_block_id,
    blockId: seed.block_id,
    blockTime: new Date(seed.block_time),
    knownHashes,
  };
}
