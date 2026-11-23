// Not in upstream: upstream's virtual router knows exactly five transition actions
// (apps/sps-validator/src/sps/actions/index.ts); any other name is not routed and creates no action.
import { beforeEach, expect, test } from "vitest";
import { Fixture } from "../../__tests__/fixture.mjs";
import { TRANSITION_POINTS } from "../../repos/transitions.mjs";

const fixture = new Fixture();

beforeEach(() => {
  fixture.restore();
  fixture.testHelper.insertDefaultConfiguration();
  fixture.load();
});

test.each([
  "transition_fix_multi_undelegate_crash",
  "transition_bad_block_96950550",
  "transition_unknown",
])("%s is not routed", (name) => {
  const block_num = TRANSITION_POINTS.fix_multi_undelegate_crash;
  expect(
    fixture.opsHelper.processVirtualOp(
      name,
      "$TRANSITIONS",
      { block_num },
      { block_num },
    ),
  ).toHaveLength(0);
});

test("the five ported transitions are routed at their transition points", () => {
  const routed = [
    ["transition_fix_vote_weight", TRANSITION_POINTS.fix_vote_weight],
    [
      "transition_cleanup_lite_accounts",
      TRANSITION_POINTS.validator_transition_cleanup,
    ],
    [
      "transition_balance_token_staking_spsp",
      TRANSITION_POINTS.validator_transition_cleanup,
    ],
    [
      "transition_adjust_token_distribution_strategy",
      TRANSITION_POINTS.adjust_token_distribution_strategy,
    ],
    [
      "transition_cancel_delegation_promises",
      TRANSITION_POINTS.delegation_offer_block,
    ],
  ] as const;
  for (const [name, block_num] of routed) {
    fixture.restore();
    fixture.testHelper.insertDefaultConfiguration();
    fixture.load();
    const actions = fixture.opsHelper.processVirtualOp(
      name,
      "$TRANSITIONS",
      { block_num },
      { block_num },
    );
    expect(actions, name).toHaveLength(1);
    expect(actions[0].success, name).toBe(true);
  }
});
