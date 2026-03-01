import type { BlockRef } from "../types.mjs";

export class BlockStore {
  private blocks = new Map<number, BlockRef>();
  private retention: number;

  constructor(retention = 0) {
    this.retention = retention;
  }

  get(blockNum: number): BlockRef | undefined {
    return this.blocks.get(blockNum);
  }

  getLatest(): BlockRef | undefined {
    if (this.blocks.size === 0) return undefined;
    const maxKey = Math.max(...this.blocks.keys());
    return this.blocks.get(maxKey);
  }

  set(block: BlockRef): void {
    this.blocks.set(block.block_num, block);
    this.prune();
  }

  private prune(): void {
    if (this.retention <= 0) return;
    const keys = Array.from(this.blocks.keys()).sort((a, b) => a - b);
    while (keys.length > this.retention) {
      this.blocks.delete(keys.shift()!);
    }
  }

  getAll(): BlockRef[] {
    return Array.from(this.blocks.values()).sort(
      (a, b) => a.block_num - b.block_num,
    );
  }
}
