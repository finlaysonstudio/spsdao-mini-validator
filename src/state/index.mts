import { BalanceStore } from "./balances.mjs";
import { BlockStore } from "./blocks.mjs";
import { CheckInStore } from "./checkIns.mjs";
import { ConfigStore } from "./config.mjs";
import { DelegationStore } from "./delegations.mjs";
import { HiveAccountStore } from "./hiveAccounts.mjs";
import { PoolStore } from "./pools.mjs";
import { PriceHistoryStore } from "./priceHistory.mjs";
import { PromiseStore } from "./promises.mjs";
import { UnstakingStore } from "./unstaking.mjs";
import { ValidatorStore } from "./validators.mjs";

export class StateStore {
  balances = new BalanceStore();
  validators = new ValidatorStore();
  delegations = new DelegationStore();
  unstaking = new UnstakingStore();
  pools = new PoolStore();
  promises = new PromiseStore();
  config = new ConfigStore();
  blocks = new BlockStore();
  checkIns = new CheckInStore();
  priceHistory = new PriceHistoryStore();
  hiveAccounts = new HiveAccountStore();
}

export { round3 } from "./balances.mjs";
