// Port of upstream apps/sps-validator/src/sps/actions/pools/pool.test.ts (add_pool, update_pool,
// disable_pool, claim_pool), plus event shapes, the claim source and the missing-row stop.
import { beforeEach, describe, expect, test } from "vitest";
import {
  Fixture,
  emoji_payload,
  garbage_payload,
} from "../__tests__/fixture.mjs";
import type { BlockRef } from "../types.mjs";
import { ErrorType, OperationError } from "../util/errors.mjs";

const fixture = new Fixture();

beforeEach(() => {
  fixture.restore();
  fixture.testHelper.insertDefaultConfiguration();
  fixture.testHelper.insertConfig(
    "sps",
    "inflation_pools",
    "array",
    JSON.stringify([]),
  );
  fixture.load();
});

const approximate_day = 24 * 3600 * 1000;
const balance = (account: string) =>
  fixture.testHelper.getDummyToken(account, "SPS")?.balance ?? 0;

describe("add_pool", () => {
  test("Garbage data does not crash.", () => {
    expect(() =>
      fixture.opsHelper.processOp("add_pool", "steemmonsters", garbage_payload),
    ).not.toThrow();
  });
  test("Lots of emoji does not crash.", () => {
    expect(() =>
      fixture.opsHelper.processOp("add_pool", "steemmonsters", emoji_payload),
    ).not.toThrow();
  });
});

describe("update_pool", () => {
  test("Garbage data does not crash.", () => {
    expect(() =>
      fixture.opsHelper.processOp(
        "update_pool",
        "steemmonsters",
        garbage_payload,
      ),
    ).not.toThrow();
  });
  test("Lots of emoji does not crash.", () => {
    expect(() =>
      fixture.opsHelper.processOp(
        "update_pool",
        "steemmonsters",
        emoji_payload,
      ),
    ).not.toThrow();
  });
});

describe("disable_pool", () => {
  test("Garbage data does not crash.", () => {
    expect(() =>
      fixture.opsHelper.processOp(
        "disable_pool",
        "steemmonsters",
        garbage_payload,
      ),
    ).not.toThrow();
  });
  test("Lots of emoji does not crash.", () => {
    expect(() =>
      fixture.opsHelper.processOp(
        "disable_pool",
        "steemmonsters",
        emoji_payload,
      ),
    ).not.toThrow();
  });
});

test("Simple claim", () => {
  const account = "wordempire";
  const name = "somepool";
  fixture.opsHelper.processOp("add_pool", "steemmonsters", {
    name,
    token: "SPS",
    beneficiary: account,
    tokensPerNormalizedDay: 7,
    start: new Date(0),
  });
  const balance_before = balance(account);
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day),
  });
  const balance_after = fixture.testHelper.getDummyToken(
    account,
    "SPS",
  )!.balance;
  expect(balance_before).toBe(0);
  expect(balance_after).toBeCloseTo(7);
});

test("Multiple claims do not pay out more", () => {
  const account = "wordempire";
  const name = "somepool";
  fixture.opsHelper.processOp("add_pool", "steemmonsters", {
    name,
    token: "SPS",
    beneficiary: account,
    tokensPerNormalizedDay: 17,
    start: new Date(0),
  });
  const balance_before = balance(account);
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day),
  });
  const balance_after = fixture.testHelper.getDummyToken(
    account,
    "SPS",
  )!.balance;
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day),
  });
  const balance_after2 = fixture.testHelper.getDummyToken(
    account,
    "SPS",
  )!.balance;
  expect(balance_before).toBe(0);
  expect(balance_after).toBeCloseTo(17);
  expect(balance_after2).toBeCloseTo(17);
});

test("Updated pool configuration gets reflected in claim amount", () => {
  const account = "wordempire";
  const name = "somepool";
  fixture.opsHelper.processOp("add_pool", "steemmonsters", {
    name,
    token: "SPS",
    beneficiary: account,
    tokensPerNormalizedDay: 17,
    start: new Date(0),
  });
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day),
  });
  const first_balance = fixture.testHelper.getDummyToken(
    account,
    "SPS",
  )!.balance;
  fixture.opsHelper.processOp("update_pool", "steemmonsters", {
    name,
    tokensPerNormalizedDay: 200,
  });
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day * 2),
  });
  const after_balance = fixture.testHelper.getDummyToken(
    account,
    "SPS",
  )!.balance;
  expect(first_balance).toBe(17);
  expect(after_balance).toBeCloseTo(217);
});

test("Updating pool configuration for pool that does not exist does nothing.", () => {
  const account = "wordempire";
  fixture.opsHelper.processOp("update_pool", "steemmonsters", {
    name: "somepool",
    token: "SPS",
    beneficiary: account,
    tokensPerNormalizedDay: 17,
    start: new Date(0),
  });
  const first_balance = balance(account);
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day),
  });
  const after_balance = balance(account);
  expect(first_balance).toBe(0);
  expect(after_balance).toBeCloseTo(0);
});

test("Adding pool configuration for pool that already exists changes nothing.", () => {
  const account = "wordempire";
  fixture.opsHelper.processOp("add_pool", "steemmonsters", {
    name: "somepool",
    token: "SPS",
    beneficiary: account,
    tokensPerNormalizedDay: 22,
    start: new Date(0),
  });
  fixture.opsHelper.processOp("add_pool", "steemmonsters", {
    name: "somepool",
    token: "SPS",
    beneficiary: account,
    tokensPerNormalizedDay: 7331,
    start: new Date(0),
  });
  const first_balance = balance(account);
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day),
  });
  const after_balance =
    fixture.testHelper.getDummyToken(account, "SPS")!.balance ?? 0;
  expect(first_balance).toBe(0);
  expect(after_balance).toBeCloseTo(22);
});

test("Disabled pool does not pay out claim", () => {
  const account = "wordempire";
  const name = "somepool";
  fixture.opsHelper.processOp("add_pool", "steemmonsters", {
    name,
    token: "SPS",
    beneficiary: account,
    tokensPerNormalizedDay: 7,
    start: new Date(0),
  });
  const balance_before = balance(account);
  fixture.opsHelper.processOp("disable_pool", "steemmonsters", { name });
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day),
  });
  const balance_after = balance(account);
  expect(balance_before).toBe(0);
  expect(balance_after).toBe(0);
});

test("Re-enabled pool does not pay out skipped claims", () => {
  const account = "wordempire";
  const name = "somepool";
  fixture.opsHelper.processOp("add_pool", "steemmonsters", {
    name,
    token: "SPS",
    beneficiary: account,
    tokensPerNormalizedDay: 7,
    start: new Date(0),
  });
  const balance_before = balance(account);
  fixture.opsHelper.processOp("disable_pool", "steemmonsters", { name });
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day),
  });
  fixture.opsHelper.processOp("update_pool", "steemmonsters", {
    name: "somepool",
    start: new Date(approximate_day * 2),
  });
  fixture.opsHelper.processVirtualOp("claim_pool", "steemmonsters", {
    now: new Date(approximate_day * 3),
  });
  const balance_after = balance(account);
  expect(balance_before).toBe(0);
  expect(balance_after).toBeCloseTo(7);
});

// Not in upstream.
describe("pool results", () => {
  const add = {
    name: "somepool",
    token: "SPS",
    beneficiary: "wordempire",
    tokensPerNormalizedDay: 7,
    start: "1970-01-01T00:00:00.000Z",
  };

  test("add_pool stores the cast params, unknown keys included, as sps.inflation_pools", () => {
    const [action] = fixture.opsHelper.processOp("add_pool", "steemmonsters", {
      ...add,
      extra: 1,
    });
    expect(action.success).toBe(true);
    expect(JSON.parse(JSON.stringify(action.result))).toEqual([
      {
        object_type: "config",
        event_type: "update",
        data: {
          group_name: "sps",
          group_type: "object",
          name: "inflation_pools",
          index: 0,
          value_type: "array",
          // yup 0.32 casts the schema's fields in reverse declaration order, then unknown keys
          value:
            '[{"start":"1970-01-01T00:00:00.000Z","tokensPerNormalizedDay":7,"beneficiary":"wordempire","token":"SPS","name":"somepool","extra":1}]',
          last_updated_date: null,
          last_updated_tx: null,
        },
      },
    ]);
  });

  test("disable_pool moves the start to the maximum date", () => {
    fixture.opsHelper.processOp("add_pool", "steemmonsters", add);
    fixture.opsHelper.processOp("disable_pool", "steemmonsters", {
      name: "somepool",
    });
    expect(fixture.state.config.get("sps", "inflation_pools")!.value).toBe(
      '[{"start":"+275760-09-13T00:00:00.000Z","tokensPerNormalizedDay":7,"beneficiary":"wordempire","token":"SPS","name":"somepool"}]',
    );
  });

  test("pool errors are validation errors with the pool codes", () => {
    const [dup] = [
      fixture.opsHelper.processOp("add_pool", "steemmonsters", add),
      fixture.opsHelper.processOp("add_pool", "steemmonsters", add),
    ][1];
    expect(dup.error).toEqual({
      message:
        "Trying to add pool with name somepool that already is registered",
      code: ErrorType.AutonomousPoolAlreadyRegistered,
      action: "add_pool",
    });
    const [missing] = fixture.opsHelper.processOp(
      "update_pool",
      "steemmonsters",
      { name: "nope" },
    );
    expect(missing.error?.code).toBe(ErrorType.AutonomousPoolNotRegistered);
    const [nonAdmin] = fixture.opsHelper.processOp(
      "disable_pool",
      "wordempire",
      { name: "somepool" },
    );
    expect(nonAdmin.error?.code).toBe(ErrorType.AdminOnly);
  });

  test("claim_pool mints from $MINTING_ACCOUNT and stores lastPayout", () => {
    fixture.opsHelper.processOp("add_pool", "steemmonsters", add);
    const [action] = fixture.opsHelper.processVirtualOp(
      "claim_pool",
      "$MINTING",
      { now: new Date(approximate_day / 2) },
      { transaction: "claim_1@0" },
    );
    const events = JSON.parse(JSON.stringify(action.result));
    expect(events.map((e: { object_type: string }) => e.object_type)).toEqual([
      "balances",
      "balances",
      "balance_history",
      "balance_history",
      "config",
    ]);
    expect(events[0].data).toEqual({
      player: "$MINTING_ACCOUNT",
      token: "SPS",
      balance: "-3.500",
    });
    expect(events[2].data.type).toBe("INFLATION_POOL_MINT_SOMEPOOL");
    expect(JSON.parse(events[4].data.value)[0].lastPayout).toBe(
      new Date(approximate_day / 2).toISOString(),
    );
  });

  test("the claim source emits claim_pool only while a pool is registered", () => {
    const block: BlockRef = {
      block_num: 5,
      block_id: "b",
      previous: "a",
      block_time: new Date(approximate_day),
      prng: () => 0,
    } as unknown as BlockRef;
    expect(fixture.svc.poolClaims.process(block)).toEqual([]);
    fixture.opsHelper.processOp("add_pool", "steemmonsters", add);
    expect(fixture.svc.poolClaims.process(block)).toEqual([
      [
        "custom_json",
        {
          required_auths: ["$MINTING"],
          required_posting_auths: [],
          id: "sm_sps",
          json: { action: "claim_pool", params: { now: block.block_time } },
        },
      ],
    ]);
    expect(fixture.svc.poolClaims.trx_id(block)).toBe(
      `claim_5@${approximate_day}`,
    );
  });

  test("without an sps.inflation_pools row, add_pool stops processing as upstream's updateReturning does", () => {
    fixture.restore();
    fixture.testHelper.insertDefaultConfiguration();
    fixture.load();
    expect(() =>
      fixture.opsHelper.processOp("add_pool", "steemmonsters", add),
    ).toThrow(OperationError);
  });
});
