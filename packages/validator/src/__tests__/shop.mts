/**
 * Upstream apps/sps-validator/src/__tests__/shop: the license tranche sale (license_tranches/*.json)
 * and the bonus sale (bonus.json) that HardcodedValidatorShop registers.
 */
const tranche = (
  amount: number,
  discount_rate: number,
  tranche_reserves: number,
) => ({
  start_date: "2022-05-25T16:00:00Z",
  price: [{ currency: "USD", amount, accepted_currency: "SPS" }],
  discount: { currency: "VOUCHER", max_amount: 500, discount_rate },
  supply: "limited",
  tranche_reserves,
  type: "token",
  token: "LICENSE",
  item_details_name: "Validator License",
  max: 500,
});

export const presale = {
  start_date: "2022-05-25T16:00:00Z",
  price: [
    { currency: "USD", amount: 1000, accepted_currency: "SPS" },
    { currency: "VOUCHER", amount: 500 },
  ],
  supply: "limited",
  tranche_reserves: 58000,
  type: "token",
  token: "LICENSE",
  item_details_name: "Validator License",
  max: 1,
};
export const tranche1 = tranche(3000, 3, 55000);
export const tranche2 = tranche(5000, 5, 50000);
export const tranche3 = tranche(7500, 7.5, 40000);
export const tranche4 = tranche(10000, 10, 30000);
export const tranche5 = tranche(15000, 15, 20000);
export const tranche6 = tranche(20000, 20, 10000);
export const tranche7 = tranche(40000, 40, 0);
export const tranches = [
  tranche1,
  tranche2,
  tranche3,
  tranche4,
  tranche5,
  tranche6,
  tranche7,
];

export const niceSale = {
  start_date: "2022-02-24T17:00:00Z",
  price: [{ currency: "SPS", amount: 1 }],
  bonus: { currency: "VOUCHER", brackets: [{ min: 0, ratio: 0.1 }] },
  token: "LICENSE",
  item_details_name: "License with Bonus",
  supply: "limited",
  type: "token",
  max: 1000000,
};

/** The `shop` config group HardcodedValidatorShop amounts to: the tranche sale plus `nice_sale`. */
export const hardcodedShopConfig: Record<string, unknown> = {
  validator_tranch_0: presale,
  ...Object.fromEntries(
    tranches.map((t, i) => [`validator_tranch_${i + 1}`, t]),
  ),
  nice_sale: niceSale,
};
