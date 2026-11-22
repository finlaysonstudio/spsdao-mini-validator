import dhive from "@hiveio/dhive";
import { beforeEach, describe, expect, it } from "vitest";
import type { Authority, HiveAccount } from "../hive/client.mjs";
import { PrivateKey, transactionDigest, transactionId, type SignedTransaction } from "../hive/signing.mjs";
import { LiveBroadcaster, verifyPostingAuthority, type Chain } from "./broadcast.mjs";
import type { BroadcastRequest, DutyEvent } from "./duties.mjs";

const WIF = dhive.PrivateKey.fromSeed("mini-broadcast-test").toString();
const OTHER = dhive.PrivateKey.fromSeed("mini-broadcast-other").toString();
const key = PrivateKey.fromWif(WIF);
const other = PrivateKey.fromWif(OTHER);

const DGP = { head_block_number: 101_000_123, head_block_id: "0605237b" + "efbeadde" + "00".repeat(12), time: "2026-11-22T01:00:00", last_irreversible_block_num: 101_000_100 };

const auth = (keys: [string, number][], accounts: [string, number][] = [], threshold = 1): Authority => ({ weight_threshold: threshold, key_auths: keys, account_auths: accounts });

class FakeChain implements Chain {
  sent: SignedTransaction[] = [];
  accounts = new Map<string, HiveAccount>();
  fail: Error | null = null;
  async getDynamicGlobalProperties() {
    return DGP;
  }
  async broadcastTransaction(tx: unknown) {
    if (this.fail) throw this.fail;
    this.sent.push(tx as SignedTransaction);
  }
  async getAccounts(names: string[]) {
    return names.map((n) => this.accounts.get(n)).filter((a): a is HiveAccount => a !== undefined);
  }
}

const request: BroadcastRequest = { account: "nullfame", action: "validate_block", params: { block_num: 101_000_110, hash: "ab".repeat(32), version: "1.5.1-mini.0" }, context: { role: "leader", sent_at: 101_000_110 } };

let chain: FakeChain;
let events: DutyEvent[];
const emit = (e: DutyEvent) => void events.push(e);

beforeEach(() => {
  chain = new FakeChain();
  events = [];
});

describe("LiveBroadcaster", () => {
  it("signs and sends the custom_json upstream's HiveClient sends", async () => {
    const b = new LiveBroadcaster({ emit, key, chain });
    b.send(request);
    await b.flush();
    expect(chain.sent).toHaveLength(1);
    const tx = chain.sent[0];
    expect(tx.operations).toEqual([["custom_json", { id: "sm_sps", required_auths: [], required_posting_auths: ["nullfame"], json: JSON.stringify({ action: "validate_block", params: request.params }) }]]);
    expect(tx.ref_block_num).toBe(DGP.head_block_number & 0xffff);
    expect(tx.ref_block_prefix).toBe(0xdeadbeef);
    expect(tx.expiration).toBe("2026-11-22T01:01:00");
    // the signature recovers our key and matches dhive's
    const { signatures, ...unsigned } = tx;
    expect(dhive.Signature.fromString(signatures[0]).recover(transactionDigest(unsigned)).toString()).toBe(key.publicKey);
    expect(signatures).toEqual(dhive.cryptoUtils.signTransaction(unsigned, [dhive.PrivateKey.fromString(WIF)]).signatures);

    const trxId = transactionId(unsigned);
    expect(b.isOwnTransaction(trxId)).toBe(true);
    expect(b.isOwnTransaction("f".repeat(40))).toBe(false);
    expect(events.map((e) => [e.status, e.msg, e.fields.trx_id])).toEqual([["info", "broadcast sent", trxId]]);
  });

  it("never puts the key in an event", async () => {
    chain.fail = new Error("boom");
    const b = new LiveBroadcaster({ emit, key, chain });
    b.send(request);
    await b.flush();
    expect(JSON.stringify(events)).not.toContain(WIF);
  });

  it("reports a failed send with the transaction id", async () => {
    chain.fail = new Error("RPC error: missing required posting authority");
    const b = new LiveBroadcaster({ emit, key, chain });
    b.send(request);
    await b.flush();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "error", msg: "broadcast failed", fields: { stage: "send", action: "validate_block", block_num: 101_000_110 } });
    expect(events[0].fields.trx_id).toMatch(/^[0-9a-f]{40}$/);
  });

  it("treats a duplicate (already accepted) as sent", async () => {
    chain.fail = new Error("RPC error: Duplicate transaction check failed");
    const b = new LiveBroadcaster({ emit, key, chain });
    b.send(request);
    await b.flush();
    expect(events[0]).toMatchObject({ status: "info", msg: "broadcast sent", fields: { duplicate: true } });
  });

  it("reports a failure to prepare (no head block)", async () => {
    chain.getDynamicGlobalProperties = async () => {
      throw new Error("All RPC nodes failed");
    };
    const b = new LiveBroadcaster({ emit, key, chain });
    b.send(request);
    await b.flush();
    expect(events[0]).toMatchObject({ status: "error", msg: "broadcast failed", fields: { stage: "prepare" } });
    expect(chain.sent).toEqual([]);
  });
});

describe("verifyPostingAuthority", () => {
  it("accepts a key held directly", async () => {
    chain.accounts.set("nullfame", { name: "nullfame", posting: auth([[key.publicKey, 1]]) });
    expect(await verifyPostingAuthority({ accounts: ["nullfame"], key, chain })).toEqual([{ account: "nullfame", via: "key" }]);
  });

  it("accepts a key reached through an account_auths grant", async () => {
    chain.accounts.set("nullfame", { name: "nullfame", posting: auth([[other.publicKey, 1]], [["operator", 1]]) });
    chain.accounts.set("operator", { name: "operator", posting: auth([[key.publicKey, 1]]) });
    expect(await verifyPostingAuthority({ accounts: ["nullfame"], key, chain })).toEqual([{ account: "nullfame", via: "account_auth", grantee: "operator" }]);
  });

  it("rejects a key below the threshold", async () => {
    chain.accounts.set("nullfame", { name: "nullfame", posting: auth([[key.publicKey, 1], [other.publicKey, 1]], [], 2) });
    await expect(verifyPostingAuthority({ accounts: ["nullfame"], key, chain })).rejects.toThrow(/cannot sign .* nullfame/);
  });

  it("rejects a key the account does not hold", async () => {
    chain.accounts.set("nullfame", { name: "nullfame", posting: auth([[other.publicKey, 1]]) });
    await expect(verifyPostingAuthority({ accounts: ["nullfame"], key, chain })).rejects.toThrow(/nullfame/);
  });

  it("rejects an unknown account", async () => {
    await expect(verifyPostingAuthority({ accounts: ["nobody"], key, chain })).rejects.toThrow(/does not exist/);
  });
});
