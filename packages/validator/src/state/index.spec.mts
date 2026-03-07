import { describe, it, expect } from "vitest";
import { StateStore, round3 } from "./index.mjs";
import { BalanceStore } from "./balances.mjs";
import { ValidatorStore } from "./validators.mjs";
import { DelegationStore } from "./delegations.mjs";
import { UnstakingStore } from "./unstaking.mjs";
import { PoolStore } from "./pools.mjs";
import { PromiseStore } from "./promises.mjs";
import { ConfigStore } from "./config.mjs";
import { BlockStore } from "./blocks.mjs";
import { CheckInStore } from "./checkIns.mjs";
import { PriceHistoryStore } from "./priceHistory.mjs";
import { HiveAccountStore } from "./hiveAccounts.mjs";

describe("StateStore", () => {
  it("has all 11 store properties", () => {
    const state = new StateStore();
    expect(state.balances).toBeDefined();
    expect(state.validators).toBeDefined();
    expect(state.delegations).toBeDefined();
    expect(state.unstaking).toBeDefined();
    expect(state.pools).toBeDefined();
    expect(state.promises).toBeDefined();
    expect(state.config).toBeDefined();
    expect(state.blocks).toBeDefined();
    expect(state.checkIns).toBeDefined();
    expect(state.priceHistory).toBeDefined();
    expect(state.hiveAccounts).toBeDefined();
  });

  it("stores are instances of their respective classes", () => {
    const state = new StateStore();
    expect(state.balances).toBeInstanceOf(BalanceStore);
    expect(state.validators).toBeInstanceOf(ValidatorStore);
    expect(state.delegations).toBeInstanceOf(DelegationStore);
    expect(state.unstaking).toBeInstanceOf(UnstakingStore);
    expect(state.pools).toBeInstanceOf(PoolStore);
    expect(state.promises).toBeInstanceOf(PromiseStore);
    expect(state.config).toBeInstanceOf(ConfigStore);
    expect(state.blocks).toBeInstanceOf(BlockStore);
    expect(state.checkIns).toBeInstanceOf(CheckInStore);
    expect(state.priceHistory).toBeInstanceOf(PriceHistoryStore);
    expect(state.hiveAccounts).toBeInstanceOf(HiveAccountStore);
  });

  it("re-exports round3", () => {
    expect(round3).toBeDefined();
    expect(typeof round3).toBe("function");
    expect(round3(1.2345)).toBe(1.235);
    expect(round3(1.0004)).toBe(1);
  });
});
