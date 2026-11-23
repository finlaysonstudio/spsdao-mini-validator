import type { PriceRow, StateStore } from "../state/index.mjs";
import { EventLog } from "../types.mjs";
import { numberToScaled, scaledToNumber } from "../util/num.mjs";
import { pgCompare } from "../util/collate.mjs";
import type { BlockRepository } from "./blocks.mjs";
import type { ConfigLoader } from "./config.mjs";
import type { ValidatorRepository } from "./validators.mjs";

export type PriceEntry = { validator: string; token: string; block_num: number; block_time: Date; token_price: number };

function into(r: PriceRow): PriceEntry {
  return { validator: r.validator, token: r.token, block_num: r.block_num, block_time: r.block_time, token_price: scaledToNumber(r.token_price, 6) };
}

export class PriceHistoryRepository {
  constructor(private readonly state: StateStore) {}

  getLastPriceEntry(validator: string, token: string): PriceEntry | null {
    const r = this.state.priceHistory.get(validator, token);
    return r ? into(r) : null;
  }

  /**
   * groupedHistory: WHERE block_time > since ORDER BY block_time DESC, validator DESC, grouped by
   * token (groups in first-seen order).
   */
  groupedHistory(since: Date): Map<string, PriceEntry[]> {
    const rows = this.state.priceHistory
      .all()
      .filter((r) => r.block_time > since)
      .sort((a, b) => b.block_time.getTime() - a.block_time.getTime() || pgCompare(b.validator, a.validator));
    const grouped = new Map<string, PriceEntry[]>();
    for (const r of rows) {
      const list = grouped.get(r.token) ?? [];
      list.push(into(r));
      grouped.set(r.token, list);
    }
    return grouped;
  }

  upsert(payload: PriceEntry): PriceEntry {
    const row: PriceRow = {
      validator: payload.validator,
      token: payload.token,
      block_num: payload.block_num,
      block_time: payload.block_time,
      token_price: numberToScaled(payload.token_price, 6),
    };
    this.state.priceHistory.set(row);
    return into(row);
  }
}

/** MedianPriceCalculator.calculate (entries are never empty here). */
function median(entries: PriceEntry[]): number {
  const prices = entries.map((e) => e.token_price).sort((a, b) => a - b);
  if (prices.length % 2 === 0) return (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
  return prices[Math.floor(prices.length / 2)];
}

/**
 * RawPriceFeed + SpsTopPriceFeedWrapper, collapsed.
 *
 * RawPriceFeed is also the shop's PriceFeedConsumer: a cache of `groupedHistory(since)` with
 * `since` one month before the latest processed block's time. It is refilled at startup, after
 * every price entry it stores, and on a lookup while it holds no token at all. Price rows only
 * change through those stores, so the cache equals the current rows filtered by the `since` of
 * the last fill.
 */
export class PriceFeedProducer {
  /** `since` of the last fill; undefined = not filled since startup. */
  private since: Date | undefined;

  constructor(
    private readonly priceHistory: PriceHistoryRepository,
    private readonly validators: ValidatorRepository,
    private readonly config: ConfigLoader,
    private readonly blocks: BlockRepository,
  ) {
    this.fill(); // RawPriceFeed.prime at startup
  }

  /** RawPriceFeed.fillStore: no-op without a processed block (the cache stays empty). */
  private fill(): void {
    this.since = undefined;
    const blockNum = this.blocks.getLatestBlockNum();
    if (blockNum === null) return;
    const lastBlock = this.blocks.getByBlockNum(blockNum);
    if (lastBlock === null) return;
    const since = new Date(lastBlock.block_time);
    // since.setMonth(since.getMonth() - 1) in the upstream container's time zone (UTC)
    since.setUTCMonth(since.getUTCMonth() - 1);
    this.since = since;
  }

  private cache(): Map<string, PriceEntry[]> {
    return this.since === undefined ? new Map() : this.priceHistory.groupedHistory(this.since);
  }

  /** RawPriceFeed.getPriceAtPoint */
  getPriceAtPoint(token: string, block_time: Date): number | undefined {
    void block_time; // the median calculator ignores the time
    let cache = this.cache();
    if (cache.size === 0) {
      this.fill();
      cache = this.cache();
    }
    const relevant = cache.get(token);
    return relevant?.length ? median(relevant) : undefined;
  }

  /** Upstream RawPriceFeed.addPriceEntry (used by the legacy admin feed). */
  addRawPriceEntry(pe: PriceEntry): EventLog[] {
    return this.rawAdd(pe);
  }

  private rawAdd(pe: PriceEntry): EventLog[] {
    const result = this.priceHistory.upsert(pe);
    this.fill();
    return [new EventLog("upsert", "price_history", result)];
  }

  addPriceEntry(pe: PriceEntry): EventLog[] {
    const pf = this.config.price_feed;
    if (!pf) return [];
    const lastEntry = this.priceHistory.getLastPriceEntry(pe.validator, pe.token);
    if (lastEntry && lastEntry.block_num + pf.interval_blocks > pe.block_num) return [];
    if (!this.switchedOver(pe)) return this.rawAdd(pe);
    const top = this.getTopValidators();
    if (top.some((v) => v.account_name === pe.validator)) return this.rawAdd(pe);
    return [];
  }

  private switchedOver(pe: PriceEntry): boolean {
    const v = this.config.validator;
    if (!v) return false;
    const startBlock = Math.max(v.reward_start_block, v.paused_until_block);
    return pe.block_num >= startBlock;
  }

  private getTopValidators() {
    const limit = this.config.validator?.num_top_validators;
    if (limit) return this.validators.getValidators({ limit, is_active: true });
    return [];
  }
}
