import { beforeEach, describe, expect, it } from "vitest";
import { Fixture } from "../__tests__/fixture.mjs";
import type { BroadcastRequest, DutyEvent } from "./duties.mjs";
import { backOff, CoinGeckoExternalPriceFeed, CoinMarketCapExternalPriceFeed, configuredFeeds, DaoExternalPriceFeed, getTokenPriceInUSD, HiveEngine, PriceFeedDuty, type ExternalPriceFeed, type PriceFeedSettings } from "./price_feed.mjs";

const INTERVAL = 200; // DEFAULT_CONFIG.price_feed.interval_blocks
const H = 111_000_000;

const fx = new Fixture();
let sent: BroadcastRequest[];
let events: DutyEvent[];
const broadcaster = { mode: "shadow" as const, send: (r: BroadcastRequest) => void sent.push(r) };
const emit = (e: DutyEvent) => void events.push(e);
const noWait = async () => undefined;

const feed = (name: string, price: number | null | Error): ExternalPriceFeed => ({
  name,
  getTokenPriceInUSD: async () => {
    if (price instanceof Error) throw price;
    return price;
  },
});

/** A HiveEngine whose nodes answer with the given basePrice. */
function engineWith(basePrice: string | Error) {
  const fetchFn = (async () => {
    if (basePrice instanceof Error) throw basePrice;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [{ tokenPair: "SWAP.HIVE:SPS", basePrice }] }));
  }) as typeof fetch;
  return new HiveEngine(["https://he.example/rpc"], fetchFn);
}

function make({ feeds = [feed("dao", 0.0339421)], engine = engineWith("11.21778535"), accounts = ["alpha"] }: { feeds?: ExternalPriceFeed[]; engine?: HiveEngine; accounts?: string[] } = {}) {
  return new PriceFeedDuty({ svc: fx.svc, accounts, broadcaster, emit, feeds, engine, random: () => 0, wait: noWait });
}

async function run(duty: PriceFeedDuty, block: number, head = block) {
  duty.onBlock({ block_num: block, head_block: head });
  await duty.flush();
}

beforeEach(() => {
  fx.restore();
  fx.testHelper.insertDefaultConfiguration();
  fx.load();
  fx.testHelper.insertDummyValidator("alpha", true, 100);
  fx.testHelper.insertDummyValidator("beta", true, 50);
  sent = [];
  events = [];
});

describe("PriceFeedDuty", () => {
  it("a top validator with no recorded price sends one right away", async () => {
    const duty = make();
    await run(duty, H);
    expect(sent).toEqual([
      {
        account: "alpha",
        action: "price_feed",
        params: { updates: [{ token: "SPS", price: parseFloat((0.0339421 / 11.21778535).toFixed(7)) }], metadata: { hive_usd: 0.0339421, he_price: 11.21778535, external_feed: "dao" } },
        context: { head_block: H, next_block: H + INTERVAL },
      },
    ]);
  });

  it("waits interval + jitter blocks before the next one", async () => {
    const duty = make();
    await run(duty, H);
    for (let b = H + 1; b < H + INTERVAL; b++) await run(duty, b);
    expect(sent).toHaveLength(1);
    await run(duty, H + INTERVAL);
    expect(sent).toHaveLength(2);
  });

  it("resumes from the last recorded price (upstream prime)", async () => {
    fx.svc.priceHistory.upsert({ validator: "alpha", token: "SPS", block_num: H - 50, block_time: new Date(), token_price: 0.003 });
    const duty = make();
    await run(duty, H);
    expect(sent).toEqual([]);
    await run(duty, H - 50 + INTERVAL);
    expect(sent).toHaveLength(1);
  });

  it("sends nothing for an account outside the top validators", async () => {
    for (let i = 0; i < 10; i++) fx.testHelper.insertDummyValidator(`top${i}`, true, 1000 + i);
    const duty = make();
    await run(duty, H);
    expect(sent).toEqual([]);
  });

  it("sends nothing for an account without votes", async () => {
    fx.testHelper.insertDummyValidator("alpha", true, 0);
    const duty = make();
    await run(duty, H);
    expect(sent).toEqual([]);
  });

  it("sends nothing before validator rewards start", async () => {
    const duty = make();
    await run(duty, 60_000_000);
    expect(sent).toEqual([]);
  });

  it("sends nothing while catching up, then sends once caught up", async () => {
    const duty = make();
    await run(duty, H, H + INTERVAL + 1);
    expect(sent).toEqual([]);
    await run(duty, H + INTERVAL + 1);
    expect(sent).toHaveLength(1);
  });

  it("reports a failed lookup and retries on the next block", async () => {
    const duty = make({ feeds: [feed("dao", new Error("HTTP 503"))] });
    await run(duty, H);
    expect(sent).toEqual([]);
    expect(events.map((e) => e.msg)).toEqual(["price feed source failed", "price feed failed"]);
    const ok = make();
    await run(ok, H + 1);
    expect(sent).toHaveLength(1);
  });

  it("handles several accounts independently", async () => {
    const duty = make({ accounts: ["alpha", "beta"] });
    await run(duty, H);
    expect(sent.map((s) => s.account)).toEqual(["alpha", "beta"]);
  });
});

describe("getTokenPriceInUSD", () => {
  it("uses the first feed that answers, in random order", async () => {
    const asked: string[] = [];
    const tracked = (name: string, price: number | null) => ({ name, getTokenPriceInUSD: async () => (asked.push(name), price) });
    const r = await getTokenPriceInUSD({ token: "SPS", feeds: [tracked("a", 0.03), tracked("b", 0.04)], engine: engineWith("10"), random: () => 0.9, wait: noWait });
    expect(r.metadata.external_feed).toBe("a");
    expect(r.price).toBe(0.003);
    expect(asked).toEqual(["a"]);
  });

  it("moves past a feed that answers null or fails", async () => {
    const errors: string[] = [];
    const r = await getTokenPriceInUSD({ token: "SPS", feeds: [feed("a", null), feed("b", new Error("HTTP 500")), feed("c", 0.04)], engine: engineWith("10"), random: () => 0.9, wait: noWait, onFeedError: (f) => void errors.push(f) });
    expect(r.metadata.external_feed).toBe("c");
    expect(errors).toEqual(["a", "b"]);
  });

  it("fails when no feed answers", async () => {
    await expect(getTokenPriceInUSD({ token: "SPS", feeds: [feed("a", null), feed("b", new Error("down"))], engine: engineWith("10"), wait: noWait })).rejects.toThrow(/HIVE price/);
  });

  it("returns price 0 for a zero pool price", async () => {
    const r = await getTokenPriceInUSD({ token: "SPS", feeds: [feed("a", 0.03)], engine: engineWith("0"), wait: noWait });
    expect(r.price).toBe(0);
  });

  it("rejects a pool price that is not a number", async () => {
    await expect(getTokenPriceInUSD({ token: "SPS", feeds: [feed("a", 0.03)], engine: engineWith("n/a"), wait: noWait })).rejects.toThrow(/Hive Engine/);
  });
});

describe("backOff", () => {
  it("tries three times with 1 s then 2 s between attempts", async () => {
    const waits: number[] = [];
    let calls = 0;
    await expect(
      backOff(
        async () => {
          calls++;
          throw new Error("no");
        },
        { wait: async (ms) => void waits.push(ms) },
      ),
    ).rejects.toThrow("no");
    expect(calls).toBe(3);
    expect(waits).toEqual([1000, 2000]);
  });
});

describe("HiveEngine", () => {
  it("queries the marketpools pool and fails over to the next node", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchFn = (async (url: string, init: { body?: unknown }) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      if (calls.length === 1) return new Response("down", { status: 502 });
      return new Response(JSON.stringify({ result: [{ basePrice: "11.5" }] }));
    }) as unknown as typeof fetch;
    const he = new HiveEngine(["https://a.example/rpc/", "https://b.example"], fetchFn);
    expect(await he.getPoolBasePrice("SWAP.HIVE:SPS")).toBe("11.5");
    expect(calls.map((c) => c.url)).toEqual(["https://a.example/rpc/contracts", "https://b.example/contracts"]);
    expect(calls[0].body).toMatchObject({ method: "find", params: { contract: "marketpools", table: "pools", query: { tokenPair: { $in: ["SWAP.HIVE:SPS"] } } } });
  });
});

describe("external feeds", () => {
  const settings: PriceFeedSettings = {
    dao: { api_url: "https://prices.example/" },
    coinGecko: { api_url: "https://pro.cg.example", demo_api_url: "https://demo.cg.example", demo: false, api_key: "" },
    coinMarketCap: { api_url: "https://cmc.example", api_key: "", token_map: { HIVE: "5370" } },
  };

  it("registers only feeds whose settings are complete", () => {
    expect(configuredFeeds(settings).map((f) => f.name)).toEqual(["dao"]);
    const all = configuredFeeds({ ...settings, coinGecko: { ...settings.coinGecko, api_key: "cg" }, coinMarketCap: { ...settings.coinMarketCap, api_key: "cmc" } });
    expect(all.map((f) => f.name)).toEqual(["dao", "coingecko", "coinmarketcap"]);
  });

  it("calls each API as upstream does", async () => {
    const seen: { url: string; headers: unknown }[] = [];
    const reply = (body: unknown) =>
      (async (url: string, init?: { headers?: unknown }) => {
        seen.push({ url, headers: init?.headers ?? null });
        return new Response(JSON.stringify(body));
      }) as unknown as typeof fetch;
    expect(await new DaoExternalPriceFeed(settings.dao, reply({ price_usd: "0.034" })).getTokenPriceInUSD("HIVE")).toBe(0.034);
    // real CoinGecko replies under the lowercase id
    expect(await new CoinGeckoExternalPriceFeed({ ...settings.coinGecko, api_key: "cg" }, reply({ hive: { usd: 0.035 } })).getTokenPriceInUSD("HIVE")).toBe(0.035);
    expect(await new CoinGeckoExternalPriceFeed({ ...settings.coinGecko, api_key: "cg", demo: true }, reply({})).getTokenPriceInUSD("HIVE")).toBeNull();
    expect(await new CoinMarketCapExternalPriceFeed({ ...settings.coinMarketCap, api_key: "cmc" }, reply({ data: { "5370": { quote: { USD: { price: 0.036 } } } } })).getTokenPriceInUSD("HIVE")).toBe(0.036);
    expect(seen).toEqual([
      { url: "https://prices.example/api/prices/HIVE", headers: null },
      { url: "https://pro.cg.example/api/v3/simple/price?ids=HIVE&vs_currencies=USD", headers: { "x-cg-pro-api-key": "cg" } },
      { url: "https://demo.cg.example/api/v3/simple/price?ids=HIVE&vs_currencies=USD", headers: { "x-cg-demo-api-key": "cg" } },
      { url: "https://cmc.example/v2/cryptocurrency/quotes/latest?id=5370", headers: { "X-CMC_PRO_API_KEY": "cmc" } },
    ]);
  });
});
