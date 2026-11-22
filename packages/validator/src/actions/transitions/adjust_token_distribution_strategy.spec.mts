// Port of upstream apps/sps-validator/src/sps/actions/transitions/adjust_token_distribution_strategy.test.ts
import { beforeEach, expect, test } from "vitest";
import { Fixture, emoji_payload, garbage_payload } from "../../__tests__/fixture.mjs";
import { TOKENS } from "../../repos/context.mjs";

const TRANSFERS = [
  ["$SPS_STAKING_REWARDS", 79_000_000],
  ["$REWARD_POOLS_LICENSE", 1_000_000],
  ["$REWARD_POOLS_MODERN", 50_000_000],
  ["$REWARD_POOLS_WILD", 50_000_000],
  ["$TOURNAMENTS_DISTRIBUTION", 20_000_000],
] as const;
const SPS_STAKING_CONFIG = { type: "per_block_capped", tokens_per_block: 5.32407, start_block: 56186000, unstaking_period: 4, unstaking_interval_seconds: 604800 };
const SPS_LICENSE_REWARDS_CONFIG = { type: "per_block_capped", tokens_per_block: 2.63888, start_block: 67857521 };
const SPS_BLOCK_VALIDATION_TOKENS_PER_BLOCK = 0.40509;
const BLOCK_VALIDATION_CONSEUTIVE_MISSED_BLOCKS_THRESHOLD = 5;

const fixture = new Fixture();
const transitionPoints = fixture.transitionPoints;

beforeEach(() => {
  fixture.restore();
  fixture.testHelper.insertDefaultConfiguration();
  fixture.load();
});

test("Garbage data for transition_adjust_token_distribution_strategy does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_adjust_token_distribution_strategy", "steemmonsters", garbage_payload)).not.toThrow();
});

test("Lots of emoji for transition_adjust_token_distribution_strategy does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_adjust_token_distribution_strategy", "steemmonsters", emoji_payload)).not.toThrow();
});

test("transition_adjust_token_distribution_strategy works on block num", () => {
  const uniswapBalanceBefore = fixture.testHelper.getDummyToken("$UNCLAIMED_UNISWAP_REWARDS", TOKENS.SPS)?.balance ?? 0;
  const uniswapExpectedDecrease = TRANSFERS.reduce((acc, [, amount]) => acc + amount, 0);
  const balancesBefore = TRANSFERS.map(([to, amount]) => ({ to, expectedIncrease: amount, balance: fixture.testHelper.getDummyToken(to, TOKENS.SPS)?.balance ?? 0 }));

  fixture.opsHelper.processVirtualOp(
    "transition_adjust_token_distribution_strategy",
    "$TRANSITIONS",
    { block_num: transitionPoints.transition_points.adjust_token_distribution_strategy },
    { block_num: transitionPoints.transition_points.adjust_token_distribution_strategy },
  );

  const uniswapBalanceAfter = fixture.testHelper.getDummyToken("$UNCLAIMED_UNISWAP_REWARDS", TOKENS.SPS)?.balance ?? 0;
  const balancesAfter = TRANSFERS.map(([to]) => ({ to, balance: fixture.testHelper.getDummyToken(to, TOKENS.SPS)?.balance ?? 0 }));
  expect(uniswapBalanceBefore - uniswapBalanceAfter).toBe(uniswapExpectedDecrease);
  for (const before of balancesBefore) {
    const after = balancesAfter.find((x) => x.to === before.to)!;
    expect(after.balance - before.balance).toBe(before.expectedIncrease);
  }

  expect(fixture.loader.pools?.["staking_rewards"]).toMatchObject(SPS_STAKING_CONFIG);
  expect(fixture.loader.pools?.["validator_rewards"]).toMatchObject(SPS_LICENSE_REWARDS_CONFIG);

  expect(fixture.loader.validator?.tokens_per_block).toBe(SPS_BLOCK_VALIDATION_TOKENS_PER_BLOCK);
  expect(fixture.loader.validator?.reward_version).toBe("per_block_capped");
  expect(fixture.loader.validator?.consecutive_missed_blocks_threshold).toBe(BLOCK_VALIDATION_CONSEUTIVE_MISSED_BLOCKS_THRESHOLD);
});
