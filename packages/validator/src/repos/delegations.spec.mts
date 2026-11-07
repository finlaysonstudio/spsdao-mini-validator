import { describe, expect, it } from "vitest";
import { Fixture, fakeAction } from "../__tests__/fixture.mjs";
import { SUPPORTED_TOKENS, TOKENS } from "./context.mjs";

/**
 * Block 106181211 (trx 915fd000...): a delegation_offer create_promise with qty
 * "10000.000" as a string. Upstream does `existing.amount + amount`, i.e.
 * 0 + "10000.000" = "010000.000", which Postgres stores as 10000.000.
 */
describe("ActiveDelegationsRepository with a string qty (upstream JS coercion)", () => {
  const setup = (existing: bigint | null) => {
    const fx = new Fixture();
    fx.testHelper.setDummyToken("janoshik", 800000, TOKENS.SPSP);
    fx.testHelper.setDummyToken("janoshik", 724347.729, TOKENS.SPSP_OUT);
    fx.testHelper.setDummyToken("$DELEGATION_PROMISES", 52220000, TOKENS.SPSP_IN);
    if (existing !== null) {
      fx.state.delegations.set({ token: TOKENS.SPSP, delegator: "janoshik", delegatee: "$DELEGATION_PROMISES", amount: existing, last_delegation_tx: "old", last_delegation_date: new Date(0), last_undelegation_date: new Date(0), last_undelegation_tx: "old" });
    }
    return fx;
  };
  const qty = "10000.000" as unknown as number;

  it("concatenates onto an existing zero delegation and Postgres parses the text", () => {
    const fx = setup(0n);
    const logs = fx.svc.delegations.delegate(fakeAction(106181211, "janoshik"), "janoshik", "$DELEGATION_PROMISES", SUPPORTED_TOKENS[TOKENS.SPSP], qty, true);
    expect(fx.state.delegations.get("janoshik", "$DELEGATION_PROMISES", TOKENS.SPSP)!.amount).toBe(10000000n);
    const data = logs.map((l) => l.data as unknown as Record<string, unknown>);
    expect(data[0].amount).toBe("10000.000");
    expect(fx.testHelper.getDummyToken("janoshik", TOKENS.SPSP_OUT)!.balance).toBe(734347.729);
    expect(fx.testHelper.getDummyToken("$DELEGATION_PROMISES", TOKENS.SPSP_IN)!.balance).toBe(52230000);
    const history = data.filter((d) => "balance_start" in d);
    expect(history.map((h) => h.amount)).toEqual(["-10000", "10000", "-10000", "10000"]);
  });

  it("inserts a new delegation from the string as-is", () => {
    const fx = setup(null);
    fx.svc.delegations.delegate(fakeAction(106181211, "janoshik"), "janoshik", "$DELEGATION_PROMISES", SUPPORTED_TOKENS[TOKENS.SPSP], qty, true);
    expect(fx.state.delegations.get("janoshik", "$DELEGATION_PROMISES", TOKENS.SPSP)!.amount).toBe(10000000n);
  });

  it("keeps upstream's concatenation bug for a nonzero integer delegation (500 + '10000.000' = 50010000)", () => {
    const fx = setup(500000n);
    fx.svc.delegations.delegate(fakeAction(106181211, "janoshik"), "janoshik", "$DELEGATION_PROMISES", SUPPORTED_TOKENS[TOKENS.SPSP], qty, true);
    expect(fx.state.delegations.get("janoshik", "$DELEGATION_PROMISES", TOKENS.SPSP)!.amount).toBe(50010000000n);
  });

  it("throws where Postgres would reject the concatenated text", () => {
    const fx = setup(500500n);
    expect(() => fx.svc.delegations.delegate(fakeAction(106181211, "janoshik"), "janoshik", "$DELEGATION_PROMISES", SUPPORTED_TOKENS[TOKENS.SPSP], qty, true)).toThrow(/invalid input syntax for type numeric: "500.510000.000"/);
  });
});
