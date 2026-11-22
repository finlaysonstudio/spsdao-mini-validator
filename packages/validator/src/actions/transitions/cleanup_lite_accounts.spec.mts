// Port of upstream apps/sps-validator/src/sps/actions/transitions/cleanup_lite_accounts.test.ts
import { beforeEach, expect, test } from "vitest";
import { Fixture, emoji_payload, garbage_payload } from "../../__tests__/fixture.mjs";
import { TOKENS } from "../../repos/context.mjs";

const supportAccount = "sl-cs-lite"; // CleanupLiteAccountsTransitionAction.SUPPORT_ACCOUNT
const liteAccounts = [
  { account: "some_account1231", spsp: 10204, sps: 0 },
  { account: "neophyte_5622", spsp: 0, sps: 12345 },
  { account: "lite_account2", spsp: 1245, sps: 523 },
  { account: "lite_account3", spsp: 0, sps: 0 },
];

const fixture = new Fixture();
const transitionPoints = fixture.transitionPoints;

beforeEach(() => {
  fixture.restore();
  fixture.testHelper.setHiveAccount(supportAccount);
  for (const account of liteAccounts) {
    fixture.testHelper.setHiveAccount(account.account);
    fixture.testHelper.setStaked(account.account, account.spsp);
    fixture.testHelper.setLiquidSPSBalance(account.account, account.sps);
  }
  fixture.load();
});

test("Garbage data for transition_cleanup_lite_accounts does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_cleanup_lite_accounts", "steemmonsters", garbage_payload)).not.toThrow();
});

test("Lots of emoji for transition_cleanup_lite_accounts does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_cleanup_lite_accounts", "steemmonsters", emoji_payload)).not.toThrow();
});

test("transition_cleanup_lite_accounts works on block num", () => {
  const [action] = fixture.opsHelper.processVirtualOp(
    "transition_cleanup_lite_accounts",
    "$TRANSITIONS",
    { block_num: transitionPoints.transition_points.validator_transition_cleanup },
    { block_num: transitionPoints.transition_points.validator_transition_cleanup },
  );
  expect((action as unknown as { success: boolean }).success).toBe(true);

  // Make sure all of the lite accounts have no sps or spsp
  for (const account of liteAccounts) {
    const sps = fixture.testHelper.getDummyToken(account.account, TOKENS.SPS);
    const spsp = fixture.testHelper.getDummyToken(account.account, TOKENS.SPSP);
    expect(sps?.balance ?? 0).toEqual(0);
    expect(spsp?.balance ?? 0).toEqual(0);
  }

  // Make sure the sl-cs-lite account has all the tokens
  const slCsLiteSps = fixture.testHelper.getDummyToken(supportAccount, TOKENS.SPS);
  const slCsLiteSpsp = fixture.testHelper.getDummyToken(supportAccount, TOKENS.SPSP);
  expect(slCsLiteSps?.balance ?? 0).toBeGreaterThan(0);
  // shouldnt have any spsp
  expect(slCsLiteSpsp?.balance ?? 0).toBe(0);

  // Not in upstream: the exact total, and the descending-collation processing order of the SQL.
  expect(slCsLiteSps!.balance).toBe(10204 + 12345 + 1245 + 523);
  const swept = (action as unknown as { result: { object_type: string; event_type: string; data: { player: string; type: string; amount: string } }[] }).result
    .filter((e) => e.object_type === "balance_history" && e.data.type === "token_transfer" && Number(e.data.amount) < 0)
    .map((e) => e.data.player);
  expect(swept).toEqual(["some_account1231", "neophyte_5622", "lite_account2"]);
});
