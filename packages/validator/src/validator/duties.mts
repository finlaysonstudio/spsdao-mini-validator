/**
 * Validator duties: block validation and check-ins for one or more accounts.
 *
 * Ports upstream's block-validation submission (validator/src/processor.ts) and
 * ValidatorCheckInPlugin (features/validator/license-plugin.ts), with Fire Horse's
 * leader/follower delay and deterministic check-in jitter, generalised to several
 * accounts. Every send goes through a Broadcaster; the shadow broadcaster only logs, the
 * live one (broadcast.mts) signs and sends.
 *
 * It also watches the chain for validate_block / check_in_validator transactions
 * signed by the configured accounts (sent by another node, e.g. the upstream
 * validator) and reports whether they agree with this node's state and with what
 * it intended to send. That comparison is the evidence shadow mode exists for.
 */
import { sha256 } from "js-sha256";
import type { Services } from "../services.mjs";
import type { TransactionEntity } from "../types.mjs";

export type DutyAction = "validate_block" | "check_in_validator";

export type PriceUpdate = { token: string; price: number };

export type BroadcastRequest = {
  account: string;
  /** Extra context for the log line; never sent on chain. */
  context: Record<string, unknown>;
} & ({ action: DutyAction; params: { block_num: number; hash: string; version: string } } | { action: "price_feed"; params: { updates: PriceUpdate[]; metadata?: unknown } });

export interface Broadcaster {
  readonly mode: "shadow" | "live";
  send(request: BroadcastRequest): void;
}

export type DutyEvent = { status: "info" | "ok" | "warning" | "error"; msg: string; fields: Record<string, unknown> };

export type DutiesOptions = {
  svc: Services;
  accounts: string[];
  broadcaster: Broadcaster;
  emit: (event: DutyEvent) => void;
  version?: string;
  /** Fire Horse VALIDATE_BLOCK_DELAY: 0 = leader, > 0 = follower that only fills in for a silent leader. */
  validateBlockDelay?: number;
  enableCheckIns?: boolean;
  /** Re-send an unconfirmed check-in after this many blocks. */
  checkInRetryBlocks?: number;
};

type Intent = { account: string; block_num: number; hash: string; sent_at: number; role: "leader" | "follower" };
type PendingValidation = { account: string; block_num: number; hash: string; submit_after: number };
type CheckInSent = { last_check_in_block_num: number | null; sent_at: number; block_num: number; hash: string };

const DEFAULT_VERSION = "1.5.1-mini.0";

/** Fire Horse getDeterministicJitter: reproducible across restarts and nodes. */
export function checkInJitter({ account, lastCheckInBlock, window }: { account: string; lastCheckInBlock: number; window: number }): number {
  if (window <= 0) return 0;
  return parseInt(sha256(`${account}:${lastCheckInBlock}`).substring(0, 8), 16) % window;
}

export class ValidatorDuties {
  private readonly svc: Services;
  private readonly accounts: string[];
  private readonly accountSet: Set<string>;
  private readonly broadcaster: Broadcaster;
  private readonly emit: (event: DutyEvent) => void;
  private readonly version: string;
  private readonly delay: number;
  private readonly enableCheckIns: boolean;
  private readonly checkInRetryBlocks: number;

  /** validations this node sent (or would have sent), by block number */
  private readonly intents = new Map<number, Intent>();
  private readonly pending: PendingValidation[] = [];
  /** last check-in sent per reward account */
  private readonly checkInsSent = new Map<string, CheckInSent>();

  constructor({ svc, accounts, broadcaster, emit, version = DEFAULT_VERSION, validateBlockDelay = 0, enableCheckIns = true, checkInRetryBlocks = 100 }: DutiesOptions) {
    this.svc = svc;
    this.accounts = [...new Set(accounts.map((a) => a.trim()).filter(Boolean))];
    this.accountSet = new Set(this.accounts);
    this.broadcaster = broadcaster;
    this.emit = emit;
    this.version = version;
    this.delay = validateBlockDelay;
    this.enableCheckIns = enableCheckIns;
    this.checkInRetryBlocks = checkInRetryBlocks;
  }

  get role(): "leader" | "follower" {
    return this.delay > 0 ? "follower" : "leader";
  }

  /** Run after BlockProcessor.process for every block, in order. */
  onBlock({ block_num, l2_block_id, validator, transactions, head_block }: { block_num: number; l2_block_id: string; validator: string | null; transactions: TransactionEntity[]; head_block: number }): void {
    this.observe(block_num, transactions);
    this.validate(block_num, l2_block_id, validator, head_block);
    this.releasePending(block_num, head_block);
    this.settleIntents(block_num);
    if (this.enableCheckIns) for (const account of this.accounts) this.checkIn(account, block_num, l2_block_id, head_block);
  }

  // -------------------------------------------------------------------------
  // block validation
  // -------------------------------------------------------------------------
  private validate(block_num: number, hash: string, validator: string | null, head_block: number): void {
    if (validator === null || !this.accountSet.has(validator)) return;
    const cfg = this.svc.config.validator;
    const maxAge = cfg?.max_block_age;
    // upstream: `maxBlockAge && headBlock - maxBlockAge <= block_num`
    if (!maxAge || head_block - maxAge > block_num) return;
    if (cfg.paused_until_block > block_num) {
      this.emit({ status: "info", msg: "duty skipped", fields: { duty: "validate_block", account: validator, block_num, reason: "paused" } });
      return;
    }
    if (this.delay > 0) {
      this.pending.push({ account: validator, block_num, hash, submit_after: block_num + this.delay });
      this.emit({ status: "info", msg: "duty deferred", fields: { duty: "validate_block", account: validator, block_num, l2_block_id: hash, role: "follower", submit_after: block_num + this.delay } });
      return;
    }
    this.sendValidation({ account: validator, block_num, hash, sent_at: block_num, role: "leader" });
  }

  private releasePending(block_num: number, head_block: number): void {
    const maxAge = this.svc.config.validator?.max_block_age;
    for (let i = 0; i < this.pending.length; ) {
      const p = this.pending[i];
      if (block_num < p.submit_after) {
        i++;
        continue;
      }
      this.pending.splice(i, 1);
      if (maxAge && head_block - maxAge > p.block_num) {
        this.emit({ status: "warning", msg: "duty skipped", fields: { duty: "validate_block", account: p.account, block_num: p.block_num, reason: "too_old_after_delay" } });
        continue;
      }
      if (this.svc.blocks.getByBlockNum(p.block_num)?.validation_tx) {
        this.emit({ status: "info", msg: "duty skipped", fields: { duty: "validate_block", account: p.account, block_num: p.block_num, reason: "leader_validated" } });
        continue;
      }
      this.sendValidation({ account: p.account, block_num: p.block_num, hash: p.hash, sent_at: block_num, role: "follower" });
    }
  }

  private sendValidation(intent: Intent): void {
    this.intents.set(intent.block_num, intent);
    this.broadcaster.send({
      account: intent.account,
      action: "validate_block",
      params: { block_num: intent.block_num, hash: intent.hash, version: this.version },
      context: { role: intent.role, sent_at: intent.sent_at },
    });
  }

  /** Once a validated block is past max_block_age, report whether the chain recorded a validation. */
  private settleIntents(block_num: number): void {
    const maxAge = this.svc.config.validator?.max_block_age ?? 100;
    for (const [n, intent] of this.intents) {
      if (block_num - n <= maxAge) continue;
      this.intents.delete(n);
      const row = this.svc.blocks.getByBlockNum(n);
      if (row?.validation_tx) continue; // already reported by observe()
      this.emit({ status: "error", msg: "validation missed", fields: { account: intent.account, block_num: n, l2_block_id: intent.hash, role: intent.role } });
    }
  }

  // -------------------------------------------------------------------------
  // check-ins
  // -------------------------------------------------------------------------
  private checkIn(account: string, block_num: number, l2_block_id: string, head_block: number): void {
    const lm = this.svc.licenseManager;
    const cfg = this.svc.config.validator_check_in;
    if (!cfg) return;
    // upstream: a check-in for a block older than the window would be rejected
    if (!lm.isCheckInBlockWithinWindow(head_block, block_num)) return;
    const validator = this.svc.validators.lookup(account, block_num);
    if (!validator || !validator.is_active) return;
    const rewardAccount = validator.reward_account ?? account;
    // several configured accounts may share one reward account: the first one checks in
    const owner = this.accounts.find((a) => {
      const v = this.svc.validators.lookup(a, block_num);
      return v?.is_active && (v.reward_account ?? a) === rewardAccount;
    });
    if (owner !== account) return;

    const { can_check_in, last_check_in_block_num } = lm.getCheckIn(rewardAccount, block_num);
    if (!can_check_in) return;
    const last = last_check_in_block_num ?? null;

    const sent = this.checkInsSent.get(rewardAccount);
    if (sent && sent.last_check_in_block_num === last && block_num - sent.sent_at < this.checkInRetryBlocks) return;

    if (last !== null) {
      // check in within the first half of the window, so a failure leaves time to recover
      const window = Math.floor(cfg.check_in_window_blocks / 2);
      const next = last + cfg.check_in_interval_blocks + checkInJitter({ account: rewardAccount, lastCheckInBlock: last, window });
      if (block_num < next + this.delay) return;
    }

    const hash = lm.getCheckInHash(l2_block_id, rewardAccount);
    const retry = sent !== undefined && sent.last_check_in_block_num === last;
    this.checkInsSent.set(rewardAccount, { last_check_in_block_num: last, sent_at: block_num, block_num, hash });
    this.broadcaster.send({
      account,
      action: "check_in_validator",
      params: { block_num, hash, version: this.version },
      context: { reward_account: rewardAccount, last_check_in_block_num: last, role: this.role, retry },
    });
  }

  // -------------------------------------------------------------------------
  // chain observation
  // -------------------------------------------------------------------------
  private observe(block_num: number, transactions: TransactionEntity[]): void {
    for (const tx of transactions) {
      if (tx.type !== "validate_block" && tx.type !== "check_in_validator") continue;
      if (!this.accountSet.has(tx.player)) continue;
      let params: { block_num?: number; hash?: string; version?: string };
      try {
        params = JSON.parse(tx.data ?? "{}");
      } catch {
        params = {};
      }
      const base = { action: tx.type, account: tx.player, in_block: block_num, trx_id: tx.id, block_num: params.block_num, chain_hash: params.hash, version: params.version, success: tx.success, error: tx.error };
      if (tx.type === "validate_block") {
        const ours = params.block_num !== undefined ? this.svc.blocks.getBlockHash(params.block_num)?.l2_block_id : undefined;
        const intent = params.block_num !== undefined ? this.intents.get(params.block_num) : undefined;
        if (params.block_num !== undefined) this.intents.delete(params.block_num);
        this.pending.splice(0, this.pending.length, ...this.pending.filter((p) => p.block_num !== params.block_num));
        const match = ours !== undefined && ours === params.hash;
        this.emit({
          status: match && tx.success ? "ok" : "error",
          msg: "observed validation",
          fields: { ...base, our_hash: ours ?? null, match, intended: intent !== undefined, intent_hash: intent?.hash ?? null, intent_match: intent ? intent.hash === params.hash : null, intent_role: intent?.role ?? null },
        });
      } else {
        const v = this.svc.validators.lookup(tx.player, block_num);
        const rewardAccount = v?.reward_account ?? tx.player;
        const ours = params.block_num !== undefined ? (this.svc.licenseManager.getCheckInHashForBlockNum(params.block_num, rewardAccount) ?? null) : null;
        const sent = this.checkInsSent.get(rewardAccount);
        const match = ours !== null && ours === params.hash;
        this.emit({
          status: match && tx.success ? "ok" : "error",
          msg: "observed check-in",
          fields: { ...base, reward_account: rewardAccount, our_hash: ours, match, intended_block: sent?.block_num ?? null, blocks_from_intent: sent ? (params.block_num ?? 0) - sent.block_num : null },
        });
      }
    }
  }
}

/** Shadow mode: build and log every transaction, sign and send nothing. */
export class ShadowBroadcaster implements Broadcaster {
  readonly mode = "shadow" as const;
  private readonly emit: (event: DutyEvent) => void;
  private readonly customJsonId: string;
  constructor({ emit, customJsonId = "sm_sps" }: { emit: (event: DutyEvent) => void; customJsonId?: string }) {
    this.emit = emit;
    this.customJsonId = customJsonId;
  }
  send(request: BroadcastRequest): void {
    this.emit({
      status: "info",
      msg: "shadow broadcast",
      fields: { action: request.action, account: request.account, ...request.params, ...request.context, custom_json: customJson({ id: this.customJsonId, request }) },
    });
  }
}

/** The custom_json upstream's HiveClient broadcasts (validator/src/hive.ts), posting authority. */
export function customJson({ id, request }: { id: string; request: BroadcastRequest }) {
  return { id, required_auths: [] as string[], required_posting_auths: [request.account], json: JSON.stringify({ action: request.action, params: request.params }) };
}
