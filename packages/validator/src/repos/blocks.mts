import type { StateStore } from "../state/index.mjs";
import type { BlockRow } from "../types.mjs";
import { EventLog } from "../types.mjs";
import { UnsupportedPathError } from "../util/errors.mjs";

export class BlockRepository {
  constructor(private readonly state: StateStore) {}

  getByBlockNum(block_num: number): BlockRow | null {
    return this.state.blocks.get(block_num) ?? null;
  }

  getBlockHash(block_num: number): { l2_block_id: string } | null {
    const b = this.state.blocks.get(block_num);
    return b ? { l2_block_id: b.l2_block_id } : null;
  }

  getLatestBlockNum(): number | null {
    const n = this.state.blocks.getLatestBlockNum();
    return n === 0 ? null : n;
  }

  /**
   * SELECT MAX(block_num) FROM blocks WHERE block_time < date. Only the newest blocks are retained
   * (a contiguous window ending at the latest block), so the answer is exact whenever the oldest
   * retained block is already before `date`; otherwise it lies outside the window.
   */
  getLastBlockNumBefore(date: Date): number | null {
    const latest = this.state.blocks.getLatestBlockNum();
    const earliest = this.state.blocks.getEarliestBlockNum();
    const first = this.state.blocks.get(earliest);
    if (!first || first.block_time >= date) {
      throw new UnsupportedPathError(`getLastBlockNumBefore(${date.toISOString()}) is outside retained blocks (oldest ${earliest})`);
    }
    let best = earliest;
    for (let b = earliest + 1; b <= latest; b++) {
      const row = this.state.blocks.get(b);
      if (row && row.block_time < date) best = b;
    }
    return best;
  }

  getMissedBlocks(last_checked_block_num: number, block_num: number): BlockRow[] {
    return this.state.blocks.missed(last_checked_block_num, block_num);
  }

  insertValidation(block_num: number, validation_tx: string): EventLog {
    const row = this.state.blocks.get(block_num);
    if (!row) throw new Error(`block ${block_num} not found`);
    row.validation_tx = validation_tx;
    return new EventLog("update", "blocks", { ...row });
  }

  insertProcessed(row: BlockRow): void {
    this.state.blocks.set(row);
  }
}
