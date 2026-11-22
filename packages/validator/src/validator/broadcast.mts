/**
 * Live broadcasting: sign each duty as a custom_json with a posting key and send it.
 *
 * The transaction matches upstream's HiveClient (validator/src/hive.ts): one custom_json,
 * `required_posting_auths: [account]`, `json: JSON.stringify({ action, params })`, expiring
 * 60 s after the head block time, referencing the head block. Sends are fire-and-forget from
 * the block loop (as upstream's plugins are); the outcome is reported through `emit`, and
 * ValidatorDuties reports a validation that never reached the chain as "validation missed".
 *
 * Each account signs with whichever configured key holds its posting authority. An account
 * no key can sign for is skipped (its duties stay in shadow mode); the process keeps running.
 */
import * as client from "../hive/client.mjs";
import { expirationAfter, PrivateKey, refBlock, signTransaction, transactionId, type SignedTransaction, type Transaction } from "../hive/signing.mjs";
import { customJson, type Broadcaster, type BroadcastRequest, type DutyEvent } from "./duties.mjs";

export type Chain = {
  getDynamicGlobalProperties: (opts?: { deadlineMs?: number }) => Promise<client.DynamicGlobalProperties>;
  broadcastTransaction: (tx: unknown, opts?: { deadlineMs?: number }) => Promise<void>;
  getAccounts: (names: string[]) => Promise<client.HiveAccount[]>;
};

const defaultChain: Chain = {
  getDynamicGlobalProperties: client.getDynamicGlobalProperties,
  broadcastTransaction: client.broadcastTransaction,
  getAccounts: client.getAccounts,
};

export type Signer = { account: string; key: PrivateKey; via: "key" | "account_auth"; grantee?: string };
export type SkippedAccount = { account: string; reason: string };

/** Parse comma-separated WIFs; malformed entries are reported by position, never by value. */
export function parseKeys(value: string): { keys: PrivateKey[]; invalid: { index: number; reason: string }[] } {
  const keys: PrivateKey[] = [];
  const invalid: { index: number; reason: string }[] = [];
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((wif, index) => {
      try {
        keys.push(PrivateKey.fromWif(wif));
      } catch (err) {
        invalid.push({ index, reason: err instanceof Error ? err.message : String(err) });
      }
    });
  return { keys, invalid };
}

/**
 * For every account, find a key that alone satisfies its posting authority: directly in
 * `key_auths`, or through an `account_auths` grant to an account whose posting `key_auths`
 * hold the key. Accounts without one are returned as skipped, with the reason.
 */
export async function resolveSigners({ accounts, keys, chain = defaultChain }: { accounts: string[]; keys: PrivateKey[]; chain?: Chain }): Promise<{ signers: Signer[]; skipped: SkippedAccount[] }> {
  if (keys.length === 0) return { signers: [], skipped: accounts.map((account) => ({ account, reason: "no valid key configured" })) };
  let found: client.HiveAccount[];
  try {
    found = await chain.getAccounts(accounts);
  } catch (err) {
    return { signers: [], skipped: accounts.map((account) => ({ account, reason: `account lookup failed: ${message(err)}` })) };
  }
  const byName = new Map(found.map((a) => [a.name, a]));
  const holds = (auth: client.Authority, key: PrivateKey) => auth.key_auths.some(([pub, weight]) => pub === key.publicKey && weight >= auth.weight_threshold);

  const signers: Signer[] = [];
  const skipped: SkippedAccount[] = [];
  for (const account of accounts) {
    const acct = byName.get(account);
    if (!acct) {
      skipped.push({ account, reason: "account does not exist" });
      continue;
    }
    const direct = keys.find((k) => holds(acct.posting, k));
    if (direct) {
      signers.push({ account, key: direct, via: "key" });
      continue;
    }
    const candidates = acct.posting.account_auths.filter(([, w]) => w >= acct.posting.weight_threshold).map(([n]) => n);
    let grantees: client.HiveAccount[] = [];
    try {
      grantees = candidates.length ? await chain.getAccounts(candidates) : [];
    } catch (err) {
      skipped.push({ account, reason: `grantee lookup failed: ${message(err)}` });
      continue;
    }
    const match = grantees.flatMap((g) => keys.filter((k) => holds(g.posting, k)).map((key) => ({ grantee: g.name, key })))[0];
    if (match) signers.push({ account, key: match.key, via: "account_auth", grantee: match.grantee });
    else skipped.push({ account, reason: "no configured key holds its posting authority" });
  }
  return { signers, skipped };
}

export class LiveBroadcaster implements Broadcaster {
  readonly mode = "live" as const;
  private readonly emit: (event: DutyEvent) => void;
  private readonly customJsonId: string;
  private readonly keys: Map<string, PrivateKey>;
  private readonly fallback: Broadcaster | null;
  private readonly chain: Chain;
  private readonly expirationSeconds: number;
  private readonly inflight = new Set<Promise<void>>();

  constructor({
    emit,
    signers,
    fallback = null,
    customJsonId = "sm_sps",
    chain = defaultChain,
    expirationSeconds = 60,
  }: {
    emit: (event: DutyEvent) => void;
    signers: Signer[];
    /** Receives requests for accounts without a signer (a ShadowBroadcaster: logged, not sent). */
    fallback?: Broadcaster | null;
    customJsonId?: string;
    chain?: Chain;
    expirationSeconds?: number;
  }) {
    this.emit = emit;
    this.keys = new Map(signers.map((s) => [s.account, s.key]));
    this.fallback = fallback;
    this.customJsonId = customJsonId;
    this.chain = chain;
    this.expirationSeconds = expirationSeconds;
  }

  send(request: BroadcastRequest): void {
    const key = this.keys.get(request.account);
    if (!key) {
      this.fallback?.send({ ...request, context: { ...request.context, reason: "no_key" } });
      return;
    }
    const p = this.broadcast(request, key).finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Wait for every send in progress (shutdown, tests). */
  async flush(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  private async broadcast(request: BroadcastRequest, key: PrivateKey): Promise<void> {
    const fields = { action: request.action, account: request.account, ...request.params, ...request.context };
    let signed: SignedTransaction;
    let trxId: string;
    try {
      const dgp = await this.chain.getDynamicGlobalProperties({ deadlineMs: 10_000 });
      const tx: Transaction = {
        ...refBlock(dgp.head_block_number, dgp.head_block_id),
        expiration: expirationAfter(dgp.time, this.expirationSeconds),
        operations: [["custom_json", customJson({ id: this.customJsonId, request })]],
        extensions: [],
      };
      trxId = transactionId(tx);
      signed = signTransaction(tx, key);
    } catch (err) {
      this.emit({ status: "error", msg: "broadcast failed", fields: { ...fields, stage: "prepare", error: message(err) } });
      return;
    }
    const t0 = Date.now();
    try {
      await this.chain.broadcastTransaction(signed);
      this.emit({ status: "info", msg: "broadcast sent", fields: { ...fields, trx_id: trxId, expiration: signed.expiration, ms: Date.now() - t0 } });
    } catch (err) {
      const msg = message(err);
      // a retry on another node after the first one accepted it
      if (/duplicate/i.test(msg)) {
        this.emit({ status: "info", msg: "broadcast sent", fields: { ...fields, trx_id: trxId, expiration: signed.expiration, ms: Date.now() - t0, duplicate: true } });
        return;
      }
      this.emit({ status: "error", msg: "broadcast failed", fields: { ...fields, stage: "send", trx_id: trxId, error: msg, ms: Date.now() - t0 } });
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
