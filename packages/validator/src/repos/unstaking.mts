import type { StateStore, UnstakingRow } from "../state/index.mjs";
import type { BlockRef, ProcessResult } from "../types.mjs";
import { EventLog } from "../types.mjs";
import { pgCompare } from "../util/collate.mjs";
import { warn } from "../util/log.mjs";
import { numberToScaled, scaledToNumber } from "../util/num.mjs";
import type { ConfigLoader } from "./config.mjs";
import type { IAction } from "./context.mjs";

export type TokenUnstakingEntry = {
  player: string;
  unstake_tx: string;
  unstake_start_date: Date;
  is_active: boolean;
  token: string;
  total_qty: number;
  next_unstake_date: Date;
  total_unstaked: number;
  unstaking_periods: number;
  unstaking_interval_seconds: number;
  cancel_tx: string | null;
};

export type EnrichedTokenUnstakingEntry = TokenUnstakingEntry & { unstake_amount: number };

function into(r: UnstakingRow): TokenUnstakingEntry {
  return {
    player: r.player,
    unstake_tx: r.unstake_tx,
    unstake_start_date: r.unstake_start_date,
    is_active: r.is_active,
    token: r.token,
    total_qty: scaledToNumber(r.total_qty, 3),
    next_unstake_date: r.next_unstake_date,
    total_unstaked: scaledToNumber(r.total_unstaked, 3),
    unstaking_periods: r.unstaking_periods,
    unstaking_interval_seconds: r.unstaking_interval_seconds,
    cancel_tx: r.cancel_tx,
  };
}

function unstake_amount(entry: TokenUnstakingEntry): EnrichedTokenUnstakingEntry {
  const unstake_amount_remaining = +(entry.total_qty - entry.total_unstaked).toFixed(3);
  const unstake_amount = Math.min(unstake_amount_remaining, +(entry.total_qty / entry.unstaking_periods).toFixed(3));
  return { ...entry, unstake_amount };
}

export class TokenUnstakingRepository {
  constructor(private readonly state: StateStore, private readonly config: ConfigLoader, private readonly customJsonId: string) {}

  trx_id(block: BlockRef): string {
    return `sl_token_unstaking_${block.block_num}`;
  }

  lookup(player: string, token: string): TokenUnstakingEntry | null {
    const r = this.state.unstaking.lookupActive(player, token);
    return r ? into(r) : null;
  }

  insert(action: IAction, token: string, qty: number): EventLog[] {
    const settings = this.config.unstaking(token);
    if (!settings) {
      warn("Attempting to insert unstaking records while having misconfigured unstaking settings, ignoring.");
      return [];
    }
    const row: UnstakingRow = {
      player: action.op.account,
      unstake_tx: action.op.trx_op_id,
      unstake_start_date: action.op.block_time,
      is_active: true,
      token,
      total_qty: numberToScaled(qty, 3),
      next_unstake_date: new Date(action.op.block_time.getTime() + settings.unstaking_interval_seconds * 1000),
      total_unstaked: 0n,
      unstaking_periods: settings.unstaking_periods,
      unstaking_interval_seconds: settings.unstaking_interval_seconds,
      cancel_tx: null,
    };
    this.state.unstaking.set(row);
    // upstream logs an un-awaited Promise, which serialises as {}
    return [new EventLog("insert", "token_unstaking", {})];
  }

  cancel(action: IAction, token: string): EventLog {
    const row = this.state.unstaking.lookupActive(action.op.account, token);
    if (!row) return new EventLog("update", "token_unstaking", undefined);
    row.is_active = false;
    row.cancel_tx = action.op.trx_op_id;
    const data = into(row);
    this.state.unstaking.prune();
    return new EventLog("update", "token_unstaking", data);
  }

  /** The `update` bound into the virtual payload; its event log is discarded upstream. */
  update(entry: EnrichedTokenUnstakingEntry): void {
    const row = this.state.unstaking.get(entry.unstake_tx);
    if (!row) throw new Error(`unstaking row ${entry.unstake_tx} not found`);
    const newUnstaked = numberToScaled(entry.total_unstaked + entry.unstake_amount, 3);
    if (entry.total_unstaked + entry.unstake_amount + 0.01 >= entry.total_qty) {
      row.is_active = false;
      row.total_unstaked = newUnstaked;
      this.state.unstaking.prune();
    } else {
      row.total_unstaked = newUnstaked;
      row.next_unstake_date = new Date(entry.next_unstake_date.getTime() + entry.unstaking_interval_seconds * 1000);
    }
  }

  process(block: BlockRef): ProcessResult[] {
    const rows = this.state.unstaking
      .active()
      .filter((r) => r.next_unstake_date < block.block_time)
      .sort((a, b) => a.next_unstake_date.getTime() - b.next_unstake_date.getTime() || pgCompare(a.unstake_tx, b.unstake_tx));
    return rows.map((r) => [
      "custom_json",
      {
        required_auths: [r.player],
        required_posting_auths: [],
        id: this.customJsonId,
        json: { action: "token_unstaking", params: this.boundParams(r) },
      },
    ]);
  }

  boundParams(row: UnstakingRow): EnrichedTokenUnstakingEntry & { update: () => void } {
    const entry = unstake_amount(into(row));
    return { ...entry, update: () => this.update(entry) };
  }
}
