// Port of upstream apps/sps-validator/src/sps/actions/transitions/fix_vote_weight.test.ts
import { beforeEach, expect, test } from "vitest";
import { Fixture, emoji_payload, garbage_payload } from "../../__tests__/fixture.mjs";

const fixture = new Fixture();
const transitionPoints = fixture.transitionPoints;

beforeEach(() => {
  fixture.restore();
  fixture.testHelper.insertDummyValidator("steemmonsters", true, 100);
  fixture.testHelper.insertDummyVote("voter", "steemmonsters", 100);
  fixture.testHelper.setStaked("voter", 50);
  fixture.load();
});

test("Garbage data for transition_fix_vote_weight does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_fix_vote_weight", "steemmonsters", garbage_payload)).not.toThrow();
});

test("Lots of emoji for transition_fix_vote_weight does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_fix_vote_weight", "steemmonsters", emoji_payload)).not.toThrow();
});

test("transition_fix_vote_weight works on block num", () => {
  fixture.opsHelper.processVirtualOp(
    "transition_fix_vote_weight",
    "$TRANSITIONS",
    { block_num: transitionPoints.transition_points.fix_vote_weight },
    { block_num: transitionPoints.transition_points.fix_vote_weight },
  );

  const [voteWeight] = fixture.testHelper.votesForValidator("steemmonsters");
  expect(voteWeight.vote_weight).toEqual(50);

  const validator = fixture.testHelper.validator("steemmonsters");
  expect(validator).toBeTruthy();
  expect(validator!.total_votes).toEqual(50);
});

// Not in upstream: the action is only supported from $TRANSITIONS at the transition block.
test("transition_fix_vote_weight is ignored off its transition block", () => {
  const actions = fixture.opsHelper.processVirtualOp(
    "transition_fix_vote_weight",
    "$TRANSITIONS",
    { block_num: transitionPoints.transition_points.fix_vote_weight + 1 },
    { block_num: transitionPoints.transition_points.fix_vote_weight + 1 },
  );
  expect(actions).toHaveLength(0);
  expect(fixture.testHelper.votesForValidator("steemmonsters")[0].vote_weight).toEqual(100);
});
