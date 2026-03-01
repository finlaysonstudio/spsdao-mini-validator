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

  // Load all state stores
  state.balances.load(seed.balances ?? []);
  state.validators.load(seed.validators ?? []);
  state.delegations.load(seed.active_delegations ?? []);
  state.unstaking.load(seed.token_unstaking ?? []);
  state.pools.load(seed.pools ?? [], seed.staking_pool_reward_debt ?? []);
  state.promises.load(seed.promises ?? []);
  state.config.load(seed.config ?? []);
  state.checkIns.load(seed.check_ins ?? []);
  state.hiveAccounts.load(seed.hive_accounts ?? []);

  // Store the seed block reference
  state.blocks.set({
    block_num: seed.block_num,
    block_id: seed.block_id,
    prev_block_id: "",
    block_time: new Date(seed.block_time),
    l2_block_id: seed.l2_block_id,
  });

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
