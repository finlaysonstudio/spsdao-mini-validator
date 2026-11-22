/**
 * Price feed duty: a top validator periodically broadcasts the SPS price in USD.
 *
 * Port of upstream PriceFeedPlugin (apps/sps-validator/src/sps/features/price_feed/plugin.ts)
 * and its external feeds (external-feeds.ts), generalised to several accounts. Fire Horse's
 * copies are identical. Nothing here affects block hashes: the price_feed action itself is
 * processed by PriceFeedProducer like any other operation.
 *
 * Price = HIVE in USD (DAO / CoinGecko / CoinMarketCap) ÷ SPS in HIVE (Hive Engine
 * SWAP.HIVE:SPS pool basePrice), rounded to 7 decimals.
 */
import type { Services } from "../services.mjs";
import type { Broadcaster, DutyEvent } from "./duties.mjs";

const HIVE_TOKEN = "HIVE";
const SPS_TOKEN = "SPS";

type Fetch = typeof globalThis.fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** exponential-backoff `backOff` with the options upstream passes (no jitter, no first delay). */
export async function backOff<T>(fn: () => Promise<T>, { numOfAttempts = 3, startingDelay = 1000, maxDelay = 3000, timeMultiple = 2, wait = sleep }: { numOfAttempts?: number; startingDelay?: number; maxDelay?: number; timeMultiple?: number; wait?: (ms: number) => Promise<unknown> } = {}): Promise<T> {
  let delay = startingDelay;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= numOfAttempts) throw err;
      await wait(Math.min(delay, maxDelay));
      delay *= timeMultiple;
    }
  }
}

// ---------------------------------------------------------------------------
// external HIVE/USD feeds
// ---------------------------------------------------------------------------
export interface ExternalPriceFeed {
  readonly name: string;
  getTokenPriceInUSD(token: string): Promise<number | null>;
}

const trimSlash = (url: string) => (url.endsWith("/") ? url.slice(0, -1) : url);

export class DaoExternalPriceFeed implements ExternalPriceFeed {
  readonly name = "dao";
  private readonly apiUrl: string;
  constructor(
    { api_url }: { api_url: string },
    private readonly fetchFn: Fetch = fetch,
  ) {
    this.apiUrl = trimSlash(api_url);
  }
  static isAvailable({ api_url }: { api_url: string }) {
    return !!api_url;
  }
  async getTokenPriceInUSD(token: string): Promise<number | null> {
    const response = await this.fetchFn(`${this.apiUrl}/api/prices/${token}`);
    if (!response.ok) throw new Error(`Failed to fetch price for ${token} from DAO external feed. Status: ${response.status}. Body: ${await response.text()}`);
    const json = (await response.json()) as { price_usd?: string };
    const price = json?.price_usd;
    return price ? parseFloat(price) : null;
  }
}

export type CoinGeckoOpts = { api_url: string; demo_api_url: string; demo: boolean; api_key: string };

export class CoinGeckoExternalPriceFeed implements ExternalPriceFeed {
  readonly name = "coingecko";
  private readonly apiUrl: string;
  private readonly header: string;
  constructor(
    private readonly opts: CoinGeckoOpts,
    private readonly fetchFn: Fetch = fetch,
  ) {
    this.apiUrl = trimSlash(opts.demo ? opts.demo_api_url : opts.api_url);
    this.header = opts.demo ? "x-cg-demo-api-key" : "x-cg-pro-api-key";
  }
  static isAvailable(opts: CoinGeckoOpts) {
    return !!opts.api_url && !!opts.api_key;
  }
  async getTokenPriceInUSD(token: string): Promise<number | null> {
    const response = await this.fetchFn(`${this.apiUrl}/api/v3/simple/price?ids=${encodeURIComponent(token)}&vs_currencies=USD`, { headers: { [this.header]: this.opts.api_key } });
    if (!response.ok) throw new Error(`Failed to fetch price for ${token} from coingecko external feed. Status: ${response.status}. Body: ${await response.text()}`);
    const json = (await response.json()) as Record<string, { usd?: string }>;
    // CoinGecko answers under the lowercase coin id
    const price = (json?.[token] ?? json?.[token.toLowerCase()])?.usd;
    return price ? parseFloat(String(price)) : null;
  }
}

export type CoinMarketCapOpts = { api_url: string; api_key: string; token_map: Record<string, string> };

export class CoinMarketCapExternalPriceFeed implements ExternalPriceFeed {
  readonly name = "coinmarketcap";
  private readonly apiUrl: string;
  private readonly tokenMap: Map<string, string>;
  constructor(
    private readonly opts: CoinMarketCapOpts,
    private readonly fetchFn: Fetch = fetch,
  ) {
    this.apiUrl = trimSlash(opts.api_url);
    this.tokenMap = new Map(Object.entries(opts.token_map).map(([k, v]) => [k.toLowerCase(), v]));
  }
  static isAvailable(opts: CoinMarketCapOpts) {
    return !!opts.api_url && !!opts.api_key && !!opts.token_map && Object.keys(opts.token_map).length > 0;
  }
  async getTokenPriceInUSD(token: string): Promise<number | null> {
    const ucid = this.tokenMap.get(token.toLowerCase());
    if (!ucid) throw new Error(`No mapping found for token ${token}`);
    const response = await this.fetchFn(`${this.apiUrl}/v2/cryptocurrency/quotes/latest?id=${ucid}`, { headers: { "X-CMC_PRO_API_KEY": this.opts.api_key } });
    if (!response.ok) throw new Error(`Failed to fetch price for ${token} from coin market cap external feed. Status: ${response.status}. Body: ${await response.text()}`);
    const json = (await response.json()) as { data?: Record<string, { quote?: { USD?: { price?: string } } }> };
    const price = json?.data?.[ucid]?.quote?.USD?.price;
    return price ? parseFloat(String(price)) : null;
  }
}

export type PriceFeedSettings = {
  dao: { api_url: string };
  coinGecko: CoinGeckoOpts;
  coinMarketCap: CoinMarketCapOpts;
};

/** The feeds upstream's composition root registers: those whose settings are complete. */
export function configuredFeeds(settings: PriceFeedSettings, fetchFn: Fetch = fetch): ExternalPriceFeed[] {
  const feeds: ExternalPriceFeed[] = [];
  if (DaoExternalPriceFeed.isAvailable(settings.dao)) feeds.push(new DaoExternalPriceFeed(settings.dao, fetchFn));
  if (CoinGeckoExternalPriceFeed.isAvailable(settings.coinGecko)) feeds.push(new CoinGeckoExternalPriceFeed(settings.coinGecko, fetchFn));
  if (CoinMarketCapExternalPriceFeed.isAvailable(settings.coinMarketCap)) feeds.push(new CoinMarketCapExternalPriceFeed(settings.coinMarketCap, fetchFn));
  return feeds;
}

// ---------------------------------------------------------------------------
// Hive Engine
// ---------------------------------------------------------------------------
/** dhive-sl `engine.marketpools.getPools(pair)[0].basePrice`, failing over across nodes in order. */
export class HiveEngine {
  constructor(
    private readonly nodes: string[],
    private readonly fetchFn: Fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async getPoolBasePrice(tokenPair: string): Promise<string> {
    let lastError: unknown = null;
    for (const node of this.nodes) {
      try {
        const res = await this.fetchFn(`${trimSlash(node)}/contracts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "find", params: { contract: "marketpools", table: "pools", query: { tokenPair: { $in: [tokenPair] } } } }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${node}`);
        const json = (await res.json()) as { result?: { basePrice: string }[]; error?: { message: string } };
        if (json.error) throw new Error(`RPC error from ${node}: ${json.error.message}`);
        if (!json.result || !json.result.length) throw new Error("Failed to fetch Hive Engine price");
        return json.result[0].basePrice;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("No Hive Engine nodes configured");
  }
}

export type PriceResult = { price: number; metadata: { hive_usd: number; he_price: number; external_feed: string | null } };

/** Feeds are tried in random order; the first one that answers with a price is used. */
export async function getTokenPriceInUSD({ token, feeds, engine, random = Math.random, wait = sleep, onFeedError }: { token: string; feeds: ExternalPriceFeed[]; engine: HiveEngine; random?: () => number; wait?: (ms: number) => Promise<unknown>; onFeedError?: (feed: string, err: unknown) => void }): Promise<PriceResult> {
  const randomized = [...feeds].sort(() => random() - 0.5);
  let externalHivePrice: number | null = null;
  let feedUsed: string | null = null;
  for (const feed of randomized) {
    try {
      const maybe = await backOff(() => feed.getTokenPriceInUSD(HIVE_TOKEN), { wait });
      if (maybe === null || maybe === undefined || !Number.isFinite(maybe)) {
        onFeedError?.(feed.name, new Error(`no ${HIVE_TOKEN} price in the response`));
        continue;
      }
      externalHivePrice = maybe;
      feedUsed = feed.name;
      break;
    } catch (err) {
      onFeedError?.(feed.name, err);
    }
  }
  if (externalHivePrice === null) throw new Error("Failed to get HIVE price from any external feed");

  const hePrice = await backOff(() => engine.getPoolBasePrice(`SWAP.HIVE:${token}`), { wait });
  const he = parseFloat(hePrice);
  if (isNaN(he)) throw new Error(`Failed to get price for ${token} from Hive Engine`);
  const metadata = { hive_usd: externalHivePrice, he_price: he, external_feed: feedUsed };
  if (he === 0) return { price: 0, metadata };
  return { price: parseFloat((externalHivePrice / he).toFixed(7)), metadata };
}

// ---------------------------------------------------------------------------
// the duty
// ---------------------------------------------------------------------------
type AccountState = { nextBlock: number | undefined };

export class PriceFeedDuty {
  private readonly svc: Services;
  private readonly accounts: string[];
  private readonly broadcaster: Broadcaster;
  private readonly emit: (event: DutyEvent) => void;
  private readonly feeds: ExternalPriceFeed[];
  private readonly engine: HiveEngine;
  private readonly random: () => number;
  private readonly wait: (ms: number) => Promise<unknown>;
  private readonly state = new Map<string, AccountState>();
  private readonly inflight = new Set<Promise<void>>();
  private warnedConfig = false;

  constructor({ svc, accounts, broadcaster, emit, feeds, engine, random = Math.random, wait = sleep }: { svc: Services; accounts: string[]; broadcaster: Broadcaster; emit: (event: DutyEvent) => void; feeds: ExternalPriceFeed[]; engine: HiveEngine; random?: () => number; wait?: (ms: number) => Promise<unknown> }) {
    this.svc = svc;
    this.accounts = [...new Set(accounts.map((a) => a.trim()).filter(Boolean))];
    this.broadcaster = broadcaster;
    this.emit = emit;
    this.feeds = feeds;
    this.engine = engine;
    this.random = random;
    this.wait = wait;
  }

  /** Run after BlockProcessor.process for every block, in order. */
  onBlock({ block_num, head_block }: { block_num: number; head_block: number }): void {
    for (const account of this.accounts) this.forAccount(account, block_num, head_block);
  }

  /** Wait for every price lookup in progress (tests). */
  async flush(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  private nextAfter(block: number, interval: number): number {
    return block + interval + Math.floor(this.random() * interval);
  }

  private forAccount(account: string, block_num: number, head_block: number): void {
    const pf = this.svc.config.price_feed;
    const v = this.svc.config.validator;
    if (!pf || !v) {
      if (!this.warnedConfig) this.emit({ status: "warning", msg: "duty skipped", fields: { duty: "price_feed", reason: !pf ? "price_feed_config_invalid" : "validator_config_invalid" } });
      this.warnedConfig = true;
      return;
    }
    let st = this.state.get(account);
    if (!st) {
      // upstream prime(): resume from the account's last recorded price
      const last = this.svc.priceHistory.getLastPriceEntry(account, SPS_TOKEN);
      st = { nextBlock: last ? this.nextAfter(last.block_num, pf.interval_blocks) : undefined };
      this.state.set(account, st);
    }
    if (st.nextBlock && head_block < st.nextBlock) return;

    // prevent sending a ton of prices if we're far behind; send as soon as we catch up
    if (head_block - block_num > pf.interval_blocks) {
      st.nextBlock = undefined;
      return;
    }
    if (!this.svc.validators.isTopValidator(account, v.num_top_validators)) return;
    if (v.reward_start_block > head_block) return;
    if (v.paused_until_block > 0 && v.paused_until_block > head_block) return;

    // set before the async work, as upstream does
    st.nextBlock = this.nextAfter(head_block, pf.interval_blocks);
    const state = st;
    const p = this.send(account, head_block, state).finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  private async send(account: string, head_block: number, st: AccountState): Promise<void> {
    try {
      const result = await getTokenPriceInUSD({
        token: SPS_TOKEN,
        feeds: this.feeds,
        engine: this.engine,
        random: this.random,
        wait: this.wait,
        onFeedError: (feed, err) => this.emit({ status: "warning", msg: "price feed source failed", fields: { account, feed, error: err instanceof Error ? err.message : String(err) } }),
      });
      this.broadcaster.send({ account, action: "price_feed", params: { updates: [{ token: SPS_TOKEN, price: result.price }], metadata: result.metadata }, context: { head_block, next_block: st.nextBlock } });
    } catch (err) {
      st.nextBlock = undefined;
      this.emit({ status: "error", msg: "price feed failed", fields: { account, head_block, error: err instanceof Error ? err.message : String(err) } });
    }
  }
}
