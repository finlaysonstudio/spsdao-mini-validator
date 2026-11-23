// Port of upstream apps/sps-validator/src/sps/shop.test.ts (the Shop library against the balances
// and the raw price feed).
import { beforeEach, expect, test } from "vitest";
import { Fixture } from "../__tests__/fixture.mjs";
import { presale, tranches } from "../__tests__/shop.mjs";
import { TOKENS } from "./context.mjs";
import { SaleError, Shop, ShopItemType, Supply } from "./shop.mjs";

class ShopFixture extends Fixture {
  shop!: Shop;

  override restore(): void {
    super.restore();
    const clock = {
      current: () => {
        const n = this.svc.blocks.getLatestBlockNum();
        return n === null
          ? undefined
          : this.svc.blocks.getByBlockNum(n)?.block_time;
      },
    };
    this.shop = new Shop(clock, this.svc.balances, this.svc.priceFeed);
  }

  /** lbc.update({ block_num: 1, block_time: new Date(), ... }) */
  lbcUpdate(block_time = new Date()): void {
    this.testHelper.insertBlock(1, block_time);
  }

  setTokenPrice(token: string, price: number, time: Date) {
    return this.svc.priceFeed.addRawPriceEntry({
      validator: "dummyvalidator",
      token,
      token_price: price,
      block_num: 1,
      block_time: time,
    });
  }

  registerLicenseSale(id: string | symbol, startingBalance = 60000): void {
    const presale_ = Shop.from(presale);
    const tranches_ = tranches.map((t) => Shop.from(t));
    this.shop.registerSale(id, presale_, ...tranches_);
    this.testHelper.setDummyToken(
      presale_.balance_account,
      startingBalance,
      presale_.token,
    );
  }

  enrich(
    account: string,
    { sps_balance = 10000000 }: { sps_balance?: number } = {},
  ): void {
    this.testHelper.setDummyToken(account, sps_balance, TOKENS.SPS);
  }
}

const fixture = new ShopFixture();
const aid = { id: "some-id" };

beforeEach(() => {
  fixture.restore();
  fixture.load();
});

test("Fail on non-existent sale", () => {
  expect(() =>
    fixture.shop.precalculateSale("wordempire", { id: "hello", qty: 1 }, aid),
  ).toThrow(SaleError);
});

test("License tranche sale can be parsed", () => {
  const t = () => [presale, ...tranches].map((x) => Shop.from(x));
  expect(t).not.toThrowError();
});

test("License tranche sale can be registered", () => {
  const t = () => {
    const presale_ = Shop.from(presale);
    const tranches_ = tranches.map((x) => Shop.from(x));
    fixture.shop.registerSale("validator_tranche_info", presale_, ...tranches_);
  };
  expect(t).not.toThrowError();
});

test("Buy random sale", () => {
  const sale = Symbol.for("sale");
  fixture.shop.registerSale(
    sale,
    Shop.from({
      price: [
        {
          currency: "FOO",
          amount: 10,
          distribution: { account: "foo.dao", fraction: 0.75 },
        },
        { currency: "SPS", amount: 0.2 },
      ],
      supply: Supply.UNLIMITED,
      type: ShopItemType.TOKEN,
      token: "BAR",
      item_details_name: "takes FOO + SPS, gives BAR",
    }),
  );
  fixture.testHelper.setDummyToken("wordempire", 10, "FOO");
  fixture.testHelper.setLiquidSPSBalance("wordempire", 5);
  fixture.lbcUpdate();
  const { result: transfers } = fixture.shop.precalculateSale(
    "wordempire",
    { id: sale, qty: 1 },
    aid,
  );
  expect(transfers).toContainEqual({
    from: "$SHOP",
    to: "wordempire",
    token: "BAR",
    amount: 1,
  });
  expect(transfers).toContainEqual({
    from: "wordempire",
    to: "foo.dao",
    token: "FOO",
    amount: 7.5,
  });
});

test("Buy random sale with distribution array", () => {
  const sale = Symbol.for("sale");
  fixture.shop.registerSale(
    sale,
    Shop.from({
      price: [
        {
          currency: "FOO",
          amount: 10,
          distributions: [
            { account: "foo.dao", fraction: 0.5 },
            { account: "null", fraction: 0.35 },
          ],
        },
        { currency: "SPS", amount: 0.2 },
      ],
      supply: Supply.UNLIMITED,
      type: ShopItemType.TOKEN,
      token: "BAR",
      item_details_name: "takes FOO + SPS, gives BAR",
    }),
  );
  fixture.testHelper.setDummyToken("wordempire", 10, "FOO");
  fixture.testHelper.setLiquidSPSBalance("wordempire", 5);
  fixture.lbcUpdate();
  const { result: transfers } = fixture.shop.precalculateSale(
    "wordempire",
    { id: sale, qty: 1 },
    aid,
  );
  expect(transfers).toContainEqual({
    from: "$SHOP",
    to: "wordempire",
    token: "BAR",
    amount: 1,
  });
  expect(transfers).toContainEqual({
    from: "wordempire",
    to: "foo.dao",
    token: "FOO",
    amount: 5,
  });
  expect(transfers).toContainEqual({
    from: "wordempire",
    to: "null",
    token: "FOO",
    amount: 3.5,
  });
  expect(transfers).toContainEqual({
    from: "wordempire",
    to: "$SHOP",
    token: "FOO",
    amount: 1.5,
  });
});

test("Buy random sale with distribution array where totalFraction sums to 1", () => {
  const sale = Symbol.for("sale");
  fixture.shop.registerSale(
    sale,
    Shop.from({
      price: [
        {
          currency: "FOO",
          amount: 10,
          distributions: [
            { account: "foo.dao", fraction: 0.5 },
            { account: "null", fraction: 0.5 },
          ],
        },
        { currency: "SPS", amount: 0.2 },
      ],
      supply: Supply.UNLIMITED,
      type: ShopItemType.TOKEN,
      token: "BAR",
      item_details_name: "takes FOO + SPS, gives BAR",
    }),
  );
  fixture.testHelper.setDummyToken("wordempire", 10, "FOO");
  fixture.testHelper.setLiquidSPSBalance("wordempire", 5);
  fixture.lbcUpdate();
  const { result: transfers } = fixture.shop.precalculateSale(
    "wordempire",
    { id: sale, qty: 1 },
    aid,
  );
  expect(transfers).toContainEqual({
    from: "$SHOP",
    to: "wordempire",
    token: "BAR",
    amount: 1,
  });
  expect(transfers).toContainEqual({
    from: "wordempire",
    to: "foo.dao",
    token: "FOO",
    amount: 5,
  });
  expect(transfers).toContainEqual({
    from: "wordempire",
    to: "null",
    token: "FOO",
    amount: 5,
  });
});

test("Buy multiple of a random sale", () => {
  const sale = Symbol.for("sale");
  fixture.shop.registerSale(
    sale,
    Shop.from({
      price: [{ currency: "FOO", amount: 10 }],
      supply: Supply.UNLIMITED,
      type: ShopItemType.TOKEN,
      token: "BAR",
      item_details_name: "takes FOO, gives BAR",
      max: 10,
    }),
  );
  fixture.testHelper.setDummyToken("wordempire", 150, "FOO");
  fixture.lbcUpdate();
  const { result: transfers } = fixture.shop.precalculateSale(
    "wordempire",
    { id: sale, qty: 10 },
    aid,
  );
  expect(transfers).toContainEqual({
    from: "$SHOP",
    to: "wordempire",
    token: "BAR",
    amount: 10,
  });
  expect(transfers).toContainEqual({
    from: "wordempire",
    to: "$SHOP",
    token: "FOO",
    amount: 100,
  });
});

test.skip("Buy multiple of a random sale with discount - VOUCHERS REMOVED", () => {
  // skipped upstream
});

test("Buy bulk LICENSE presale is prohibited", () => {
  const sale = Symbol.for("sale");
  fixture.lbcUpdate();
  fixture.enrich("wordempire");
  fixture.setTokenPrice("SPS", 0.06721, new Date());
  fixture.registerLicenseSale(sale);
  expect(() =>
    fixture.shop.precalculateSale("wordempire", { id: sale, qty: 11 }, aid),
  ).toThrow(SaleError);
});

test("Buy bulk LICENSE random tranche is allowed", () => {
  const sale = Symbol.for("sale");
  fixture.lbcUpdate();
  fixture.enrich("wordempire");
  fixture.setTokenPrice("SPS", 0.06781, new Date());
  fixture.registerLicenseSale(sale, 10000);
  const { result: transfers } = fixture.shop.precalculateSale(
    "wordempire",
    { id: sale, qty: 11 },
    aid,
  );
  expect(transfers).toContainEqual({
    from: "$SHOP",
    to: "wordempire",
    token: "LICENSE",
    amount: 11,
  });
});

// Not in upstream: the cast item and the raw price feed cache.
test("Shop.from applies the schema defaults", () => {
  const item = Shop.from(tranches[1]);
  expect(item.balance_account).toBe("$SHOP");
  expect(item.requires_spellbook).toBe(true);
  expect(item.cooldown).toBe(2);
  expect(item.start_date).toEqual(new Date("2022-05-25T16:00:00Z"));
  expect(item.price).toEqual([
    {
      currency: "USD",
      amount: 5000,
      accepted_currency: "SPS",
      discountable: false,
    },
  ]);
});

test("the price is the median of the price entries newer than a month before the fill", () => {
  const now = new Date("2026-03-31T12:00:00Z");
  fixture.testHelper.insertBlock(1, now);
  const add = (validator: string, token_price: number, block_time: Date) =>
    fixture.svc.priceFeed.addRawPriceEntry({
      validator,
      token: "SPS",
      token_price,
      block_num: 1,
      block_time,
    });
  add("a", 0.01, now);
  add("b", 0.03, now);
  add("c", 0.5, new Date("2026-03-01T00:00:00Z")); // 2026-02-31 rolls over to 2026-03-03: excluded
  expect(fixture.svc.priceFeed.getPriceAtPoint("SPS", now)).toBe(0.02);
  add("d", 0.05, new Date("2026-03-04T00:00:00Z"));
  expect(fixture.svc.priceFeed.getPriceAtPoint("SPS", now)).toBe(0.03);
  expect(fixture.svc.priceFeed.getPriceAtPoint("FOO", now)).toBeUndefined();
});
