import { round3 } from "./balances.mjs";

export interface UnstakingRecord {
  player: string;
  unstake_tx: string;
  token: string;
  quantity: number;
  quantity_left: number;
  total_qty: number;
  next_unstake_date: Date;
  is_active: boolean;
}

export class UnstakingStore {
  private records = new Map<string, UnstakingRecord>();

  get(unstakeTx: string): UnstakingRecord | undefined {
    return this.records.get(unstakeTx);
  }

  set(record: UnstakingRecord): void {
    this.records.set(record.unstake_tx, record);
  }

  remove(unstakeTx: string): void {
    this.records.delete(unstakeTx);
  }

  getByPlayer(player: string): UnstakingRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.player === player && r.is_active,
    );
  }

  /** Get all active records ready to process at the given time */
  getReady(now: Date): UnstakingRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.is_active && r.next_unstake_date <= now,
    );
  }

  getAll(): UnstakingRecord[] {
    return Array.from(this.records.values());
  }

  load(
    entries: {
      player: string;
      unstake_tx: string;
      token: string;
      quantity: number;
      quantity_left: number;
      total_qty: number;
      next_unstake_date: string | Date;
      is_active: boolean;
    }[],
  ): void {
    for (const e of entries) {
      this.set({
        player: e.player,
        unstake_tx: e.unstake_tx,
        token: e.token,
        quantity: round3(e.quantity),
        quantity_left: round3(e.quantity_left),
        total_qty: round3(e.total_qty),
        next_unstake_date: new Date(e.next_unstake_date),
        is_active: e.is_active,
      });
    }
  }
}
