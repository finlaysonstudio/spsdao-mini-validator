/**
 * The validator shop: validator/src/libs/shop/{index,types}.ts (Shop) and
 * apps/sps-validator/src/sps/utilities/validator-shop.ts (ValidatorShop, which registers the sales
 * from config group `shop` every time that group changes).
 *
 * Schemas are copied verbatim (yup 0.32.11): `Shop.from` casts the config, and the cast output
 * (defaults, key order) feeds the sale hash and the transfers.
 */
import { sha256 } from "js-sha256";
import yup from "yup";
import { hiveUsernameOrSystemAccount } from "../schema.mjs";
import { EventLog } from "../types.mjs";
import { isSystemAccount } from "../util/accounts.mjs";
import { ErrorType, ValidationError } from "../util/errors.mjs";
import { warn } from "../util/log.mjs";
import type { ConfigLoader } from "./config.mjs";

const { array, boolean, date, mixed, number, object, string } = yup;

export const Supply = { LIMITED: "limited", UNLIMITED: "unlimited" } as const;
export type SupplyValue = (typeof Supply)[keyof typeof Supply];
export const ShopItemType = { TOKEN: "token" } as const;
export type ShopItemTypeValue =
  (typeof ShopItemType)[keyof typeof ShopItemType];

export type DistributionEntry = { account: string; fraction: number };
export type PriceEntry = {
  currency: string;
  amount: number;
  accepted_currency?: string;
  distribution?: DistributionEntry;
  distributions?: DistributionEntry[];
  discountable?: boolean;
};
export type DiscountEntry = {
  currency: string;
  max_amount: number;
  discount_rate: number;
};
export type ShopTokenConfig = {
  start_date: Date;
  price: PriceEntry[];
  discount?: DiscountEntry;
  supply: SupplyValue;
  type: "token";
  max: number;
  cooldown: number;
  requires_spellbook: boolean;
  balance_account: string;
  tranche_reserves?: number;
  bonus?: { currency: string; brackets: { min: number; ratio: number }[] };
  token: string;
  item_details_name: string;
};
export type ShopItem = ShopTokenConfig;
type Tranche = ShopItem[];

export type NormalizedSaleDiscount = { token: string; qty: number };
export type Sale = {
  id: string | symbol;
  qty: number;
  discount_token?: NormalizedSaleDiscount;
  bonus_token?: NormalizedSaleDiscount;
  hash?: string;
};
export type SaleTransfer = {
  from: string;
  to: string;
  token: string;
  amount: number;
};

/** Not a ValidationError: the action fails outside validation and the upstream node stops. */
export class ShopError extends Error {}
export class SaleError extends ValidationError {}

type Aid = { readonly id: string };

export interface Time {
  current(): Date | undefined;
}
export interface BalanceGetter {
  getBalance(account: string, token: string): number;
  getBalances(
    account: string,
  ): { player: string; token: string; balance: number }[];
}
export interface PriceConsumer {
  getPriceAtPoint(token: string, time: Date): number | undefined;
}

type BonusResult =
  | { type: "invalid" }
  | { type: "valid"; extra_qty: number; token_qty: number; token: string }
  | { type: "empty"; extra_qty: number; token_qty: number };
const Bonus = {
  Invalid: (): BonusResult => ({ type: "invalid" }),
  Valid: (
    extra_qty: number,
    token_qty: number,
    token: string,
  ): BonusResult => ({ type: "valid", extra_qty, token_qty, token }),
  Empty: (): BonusResult => ({ type: "empty", token_qty: 0, extra_qty: 0 }),
};

function isValidSystemAccount(value: string | undefined): boolean {
  return value === undefined || isSystemAccount(value);
}

const Defaults = {
  burnAccount: "$BURN",
  balanceAccount: "$SHOP",
  daoAccount: "sps.dao",
} as const;

const systemUsername = string()
  .test(
    "account_validation",
    "The following input is not a system account.",
    isValidSystemAccount,
  )
  .strict();

const distribution_schema = object({
  account: hiveUsernameOrSystemAccount.required().default(Defaults.daoAccount),
  fraction: number().min(0).max(1.0).required(),
});

const discount_schema = object({
  currency: string().strict().required(),
  max_amount: number().positive().required(),
  discount_rate: number().positive().required(),
}).unknown(true);

const price_schema = object({
  currency: string().strict().required(),
  amount: number().positive().required(),
  accepted_currency: string()
    .strict()
    .when("currency", {
      is: "USD",
      then: (schema) => schema.required(),
      otherwise: (schema) => schema.transform(() => undefined),
    }),
  burn: distribution_schema.optional().default(undefined),
  discountable: boolean().optional().default(false),
}).unknown(true);

const shop_schema = object({
  start_date: date()
    .required()
    .default(() => new Date(0)),
  requires_spellbook: boolean().required().default(true),
  price: array(price_schema).min(1).required(),
  discount: discount_schema.optional().default(undefined),
  supply: mixed<SupplyValue>()
    .oneOf(Object.values(Supply))
    .required()
    .default(Supply.UNLIMITED),
  balance_account: systemUsername.required().default(Defaults.balanceAccount),
  accepted_currency: string()
    .strict()
    .when("currency", {
      is: "USD",
      then: (schema) => schema.required(),
      otherwise: (schema) => schema.transform(() => undefined),
    }),
  type: mixed<ShopItemTypeValue>()
    .oneOf(Object.values(ShopItemType))
    .required(),
  tranche_reserves: number().min(0).optional(),
  cooldown: number().required().default(2),
  max: number().required().default(1),
}).unknown(true);

const token_schema = shop_schema.concat(
  object({
    item_details_name: string().required(),
    type: mixed<"token">().oneOf([ShopItemType.TOKEN]).required(),
    token: string().strict().required(),
  }),
);

const discriminator_schema = object({
  type: mixed<ShopItemTypeValue>()
    .oneOf(Object.values(ShopItemType))
    .required(),
});

export type TypeItem = { element: string; token: string; amount: number };

export class Shop {
  private readonly tokenSales = new Map<
    string | symbol,
    ShopTokenConfig | Tranche
  >();

  constructor(
    private readonly time: Time,
    private readonly balanceGetter: BalanceGetter,
    private readonly consumer: PriceConsumer,
  ) {}

  clear(): void {
    this.tokenSales.clear();
  }

  static from(v: unknown): ShopTokenConfig {
    if (discriminator_schema.isValidSync(v)) {
      switch ((v as { type: string }).type) {
        case ShopItemType.TOKEN:
          return token_schema.validateSync(
            token_schema.cast(v),
          ) as unknown as ShopTokenConfig;
      }
    }
    throw new ShopError(
      `Unknown shop configuration object at runtime. (Currently only tokens are supported).`,
    );
  }

  private static basicMatches(item1: ShopItem, item2: ShopItem): boolean {
    return (
      item1.balance_account === item2.balance_account &&
      item1.requires_spellbook === item2.requires_spellbook
    );
  }

  private static tokenMatches(
    token: ShopTokenConfig,
    shopItem: ShopItem,
  ): boolean {
    return (
      this.basicMatches(token, shopItem) &&
      shopItem.type === ShopItemType.TOKEN &&
      token.token === shopItem.token
    );
  }

  private static everyTokenMatches(
    token: ShopTokenConfig,
    shopItems: ShopItem[],
  ): boolean {
    return shopItems.every((v) => this.tokenMatches(token, v));
  }

  private static everyTrancheIncreases(shopItems: ShopItem[]): boolean {
    return shopItems.every((v, i, a) => {
      if (!i) return true;
      const prev = a[i - 1].tranche_reserves;
      if (prev === undefined) return false;
      if (v.tranche_reserves === undefined) return true;
      return prev >= v.tranche_reserves;
    });
  }

  private getCurrentTrancheWithConditionalMax(
    values: ShopTokenConfig | Tranche,
  ): [ShopTokenConfig, number | undefined] {
    if (Array.isArray(values)) {
      if (values.length < 2)
        throw new ShopError(`Tranche sale is not correctly registered`);
      const marker = values[0];
      const balanceTotal = this.balanceGetter.getBalance(
        marker.balance_account,
        marker.token,
      );
      let tranche = values.find(
        (p) => p.tranche_reserves && balanceTotal > p.tranche_reserves,
      );
      if (!tranche) tranche = values[values.length - 1];
      if (tranche.supply === Supply.UNLIMITED) return [tranche, undefined];
      const remaining = balanceTotal - (tranche.tranche_reserves || 0);
      return [tranche, remaining];
    }
    if (values.supply === Supply.UNLIMITED) return [values, undefined];
    const remaining = this.balanceGetter.getBalance(
      values.balance_account,
      values.token,
    );
    return [values, remaining];
  }

  registerSale(
    id: string | symbol,
    config0: ShopItem,
    ...restTranchesConfig: ShopItem[]
  ): void {
    if (this.tokenSales.has(id))
      throw new ShopError(
        `A sale with key [${String(id)}] has already been registered.`,
      );
    if (restTranchesConfig.length) {
      const allButLastFinite =
        config0.supply === Supply.LIMITED &&
        restTranchesConfig
          .slice(0, -1)
          .every((v) => v.supply === Supply.LIMITED);
      if (!allButLastFinite)
        throw new ShopError("Not all earlier tranches have a limited supply.");
      const all = [config0, ...restTranchesConfig];
      if (!Shop.everyTrancheIncreases(all))
        throw new ShopError("Tranches are not correctly ordered.");
      if (config0.type === ShopItemType.TOKEN) {
        if (Shop.everyTokenMatches(config0, restTranchesConfig))
          this.tokenSales.set(id, [config0, ...restTranchesConfig]);
        else throw new ShopError("Not all shopitems in tranch seem to match");
      }
    } else if (config0.type === ShopItemType.TOKEN) {
      this.tokenSales.set(id, config0);
    }
    if (!this.tokenSales.has(id))
      throw new ShopError(
        `No sale with key [${String(id)}] seems to have been registered.`,
      );
  }

  hasEntry(id: string | symbol): boolean {
    return this.tokenSales.has(id);
  }

  private convertCurrency(token: string, amount: number, time: Date): number {
    // PriceFeedError is swallowed upstream; the median calculator only throws it on no entries,
    // which getPriceAtPoint never passes it.
    const pricepoint = this.consumer.getPriceAtPoint(token, time);
    if (!pricepoint || pricepoint <= 0)
      throw new ShopError(
        `Shop did not find a valid price for token ${token} at time ${time}.`,
      );
    return amount / pricepoint;
  }

  private normalizePriceEntry(
    entry: PriceEntry,
    time: Date,
    saleQty: number,
  ): PriceEntry {
    if (entry.currency !== "USD")
      return { ...entry, amount: saleQty * entry.amount };
    if (entry.currency === "USD" && entry.accepted_currency) {
      return {
        ...entry,
        currency: entry.accepted_currency,
        amount:
          saleQty *
          this.convertCurrency(entry.accepted_currency, entry.amount, time),
      };
    }
    throw new ShopError(
      `Shop cannot process a sale that has solely USD listed as currency.`,
    );
  }

  private static summarizeCosts(
    final: PriceEntry[],
    discount?: NormalizedSaleDiscount,
  ): Map<string, number> {
    const m = new Map<string, number>();
    if (discount) m.set(discount.token, discount.qty);
    for (const p of final)
      m.set(p.currency, (m.get(p.currency) ?? 0) + p.amount);
    return m;
  }

  private applyDiscount(
    claimedDiscount: NormalizedSaleDiscount | undefined,
    item: ShopItem,
    aid: Aid,
    saleQty: number,
  ): PriceEntry[] {
    const providedDiscount = item.discount;
    if (!claimedDiscount) return item.price;
    if (
      !providedDiscount ||
      providedDiscount.currency !== claimedDiscount.token ||
      providedDiscount.max_amount * saleQty < claimedDiscount.qty
    ) {
      throw new SaleError(
        `Claimed discount does not apply to provided discount options.`,
        aid.id,
        ErrorType.SaleDiscountMismatch,
      );
    }
    const nprices: PriceEntry[] = [];
    const discount = claimedDiscount.qty * providedDiscount.discount_rate;
    const discountPerUnit = discount / saleQty;
    for (const entry of item.price) {
      if (entry.currency === "USD" || entry.discountable)
        nprices.push({
          ...entry,
          amount: Math.max(entry.amount - discountPerUnit, 0),
        });
      else nprices.push(entry);
    }
    return nprices;
  }

  private static itemHash(item: ShopItem): string {
    return sha256(`${item.type}.${item.token}.${JSON.stringify(item.price)}`);
  }

  private static applyBonus(
    sale: Sale,
    shopItem: ShopTokenConfig,
  ): BonusResult {
    if (sale.bonus_token === undefined) return Bonus.Empty();
    if (shopItem.bonus === undefined) return Bonus.Invalid();
    if (sale.bonus_token.token !== shopItem.bonus.currency)
      return Bonus.Invalid();
    const bracket = shopItem.bonus.brackets.reduce(
      (prev, cur) => {
        if (prev.min > cur.min) return prev;
        if (cur.min > sale.qty) return prev;
        return cur;
      },
      { min: 0, ratio: 0 },
    );
    const max_bonus = bracket.ratio * sale.qty;
    return max_bonus >= sale.bonus_token.qty
      ? Bonus.Valid(
          sale.bonus_token.qty,
          sale.bonus_token.qty,
          sale.bonus_token.token,
        )
      : Bonus.Invalid();
  }

  /** Shop.precalculateSale: the validated transfers and the `sale_report` event. */
  precalculateSale(
    player: string,
    sale: Sale,
    aid: Aid,
  ): { result: SaleTransfer[]; report: EventLog<{ type_items: TypeItem[] }> } {
    const matchingShopItem = this.tokenSales.get(sale.id);
    if (!matchingShopItem)
      throw new SaleError(
        `Sale [${String(sale.id)}] does not seem to exist`,
        aid.id,
        ErrorType.NoSuchSale,
      );

    const [item, remaining] =
      this.getCurrentTrancheWithConditionalMax(matchingShopItem);

    if (sale.hash) {
      const hash = Shop.itemHash(item);
      if (sale.hash !== hash)
        throw new SaleError(
          `Sale [${String(sale.id)}] hash mismatch. Offer or tranche rolled over`,
          aid.id,
          ErrorType.SaleOfferMismatch,
        );
    }

    const { start_date, balance_account } = item;
    const now = this.time.current();
    if (now === undefined)
      throw new ShopError(
        `Shop had to process a sale before it processed a block.`,
      );
    if (now < start_date)
      throw new SaleError(
        `Sale [${String(sale.id)}] has not yet begun`,
        aid.id,
        ErrorType.SaleNotStarted,
      );

    const bonus = Shop.applyBonus(sale, item);
    if (bonus.type === "invalid")
      throw new SaleError(
        `Sale [${String(sale.id)}] invalid bonus`,
        aid.id,
        ErrorType.SaleOfferMismatch,
      );

    const total_qty = bonus.extra_qty + sale.qty;
    if (remaining !== undefined && total_qty > remaining) {
      throw new SaleError(
        `Sale [${String(sale.id)}] for [${total_qty}] cannot proceed: Only [${remaining}] left (in current tranche).`,
        aid.id,
        ErrorType.SaleOutOfStock,
      );
    }
    if (total_qty > item.max) {
      throw new SaleError(
        `Sale [${String(sale.id)}] for [${total_qty}] cannot proceed: Maximum of [${item.max}] per sale.`,
        aid.id,
        ErrorType.MaxPerSale,
      );
    }

    const claimedDiscount = sale.discount_token;
    const finalPrice: PriceEntry[] = [];
    const priceReports: TypeItem[] = [];
    for (const pe of this.applyDiscount(claimedDiscount, item, aid, sale.qty)) {
      const price = this.normalizePriceEntry(pe, now, sale.qty);
      finalPrice.push(price);
      priceReports.push(...priceReport(price));
    }
    if (bonus.type === "valid")
      finalPrice.push({ amount: bonus.token_qty, currency: bonus.token });

    const summary = Shop.summarizeCosts(finalPrice, claimedDiscount);
    const balances = this.balanceGetter.getBalances(player).reduce((m, x) => {
      m.set(x.token, (m.get(x.token) ?? 0) + x.balance);
      return m;
    }, new Map<string, number>());
    for (const [token, required] of summary) {
      const owned = balances.get(token) ?? 0;
      if (owned < required)
        throw new SaleError(
          `Insufficient balance in sale [${String(sale.id)}] for [${token}].`,
          aid.id,
          ErrorType.InsufficientBalance,
        );
    }

    const results: SaleTransfer[] = [];
    if (claimedDiscount)
      results.push({
        from: player,
        to: balance_account,
        token: claimedDiscount.token,
        amount: claimedDiscount.qty,
      });
    for (const price of finalPrice) {
      const d = price.distribution;
      const ds = price.distributions;
      if (d && ds) {
        throw new ShopError(
          `Sale [${String(sale.id)}] has both distribution and distributions: [${JSON.stringify(d)}] and [${JSON.stringify(ds)}}]`,
        );
      }
      if (d) {
        if (!isFinite(d.fraction))
          throw new ShopError(
            `Distribution fraction for sale [${String(sale.id)}] is not finite.`,
          );
        if (d.fraction >= 1.0) {
          results.push({
            from: player,
            to: d.account,
            token: price.currency,
            amount: price.amount,
          });
        } else if (d.fraction <= 0) {
          results.push({
            from: player,
            to: balance_account,
            token: price.currency,
            amount: price.amount,
          });
        } else {
          results.push({
            from: player,
            to: d.account,
            token: price.currency,
            amount: price.amount * d.fraction,
          });
          results.push({
            from: player,
            to: balance_account,
            token: price.currency,
            amount: price.amount - price.amount * d.fraction,
          });
        }
      } else if (ds) {
        const totalFraction = ds.reduce((acc, x) => acc + x.fraction, 0);
        if (totalFraction > 1)
          throw new ShopError(
            `Distribution fractions for sale [${String(sale.id)}] sum to more than 1.`,
          );
        for (const x of ds) {
          if (!isFinite(x.fraction))
            throw new ShopError(
              `Distribution fraction for sale [${String(sale.id)}] is not finite.`,
            );
          results.push({
            from: player,
            to: x.account,
            token: price.currency,
            amount: price.amount * x.fraction,
          });
        }
        if (totalFraction < 1)
          results.push({
            from: player,
            to: balance_account,
            token: price.currency,
            amount: price.amount - price.amount * totalFraction,
          });
      } else {
        results.push({
          from: player,
          to: balance_account,
          token: price.currency,
          amount: price.amount,
        });
      }
    }

    const purchaseReports: TypeItem[] = [];
    if (item.type === ShopItemType.TOKEN) {
      results.push({
        from: balance_account,
        to: player,
        token: item.token,
        amount: total_qty,
      });
      purchaseReports.push(...purchaseReport(item.token, total_qty));
    }

    const report = new EventLog("insert", "sale_report", {
      type_items: [
        ...discountReport(claimedDiscount),
        ...bonusReport(bonus),
        ...priceReports,
        ...purchaseReports,
      ],
    });
    return { result: results, report };
  }
}

function priceReport(p: PriceEntry): TypeItem[] {
  return [
    {
      element: "price",
      amount: p.amount,
      token: p.accepted_currency ?? p.currency,
    },
  ];
}

function discountReport(d: NormalizedSaleDiscount | undefined): TypeItem[] {
  return d ? [{ token: d.token, amount: d.qty, element: "discount" }] : [];
}

function bonusReport(b: BonusResult): TypeItem[] {
  return b.type === "valid"
    ? [{ element: "bonus", amount: b.token_qty, token: b.token }]
    : [];
}

function purchaseReport(token: string, amount: number): TypeItem[] {
  return [{ token, amount, element: "purchased" }];
}

const TRANCHE_KEYS = [
  "validator_tranch_0",
  "validator_tranch_1",
  "validator_tranch_2",
  "validator_tranch_3",
  "validator_tranch_4",
  "validator_tranch_5",
  "validator_tranch_6",
  "validator_tranch_7",
] as const;

/** ValidatorShop: (re)registers every sale from the `shop` config group whenever it changes. */
export class ValidatorShop extends Shop {
  constructor(
    private readonly config: ConfigLoader,
    time: Time,
    balanceGetter: BalanceGetter,
    consumer: PriceConsumer,
  ) {
    super(time, balanceGetter, consumer);
    config.onChange("shop", () => this.register(this.config.shop));
    this.register(config.shop);
  }

  private register(config?: Record<string, unknown>): void {
    this.clear();
    if (!config) return; // upstream logs "Could not correctly configure validator shop"
    const [presaleConfig, ...trancheConfigs] = TRANCHE_KEYS.map(
      (k) => config[k],
    );
    const presale = Shop.from(presaleConfig);
    const sales = trancheConfigs.map((c) => Shop.from(c));
    this.registerSale("validator_tranche_info", presale, ...sales);
    for (const c in config) {
      if ((TRANCHE_KEYS as readonly string[]).includes(c)) continue;
      try {
        this.registerSale(c, Shop.from(config[c]));
      } catch {
        warn(`Could not load configuration ${c} into the shop`);
      }
    }
  }
}
