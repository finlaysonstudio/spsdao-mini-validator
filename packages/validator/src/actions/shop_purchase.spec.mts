// Port of upstream apps/sps-validator/src/sps/actions/tokens/shop_purchase.test.ts. Upstream registers
// HardcodedValidatorShop; here the same sales come from the `shop` config group, as on chain.
import { beforeEach, describe, expect, test } from "vitest";
import {
  Fixture,
  emoji_payload,
  garbage_payload,
} from "../__tests__/fixture.mjs";
import { hardcodedShopConfig } from "../__tests__/shop.mjs";
import { ErrorType, OperationError } from "../util/errors.mjs";

const fixture = new Fixture();

beforeEach(() => {
  fixture.restore();
  fixture.testHelper.insertBlock(1, new Date());
  for (const [name, value] of Object.entries(hardcodedShopConfig))
    fixture.testHelper.insertConfig(
      "shop",
      name,
      "object",
      JSON.stringify(value),
    );
  fixture.load();
});

/** lbc.update + priceFeed.addPriceEntry */
function setPrice(
  validator: string,
  token_price: number,
  block_time = new Date(),
): void {
  fixture.testHelper.insertBlock(1, block_time);
  fixture.svc.priceFeed.addRawPriceEntry({
    validator,
    token: "SPS",
    token_price,
    block_num: 1,
    block_time,
  });
}

test("Garbage data for token_award does not crash.", () => {
  expect(() =>
    fixture.opsHelper.processOp("shop_purchase", "hello", garbage_payload),
  ).not.toThrow();
});

test("Lots of emoji for token_award does not crash.", () => {
  expect(() =>
    fixture.opsHelper.processOp("shop_purchase", "hello", emoji_payload),
  ).not.toThrow();
});

test("Simple shop purchase", () => {
  const player = "someplayer";
  const shop = "$SHOP";
  fixture.testHelper.setHiveAccount(player);
  const initialSystemBalance = { SPS: 0, LICENSE: 100 };
  const initialPlayerBalance = { SPS: 10000000, LICENSE: 0 };
  fixture.testHelper.setDummyToken(
    shop,
    initialSystemBalance.LICENSE,
    "LICENSE",
  );
  fixture.testHelper.setDummyToken(player, initialPlayerBalance.SPS, "SPS");
  setPrice("someValidator", 1);

  fixture.opsHelper.processOp("shop_purchase", player, {
    id: "validator_tranche_info",
    qty: 5,
  });

  expect(fixture.testHelper.getDummyToken(player, "LICENSE")?.balance).toBe(5);
  expect(fixture.testHelper.getDummyToken(shop, "LICENSE")?.balance).toBe(95);
  expect(fixture.testHelper.getDummyToken(player, "SPS")?.balance).toBe(
    initialPlayerBalance.SPS - 40000 * 5,
  );
  expect(fixture.testHelper.getDummyToken(shop, "SPS")?.balance).toBe(
    40000 * 5,
  );
});

test("Wrong discount shop purchase is ignored", () => {
  const player = "someplayer";
  const shop = "$SHOP";
  fixture.testHelper.setHiveAccount(player);
  const initialSystemBalance = { SPS: 0, LICENSE: 100 };
  const initialPlayerBalance = { SPS: 10000000, LICENSE: 0 };
  fixture.testHelper.setDummyToken(
    shop,
    initialSystemBalance.LICENSE,
    "LICENSE",
  );
  fixture.testHelper.setDummyToken(player, initialPlayerBalance.SPS, "SPS");
  setPrice("someValidator", 1);

  fixture.opsHelper.processOp("shop_purchase", player, {
    id: "validator_tranche_info",
    qty: 5,
    discount_token: { token: "SOME_RANDOM_FAKE_TOKEN", qty: 12 },
  });

  expect(fixture.testHelper.getDummyToken(player, "LICENSE")?.balance).toBe(
    undefined,
  );
  expect(fixture.testHelper.getDummyToken(shop, "LICENSE")?.balance).toBe(100);
  expect(fixture.testHelper.getDummyToken(player, "SPS")?.balance).toBe(
    initialPlayerBalance.SPS,
  );
  expect(fixture.testHelper.getDummyToken(shop, "SPS")?.balance).toBe(
    undefined,
  );
});

test.skip("shop purchase is properly discounted - VOUCHERS REMOVED", () => {
  // skipped upstream
});

test.skip("shop purchase applies bonus - VOUCHERS REMOVED", () => {
  // skipped upstream
});

// Not in upstream: results against the tranche state on chain ($SHOP holds 54992 LICENSE).
describe("shop_purchase results", () => {
  const player = "someplayer";

  beforeEach(() => {
    fixture.testHelper.setHiveAccount(player);
    fixture.testHelper.setDummyToken("$SHOP", 54992, "LICENSE");
    fixture.testHelper.setDummyToken(player, 2_000_000, "SPS");
  });

  test("buys from the current tranche at the median SPS price and reports the sale", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    setPrice("v1", 0.0066, now);
    fixture.svc.priceFeed.addRawPriceEntry({
      validator: "v2",
      token: "SPS",
      token_price: 0.0064,
      block_num: 1,
      block_time: now,
    });
    const [action] = fixture.opsHelper.processOp(
      "shop_purchase",
      player,
      { id: "validator_tranche_info", qty: 1 },
      { transaction: "trx1", block_num: 2, block_time: now },
    );
    expect(action.success).toBe(true);
    const spent = 1 * (5000 / ((0.0064 + 0.0066) / 2)); // tranche 2: 5000 USD in SPS
    const events = JSON.parse(JSON.stringify(action.result));
    expect(events.map((e: { object_type: string }) => e.object_type)).toEqual([
      "balances",
      "balances",
      "balance_history",
      "balance_history",
      "balances",
      "balances",
      "balance_history",
      "balance_history",
      "sale_report",
    ]);
    expect(events[2].data).toMatchObject({
      player,
      token: "SPS",
      amount: String(spent * -1),
      type: "shop_purchase",
      counterparty: "$SHOP",
    });
    expect(events[4].data).toEqual({
      player: "$SHOP",
      token: "LICENSE",
      balance: "54991.000",
    });
    expect(events[8]).toEqual({
      object_type: "sale_report",
      event_type: "insert",
      data: {
        type_items: [
          { element: "price", amount: spent, token: "SPS" },
          { token: "LICENSE", amount: 1, element: "purchased" },
        ],
      },
    });
  });

  test("validation failures carry the sale error codes", () => {
    setPrice("v1", 0.0066);
    const code = (params: unknown, account = player) =>
      fixture.opsHelper.processOp("shop_purchase", account, params)[0].error
        ?.code;
    expect(code({ id: "nothing", qty: 1 })).toBe(ErrorType.NoSuchSale);
    expect(code({ id: "validator_tranche_info", qty: 1, hash: "x" })).toBe(
      ErrorType.SaleOfferMismatch,
    );
    expect(code({ id: "validator_tranche_info", qty: 4993 })).toBe(
      ErrorType.SaleOutOfStock,
    );
    expect(code({ id: "validator_tranche_info", qty: 501 })).toBe(
      ErrorType.MaxPerSale,
    );
    expect(code({ id: "validator_tranche_info", qty: 3 })).toBe(
      ErrorType.InsufficientBalance,
    );
    expect(
      code({
        id: "validator_tranche_info",
        qty: 1,
        bonus_token: { token: "VOUCHER", qty: 1 },
      }),
    ).toBe(ErrorType.SaleOfferMismatch);
  });

  test("the hash of the current tranche (yup cast key order) is accepted", async () => {
    setPrice("v1", 0.0066);
    const { sha256 } = await import("js-sha256");
    const hash = sha256(
      `token.LICENSE.${JSON.stringify([{ discountable: false, currency: "USD", accepted_currency: "SPS", amount: 5000 }])}`,
    );
    const [action] = fixture.opsHelper.processOp("shop_purchase", player, {
      id: "validator_tranche_info",
      qty: 1,
      hash,
    });
    expect(action.success).toBe(true);
  });

  test("no price stops processing, as upstream's ShopError does", () => {
    let err: unknown;
    try {
      fixture.opsHelper.processOp(
        "shop_purchase",
        player,
        { id: "validator_tranche_info", qty: 1 },
        { transaction: "trx9", block_num: 7 },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OperationError);
    expect((err as OperationError).unsupported).toBe(false);
    expect((err as OperationError).context).toEqual({
      block_num: 7,
      trx_id: "trx9",
      action: "shop_purchase",
      account: player,
    });
    expect((err as OperationError).message).toMatch(
      /^operation failed shop_purchase \(trx9\) by someplayer at block 7: Shop did not find a valid price for token SPS/,
    );
  });
});
