import type { Services } from "../services.mjs";
import type { BlockRef, ProcessResult } from "../types.mjs";
import { ACCOUNTS } from "../repos/context.mjs";

export interface VirtualPayloadSource {
  process(block: BlockRef): ProcessResult[];
  trx_id(block: BlockRef): string;
}

export class ClearBurnedTokensSource implements VirtualPayloadSource {
  constructor(private readonly svc: Services) {}

  process(block: BlockRef): ProcessResult[] {
    const payloads = this.payloads();
    if (payloads.length === 0) return [];
    return [["custom_json", { required_auths: [ACCOUNTS.BURN], required_posting_auths: [], id: this.svc.prefix.custom_json_id, json: payloads }]];
  }

  trx_id(block: BlockRef): string {
    return `clear_burned_${block.block_num}@${block.block_time.getTime()}`;
  }

  private payloads() {
    return this.svc.balances
      .getBalances(ACCOUNTS.BURN)
      .filter((e) => e.balance > 0)
      .map((e) => ({ action: "burn", params: { account: ACCOUNTS.BURN, to: ACCOUNTS.BURNED_LEDGER, token: e.token, qty: e.balance } }));
  }
}

export class UpdateMissedBlocksSource implements VirtualPayloadSource {
  constructor(private readonly svc: Services) {}

  trx_id(block: BlockRef): string {
    return `update_missed_blocks_${block.block_num}@${block.block_time.getTime()}`;
  }

  process(block: BlockRef): ProcessResult[] {
    const cfg = this.svc.config.validator;
    if (!cfg) return [];
    const expired_block = block.block_num - 1 - cfg.max_block_age;
    const last_checked_block = cfg.last_checked_block;
    // not part of the hash, but always applied
    this.svc.config.updateLastCheckedBlock(expired_block);
    if (expired_block < cfg.reward_start_block) return [];
    const adjust = this.svc.transitions.transitionPoints.adjust_token_distribution_strategy;
    const ignored_range_start = adjust ? adjust - cfg.max_block_age : 0;
    const ignored_range_end = adjust ? adjust + cfg.max_block_age : 0;
    if (expired_block >= ignored_range_start && expired_block <= ignored_range_end) return [];
    const missed = this.svc.blocks.getMissedBlocks(last_checked_block, expired_block);
    if (missed.length === 0) return [];
    const byAccount: Record<string, number> = {};
    for (const b of missed) {
      if (!b.validator) continue;
      if (!byAccount[b.validator]) byAccount[b.validator] = 0;
      byAccount[b.validator]++;
    }
    const entries = Object.entries(byAccount).sort((a, b) => b[1] - a[1]);
    return entries.map(([account, missed_blocks]) => [
      "custom_json",
      {
        required_auths: [ACCOUNTS.MISSED_BLOCKS],
        required_posting_auths: [],
        id: this.svc.prefix.custom_json_id,
        json: { action: "update_missed_blocks", params: { account, checked_block: expired_block, missed_blocks } },
      },
    ]);
  }
}

/** Upstream order: TokenUnstaking, PoolClaims, ClearBurned, Promises, LicenseManager, MissedBlocks, Transitions, RentalExpiration. */
export function virtualSources(svc: Services): VirtualPayloadSource[] {
  return [
    svc.unstaking,
    svc.poolClaims,
    new ClearBurnedTokensSource(svc),
    svc.promiseManager,
    svc.licenseManager,
    new UpdateMissedBlocksSource(svc),
    svc.transitions,
    svc.rentalExpiration,
  ];
}
