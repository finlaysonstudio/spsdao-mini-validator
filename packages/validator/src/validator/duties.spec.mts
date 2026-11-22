import { sha256 } from "js-sha256";
import { beforeEach, describe, expect, it } from "vitest";
import { Fixture } from "../__tests__/fixture.mjs";
import { TOKENS } from "../repos/context.mjs";
import type { TransactionEntity } from "../types.mjs";
import { checkInJitter, customJson, ShadowBroadcaster, ValidatorDuties, type BroadcastRequest, type DutyEvent } from "./duties.mjs";

const MAX_AGE = 100; // DEFAULT_CONFIG.validator.max_block_age
const INTERVAL = 28800; // DEFAULT_CONFIG.validator_check_in
const WINDOW = 300;

class Recorder {
  sent: BroadcastRequest[] = [];
  events: DutyEvent[] = [];
  readonly broadcaster = { mode: "shadow" as const, send: (r: BroadcastRequest) => void this.sent.push(r) };
  readonly emit = (e: DutyEvent) => void this.events.push(e);
  of(action: string) {
    return this.sent.filter((s) => s.action === action);
  }
  msgs(msg: string) {
    return this.events.filter((e) => e.msg === msg);
  }
}

const fx = new Fixture();
let rec: Recorder;

function hashOf(n: number) {
  return sha256(`block-${n}`);
}

/** Insert block n as BlockProcessor would, then run the duties for it. */
function block(duties: ValidatorDuties, n: number, { validator = null, head = n, transactions = [] }: { validator?: string | null; head?: number; transactions?: TransactionEntity[] } = {}) {
  const l2 = hashOf(n);
  fx.svc.blocks.insertProcessed({ block_num: n, block_id: `id${n}`, prev_block_id: `id${n - 1}`, l2_block_id: l2, block_time: new Date(), validator, validation_tx: null });
  duties.onBlock({ block_num: n, l2_block_id: l2, validator, transactions, head_block: head });
  return l2;
}

function tx({ type, player, params, success = true, error = null }: { type: string; player: string; params: object; success?: boolean; error?: string | null }): TransactionEntity {
  return { id: `trx-${type}-${player}`, created_date: new Date(), block_num: 0, index: 0, block_id: "", prev_block_id: "", type, player, data: JSON.stringify(params), success, error, result: null };
}

function make(opts: Partial<ConstructorParameters<typeof ValidatorDuties>[0]> = {}) {
  return new ValidatorDuties({ svc: fx.svc, accounts: ["alpha"], broadcaster: rec.broadcaster, emit: rec.emit, version: "test", enableCheckIns: false, ...opts });
}

beforeEach(() => {
  fx.restore();
  fx.testHelper.insertDefaultConfiguration();
  fx.load();
  fx.testHelper.insertDummyValidator("alpha");
  fx.testHelper.insertDummyValidator("beta");
  rec = new Recorder();
});

describe("validate_block (leader)", () => {
  it("sends the block hash for a block assigned to a configured account", () => {
    const duties = make();
    const l2 = block(duties, 1000, { validator: "alpha" });
    block(duties, 1001, { validator: "someone" });
    expect(rec.of("validate_block")).toEqual([{ account: "alpha", action: "validate_block", params: { block_num: 1000, hash: l2, version: "test" }, context: { role: "leader", sent_at: 1000 } }]);
  });

  it("validates for every configured account", () => {
    const duties = make({ accounts: ["alpha", "beta"] });
    block(duties, 1000, { validator: "alpha" });
    block(duties, 1001, { validator: "beta" });
    expect(rec.of("validate_block").map((s) => [s.account, s.params.block_num])).toEqual([
      ["alpha", 1000],
      ["beta", 1001],
    ]);
  });

  it("skips blocks older than max_block_age (catching up)", () => {
    const duties = make();
    block(duties, 1000, { validator: "alpha", head: 1000 + MAX_AGE + 1 });
    expect(rec.sent).toEqual([]);
  });
});

describe("validate_block (follower)", () => {
  it("defers, then fills in when the leader stays silent", () => {
    const duties = make({ validateBlockDelay: 3 });
    const l2 = block(duties, 1000, { validator: "alpha" });
    block(duties, 1001);
    block(duties, 1002);
    expect(rec.sent).toEqual([]);
    block(duties, 1003);
    expect(rec.of("validate_block")).toEqual([{ account: "alpha", action: "validate_block", params: { block_num: 1000, hash: l2, version: "test" }, context: { role: "follower", sent_at: 1003 } }]);
  });

  it("stays quiet when the leader validated within the delay", () => {
    const duties = make({ validateBlockDelay: 3 });
    block(duties, 1000, { validator: "alpha" });
    fx.svc.blocks.insertValidation(1000, "leader-trx");
    block(duties, 1001);
    block(duties, 1002);
    block(duties, 1003);
    expect(rec.sent).toEqual([]);
    expect(rec.msgs("duty skipped")[0].fields).toMatchObject({ block_num: 1000, reason: "leader_validated" });
  });
});

describe("chain observation", () => {
  it("reports a matching validation by a configured account as ok, against the intent", () => {
    const duties = make();
    const l2 = block(duties, 1000, { validator: "alpha" });
    block(duties, 1001, { transactions: [tx({ type: "validate_block", player: "alpha", params: { block_num: 1000, hash: l2, version: "1.5.1" } })] });
    const [e] = rec.msgs("observed validation");
    expect(e.status).toBe("ok");
    expect(e.fields).toMatchObject({ account: "alpha", block_num: 1000, match: true, intended: true, intent_match: true });
  });

  it("reports a hash that differs from this node's as an error", () => {
    const duties = make();
    block(duties, 1000, { validator: "alpha" });
    block(duties, 1001, { transactions: [tx({ type: "validate_block", player: "alpha", params: { block_num: 1000, hash: "other", version: "1.5.1" }, success: false, error: "BlockHashMismatch" })] });
    const [e] = rec.msgs("observed validation");
    expect(e.status).toBe("error");
    expect(e.fields).toMatchObject({ match: false, intent_match: false });
  });

  it("ignores accounts that are not configured", () => {
    const duties = make();
    block(duties, 1000, { transactions: [tx({ type: "validate_block", player: "beta", params: { block_num: 999, hash: "x", version: "1" } })] });
    expect(rec.events).toEqual([]);
  });

  it("reports a validation nobody sent once the block is past max_block_age", () => {
    const duties = make();
    block(duties, 1000, { validator: "alpha" });
    for (let n = 1001; n <= 1000 + MAX_AGE + 1; n++) block(duties, n);
    const [e] = rec.msgs("validation missed");
    expect(e.status).toBe("error");
    expect(e.fields).toMatchObject({ account: "alpha", block_num: 1000 });
  });
});

describe("check-ins", () => {
  beforeEach(() => {
    fx.testHelper.setDummyToken("alpha", 1, TOKENS.ACTIVATED_LICENSE);
  });

  it("checks in as soon as possible without a previous check-in", () => {
    const duties = make({ enableCheckIns: true });
    const l2 = block(duties, 1000);
    expect(rec.of("check_in_validator")).toEqual([
      { account: "alpha", action: "check_in_validator", params: { block_num: 1000, hash: sha256(`${l2}alpha`), version: "test" }, context: { reward_account: "alpha", last_check_in_block_num: null, role: "leader", retry: false } },
    ]);
  });

  it("waits for interval + deterministic jitter after the last check-in, plus the follower delay", () => {
    const last = 1000;
    fx.state.checkIns.set({ account: "alpha", status: "active", last_check_in_block_num: last, last_check_in: new Date() });
    const next = last + INTERVAL + checkInJitter({ account: "alpha", lastCheckInBlock: last, window: WINDOW / 2 });
    const duties = make({ enableCheckIns: true, validateBlockDelay: 5 });
    block(duties, next + 4);
    expect(rec.sent).toEqual([]);
    block(duties, next + 5);
    expect(rec.of("check_in_validator").map((s) => s.params.block_num)).toEqual([next + 5]);
  });

  it("does not resend while unconfirmed, then retries", () => {
    const duties = make({ enableCheckIns: true, checkInRetryBlocks: 10 });
    for (let n = 1000; n < 1010; n++) block(duties, n);
    expect(rec.of("check_in_validator")).toHaveLength(1);
    block(duties, 1010);
    expect(rec.of("check_in_validator").map((s) => [s.params.block_num, s.context.retry])).toEqual([
      [1000, false],
      [1010, true],
    ]);
  });

  it("checks in once per reward account shared by several validator accounts", () => {
    fx.restore();
    fx.testHelper.insertDefaultConfiguration();
    fx.load();
    fx.testHelper.insertDummyValidator("alpha", true, 0, "payee");
    fx.testHelper.insertDummyValidator("beta", true, 0, "payee");
    fx.testHelper.setDummyToken("payee", 1, TOKENS.ACTIVATED_LICENSE);
    const duties = make({ accounts: ["alpha", "beta"], enableCheckIns: true });
    const l2 = block(duties, 1000);
    expect(rec.of("check_in_validator").map((s) => [s.account, s.params.hash])).toEqual([["alpha", sha256(`${l2}payee`)]]);
  });

  it("does not check in without activated licenses", () => {
    const duties = make({ accounts: ["beta"], enableCheckIns: true });
    block(duties, 1000);
    expect(rec.sent).toEqual([]);
  });

  it("does not check in for a block outside the window behind the head", () => {
    const duties = make({ enableCheckIns: true });
    block(duties, 1000, { head: 1000 + WINDOW + 1 });
    expect(rec.sent).toEqual([]);
  });
});

describe("ShadowBroadcaster", () => {
  it("logs the custom_json upstream would broadcast", () => {
    const events: DutyEvent[] = [];
    const request: BroadcastRequest = { account: "alpha", action: "validate_block", params: { block_num: 5, hash: "h", version: "v" }, context: {} };
    new ShadowBroadcaster({ emit: (e) => void events.push(e) }).send(request);
    expect(events[0].msg).toBe("shadow broadcast");
    expect(events[0].fields.custom_json).toEqual({ id: "sm_sps", required_auths: [], required_posting_auths: ["alpha"], json: '{"action":"validate_block","params":{"block_num":5,"hash":"h","version":"v"}}' });
    expect(customJson({ id: "sm_sps", request }).json).toBe(events[0].fields.custom_json && (events[0].fields.custom_json as { json: string }).json);
  });
});
