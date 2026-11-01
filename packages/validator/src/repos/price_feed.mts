import type { PriceRow, StateStore } from "../state/index.mjs";
import { EventLog } from "../types.mjs";
import { numberToScaled, scaledToNumber } from "../util/num.mjs";
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

/** RawPriceFeed + SpsTopPriceFeedWrapper, collapsed. */
export class PriceFeedProducer {
  constructor(
    private readonly priceHistory: PriceHistoryRepository,
    private readonly validators: ValidatorRepository,
    private readonly config: ConfigLoader,
  ) {}

  private rawAdd(pe: PriceEntry): EventLog[] {
    const result = this.priceHistory.upsert(pe);
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
