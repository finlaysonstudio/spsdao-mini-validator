/**
 * Live broadcasting: sign each duty as a custom_json with the posting key and send it.
 *
 * The transaction matches upstream's HiveClient (validator/src/hive.ts): one custom_json,
 * `required_posting_auths: [account]`, `json: JSON.stringify({ action, params })`, expiring
 * 60 s after the head block time, referencing the head block. Sends are fire-and-forget from
 * the block loop (as upstream's plugins are); the outcome is reported through `emit`, and
 * ValidatorDuties reports a validation that never reached the chain as "validation missed".
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

export type AuthorityGrant = { account: string; via: "key" | "account_auth"; grantee?: string };

/**
 * Confirm `key` alone satisfies the posting authority of every account: either directly in
 * `key_auths`, or through an `account_auths` grant to an account whose posting `key_auths`
 * hold the key. Throws, naming the account, when one does not; nothing can be sent for it.
 */
export async function verifyPostingAuthority({ accounts, key, chain = defaultChain }: { accounts: string[]; key: PrivateKey; chain?: Chain }): Promise<AuthorityGrant[]> {
  const found = await chain.getAccounts(accounts);
  const byName = new Map(found.map((a) => [a.name, a]));
  const holds = (auth: client.Authority) => auth.key_auths.some(([pub, weight]) => pub === key.publicKey && weight >= auth.weight_threshold);

  const grants: AuthorityGrant[] = [];
  const missing: string[] = [];
  for (const name of accounts) {
    const acct = byName.get(name);
    if (!acct) throw new Error(`validator account ${name} does not exist`);
    if (holds(acct.posting)) {
      grants.push({ account: name, via: "key" });
      continue;
    }
    const candidates = acct.posting.account_auths.filter(([, w]) => w >= acct.posting.weight_threshold).map(([n]) => n);
    const grantees = candidates.length ? await chain.getAccounts(candidates) : [];
    const grantee = grantees.find((g) => holds(g.posting));
    if (grantee) grants.push({ account: name, via: "account_auth", grantee: grantee.name });
    else missing.push(name);
  }
  if (missing.length) throw new Error(`validator key ${key.publicKey} cannot sign with posting authority for: ${missing.join(", ")}`);
  return grants;
}

export class LiveBroadcaster implements Broadcaster {
  readonly mode = "live" as const;
  private readonly emit: (event: DutyEvent) => void;
  private readonly customJsonId: string;
  private readonly key: PrivateKey;
  private readonly chain: Chain;
  private readonly expirationSeconds: number;
  /** trx ids this process broadcast, oldest first (bounded) */
  private readonly sentIds = new Set<string>();
  private readonly inflight = new Set<Promise<void>>();

  constructor({ emit, key, customJsonId = "sm_sps", chain = defaultChain, expirationSeconds = 60 }: { emit: (event: DutyEvent) => void; key: PrivateKey; customJsonId?: string; chain?: Chain; expirationSeconds?: number }) {
    this.emit = emit;
    this.key = key;
    this.customJsonId = customJsonId;
    this.chain = chain;
    this.expirationSeconds = expirationSeconds;
  }

  send(request: BroadcastRequest): void {
    const p = this.broadcast(request).finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** True when this process broadcast the transaction (validate_block / check_in seen on chain). */
  isOwnTransaction(trxId: string): boolean {
    return this.sentIds.has(trxId);
  }

  /** Wait for every send in progress (shutdown, tests). */
  async flush(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  private async broadcast(request: BroadcastRequest): Promise<void> {
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
      signed = signTransaction(tx, this.key);
    } catch (err) {
      this.emit({ status: "error", msg: "broadcast failed", fields: { ...fields, stage: "prepare", error: message(err) } });
      return;
    }
    this.remember(trxId);
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

  private remember(trxId: string): void {
    this.sentIds.add(trxId);
    if (this.sentIds.size > 2000) this.sentIds.delete(this.sentIds.values().next().value!);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
