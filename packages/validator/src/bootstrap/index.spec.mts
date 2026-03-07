import { describe, it, expect } from "vitest";
import { bootstrap } from "./index.mjs";
import { StateStore } from "../state/index.mjs";

const SEED_PATH = new URL("../__fixtures__/seed-minimal.json", import.meta.url)
  .pathname;

describe("bootstrap", () => {
  it("loads minimal seed fixture and populates state", async () => {
    const state = new StateStore();
    const result = await bootstrap(state, SEED_PATH);

    expect(result).toBeDefined();
    expect(result.startBlock).toBeDefined();
    expect(result.prevL2Hash).toBeDefined();
  });

  it("returns correct startBlock (seed.block_num + 1)", async () => {
    const state = new StateStore();
    const result = await bootstrap(state, SEED_PATH);

    // seed-minimal.json has block_num: 100000
    expect(result.startBlock).toBe(100001);
  });

  it("returns prevL2Hash from seed", async () => {
    const state = new StateStore();
    const result = await bootstrap(state, SEED_PATH);

    expect(result.prevL2Hash).toBe(
      "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
    );
  });

  it("returns knownHashes map", async () => {
    const state = new StateStore();
    const result = await bootstrap(state, SEED_PATH);

    expect(result.knownHashes).toBeInstanceOf(Map);
    expect(result.knownHashes.size).toBe(1);
    expect(result.knownHashes.get(100050)).toBe("known_hash_at_100050");
  });

  it("populates balances store", async () => {
    const state = new StateStore();
    await bootstrap(state, SEED_PATH);

    expect(state.balances.get("alice", "SPS")).toBe(1000);
    expect(state.balances.get("bob", "SPS")).toBe(2000);
    expect(state.balances.get("$NULL", "SPS")).toBe(50);
  });

  it("populates validators store", async () => {
    const state = new StateStore();
    await bootstrap(state, SEED_PATH);

    const v1 = state.validators.get("validator1");
    expect(v1).toBeDefined();
    expect(v1!.is_active).toBe(true);
    expect(v1!.total_votes).toBe(5000);

    const v2 = state.validators.get("validator2");
    expect(v2).toBeDefined();
    expect(v2!.is_active).toBe(true);
    expect(v2!.total_votes).toBe(3000);
  });

  it("populates config store", async () => {
    const state = new StateStore();
    await bootstrap(state, SEED_PATH);

    expect(state.config.getNumber("validator", "min_validators", 0)).toBe(2);
    expect(state.config.getString("validator", "reward_token", "")).toBe("SPS");
  });

  it("populates delegations store", async () => {
    const state = new StateStore();
    await bootstrap(state, SEED_PATH);

    const delegations = state.delegations.getByDelegator("alice");
    expect(delegations.length).toBe(1);
    expect(delegations[0].delegatee).toBe("bob");
    expect(delegations[0].amount).toBe(100);
  });
});
