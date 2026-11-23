// Port of upstream apps/sps-validator/src/sps/actions/config_update.test.ts, plus the reload side effects.
import { beforeEach, describe, expect, test } from "vitest";
import {
  Fixture,
  emoji_payload,
  garbage_payload,
} from "../__tests__/fixture.mjs";
import { hardcodedShopConfig } from "../__tests__/shop.mjs";
import { ErrorType } from "../util/errors.mjs";

const fixture = new Fixture();

beforeEach(() => {
  fixture.restore();
  fixture.testHelper.insertExistingAdmins([]);
  fixture.load();
});

test("Garbage data for config_update does not crash.", () => {
  expect(() =>
    fixture.opsHelper.processOp(
      "config_update",
      "steemmonsters",
      garbage_payload,
    ),
  ).not.toThrow();
});

test("Lots of emoji for config_update does not crash.", () => {
  expect(() =>
    fixture.opsHelper.processOp(
      "config_update",
      "steemmonsters",
      emoji_payload,
    ),
  ).not.toThrow();
});

test("Nonadmin tries to affect config_update", () => {
  expect(fixture.loader.value["admin_accounts"]).toEqual([]);
  fixture.opsHelper.processOp("config_update", "wordempire", {
    updates: [
      {
        group_name: "$root",
        name: "admin_accounts",
        value: JSON.stringify(["wordempire"]),
      },
    ],
  });
  expect(fixture.loader.value["admin_accounts"]).toEqual([]);
});

test("Admin updates existing config", () => {
  expect(fixture.loader.value["admin_accounts"]).toEqual([]);
  fixture.opsHelper.processOp("config_update", "steemmonsters", {
    updates: [
      {
        group_name: "$root",
        name: "admin_accounts",
        value: JSON.stringify(["wordempire"]),
      },
    ],
  });
  expect(fixture.loader.value["admin_accounts"]).toEqual(["wordempire"]);
});

test("Admin attempts to update existing config with posting auth", () => {
  expect(fixture.loader.value["admin_accounts"]).toEqual([]);
  fixture.opsHelper.processOp(
    "config_update",
    "steemmonsters",
    {
      updates: [
        {
          group_name: "$root",
          name: "admin_accounts",
          value: JSON.stringify(["wordempire"]),
        },
      ],
    },
    { is_active: false },
  );
  expect(fixture.loader.value["admin_accounts"]).toEqual([]);
});

test("Admin attempts to update nonexistent config", () => {
  fixture.opsHelper.processOp("config_update", "steemmonsters", {
    updates: [
      {
        group_name: "nox-root",
        name: "not_admin_accounts",
        value: JSON.stringify(["wordempire", "worthempire"]),
      },
    ],
  });
  const perhaps = fixture.loader.value as any;
  expect(perhaps?.["nox-root"]?.["not_admin_accounts"]).toBeUndefined();
});

test("Admin attempts to update config with invalid data", () => {
  fixture.testHelper.insertDefaultConfiguration();
  fixture.load();
  fixture.opsHelper.processOp("config_update", "steemmonsters", {
    updates: [{ group_name: "sps", name: "unstaking_periods", value: -100 }],
  });
  const perhaps = fixture.loader.value as any;
  expect(perhaps?.["sps"]?.["unstaking_periods"]).toBe(1);
});

// Not in upstream: the transaction row fields and events, which feed the block hash.
describe("config_update results", () => {
  beforeEach(() => {
    fixture.testHelper.insertDefaultConfiguration();
    fixture.load();
  });

  test("a rejected update fails with InvalidConfig and the asserter's messages", () => {
    const [action] = fixture.opsHelper.processOp(
      "config_update",
      "steemmonsters",
      {
        updates: [
          { group_name: "sps", name: "unstaking_periods", value: -100 },
          { group_name: "nox-root", name: "nothing", value: 1 },
        ],
      },
    );
    expect(action.success).toBe(false);
    expect(action.error).toEqual({
      message:
        "Config update validation failed. Validation failed for sps.unstaking: unstaking_periods must be a positive number. Config entry nox-root.nothing does not exist.",
      code: ErrorType.InvalidConfig,
      action: "config_update",
    });
  });

  test("non-admins fail with AdminOnly before any validation", () => {
    const [action] = fixture.opsHelper.processOp(
      "config_update",
      "wordempire",
      { updates: [{ group_name: "nox-root", name: "nothing", value: 1 }] },
    );
    expect(action.success).toBe(false);
    expect(action.error?.code).toBe(ErrorType.AdminOnly);
  });

  test("each update emits the updated config row and reloads, parsing by the row's value_type", () => {
    const [action] = fixture.opsHelper.processOp(
      "config_update",
      "steemmonsters",
      {
        updates: [
          { group_name: "validator", name: "max_block_age", value: 50 },
          { group_name: "price_feed", name: "interval_blocks", value: "150" },
        ],
      },
    );
    expect(action.success).toBe(true);
    expect(JSON.parse(JSON.stringify(action.result))).toEqual([
      {
        object_type: "config",
        event_type: "update",
        data: {
          group_name: "validator",
          group_type: "object",
          name: "max_block_age",
          index: 0,
          value_type: "object",
          value: "50",
          last_updated_date: null,
          last_updated_tx: null,
        },
      },
      {
        object_type: "config",
        event_type: "update",
        data: {
          group_name: "price_feed",
          group_type: "object",
          name: "interval_blocks",
          index: 0,
          value_type: "object",
          value: "150",
          last_updated_date: null,
          last_updated_tx: null,
        },
      },
    ]);
    expect(fixture.loader.validator?.max_block_age).toBe(50);
    expect(fixture.loader.price_feed?.interval_blocks).toBe(150);
  });

  test("a group that fails its asserter after a reload is undefined, as upstream's watcher sets it", () => {
    // value_type 'number' parses "x" as NaN, which validateUpdateConfig rejects; reload directly
    fixture.testHelper.insertConfig(
      "price_feed",
      "interval_blocks",
      "number",
      "x",
    );
    fixture.load();
    expect(fixture.loader.value.price_feed.interval_blocks).toBeNaN();
    expect(fixture.loader.price_feed).toBeUndefined();
    const [action] = fixture.opsHelper.processOp(
      "config_update",
      "steemmonsters",
      {
        updates: [
          { group_name: "price_feed", name: "interval_blocks", value: 120 },
        ],
      },
    );
    expect(action.success).toBe(true);
    expect(fixture.loader.price_feed?.interval_blocks).toBe(120);
  });

  test("a shop update re-registers the sales", () => {
    for (const [name, value] of Object.entries(hardcodedShopConfig))
      fixture.testHelper.insertConfig(
        "shop",
        name,
        "object",
        JSON.stringify(value),
      );
    fixture.load();
    expect(fixture.svc.shop.hasEntry("nice_sale")).toBe(true);
    const [action] = fixture.opsHelper.processOp(
      "config_update",
      "steemmonsters",
      {
        updates: [
          { group_name: "shop", name: "nice_sale", value: { type: "unknown" } },
        ],
      },
    );
    expect(action.success).toBe(true);
    expect(fixture.svc.shop.hasEntry("validator_tranche_info")).toBe(true);
    expect(fixture.svc.shop.hasEntry("nice_sale")).toBe(false);
  });

  test("an sps update rebuilds the autonomous pools", () => {
    fixture.testHelper.insertConfig("sps", "inflation_pools", "array", "[]");
    fixture.load();
    expect(fixture.svc.poolManager.anyPools()).toBe(false);
    const pool = {
      name: "p",
      token: "SPS",
      beneficiary: "wordempire",
      tokensPerNormalizedDay: 1,
      start: "1970-01-01T00:00:00.000Z",
    };
    const [action] = fixture.opsHelper.processOp(
      "config_update",
      "steemmonsters",
      {
        updates: [
          { group_name: "sps", name: "inflation_pools", value: [pool] },
        ],
      },
    );
    expect(action.success).toBe(true);
    expect(fixture.svc.poolManager.anyPools()).toBe(true);
  });
});
