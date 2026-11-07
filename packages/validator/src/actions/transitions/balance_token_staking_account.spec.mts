// Port of upstream apps/sps-validator/src/sps/actions/transitions/balance_token_staking_account.test.ts
import { beforeEach, expect, test } from "vitest";
import { Fixture, emoji_payload, garbage_payload } from "../../__tests__/fixture.mjs";
import { TOKENS } from "../../repos/context.mjs";

const spsFromAccount = "sl-cs-admin"; // BalanceTokenStakingAccountTransitionAction.SPS_FROM_ACCOUNT
const testAccounts = [
  { account: "abcdef", spsp: 10204, sps: 0 },
  { account: "abcdef1", spsp: 3423, sps: 12345 },
  { account: "abcdef2", spsp: 1235, sps: 523 },
  { account: "abcdef3", spsp: 7777, sps: 0 },
];
const difference = 1257;
testAccounts.push({ account: spsFromAccount, sps: difference, spsp: 0 });
const stakingAccountBalance = testAccounts.reduce((acc, cur) => acc + cur.spsp, 0) - difference;
testAccounts.push({ account: "$TOKEN_STAKING", spsp: -stakingAccountBalance, sps: stakingAccountBalance });

const fixture = new Fixture();
const transitionPoints = fixture.transitionPoints;

beforeEach(() => {
  fixture.restore();
  for (const account of testAccounts) {
    fixture.testHelper.setHiveAccount(account.account);
    fixture.testHelper.setStaked(account.account, account.spsp);
    fixture.testHelper.setLiquidSPSBalance(account.account, account.sps);
  }
  fixture.load();
});

test("Garbage data for transition_balance_token_staking_spsp does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_balance_token_staking_spsp", "steemmonsters", garbage_payload)).not.toThrow();
});

test("Lots of emoji for transition_balance_token_staking_spsp does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_balance_token_staking_spsp", "steemmonsters", emoji_payload)).not.toThrow();
});

test("transition_balance_token_staking_spsp works on block num", () => {
  fixture.opsHelper.processVirtualOp(
    "transition_balance_token_staking_spsp",
    "$TRANSITIONS",
    { block_num: transitionPoints.transition_points.validator_transition_cleanup },
    { block_num: transitionPoints.transition_points.validator_transition_cleanup },
  );

  // make sure the from account has zero balance now
  const fromAccount = fixture.testHelper.getDummyToken(spsFromAccount, TOKENS.SPS);
  expect(fromAccount).toBeDefined();
  expect(fromAccount!.balance).toBe(0);

  // make sure the token staking account balances spsp to players spsp
  let players = 0;
  for (const r of fixture.state.balances.rows()) if (r.token === "SPSP" && !r.player.startsWith("$") && r.player !== "null") players += Number(r.balance);
  expect(players + Number(fixture.state.balances.getScaled("$TOKEN_STAKING", "SPSP"))).toBe(0);

  // make sure the staking account spsp/sps balance.
  const stakingAccountSpsp = fixture.testHelper.getDummyToken("$TOKEN_STAKING", TOKENS.SPSP);
  const stakingAccountSps = fixture.testHelper.getDummyToken("$TOKEN_STAKING", TOKENS.SPS);
  expect(stakingAccountSpsp).toBeDefined();
  expect(stakingAccountSps).toBeDefined();
  expect(stakingAccountSps!.balance + stakingAccountSpsp!.balance).toBe(0);
});
