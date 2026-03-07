import type { BlockDetail } from "@spsdao/validator/pipeline";

export class BlockStore {
  private blocks = new Map<number, BlockDetail>();
  private order: number[] = [];
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  add(detail: BlockDetail): void {
    if (this.blocks.has(detail.blockNum)) return;

    this.blocks.set(detail.blockNum, detail);
    this.order.push(detail.blockNum);

    // Evict oldest if over capacity
    while (this.order.length > this.maxSize) {
      const oldest = this.order.shift()!;
      this.blocks.delete(oldest);
    }
  }

  get(blockNum: number): BlockDetail | undefined {
    return this.blocks.get(blockNum);
  }

  getLatest(): BlockDetail | undefined {
    if (this.order.length === 0) return undefined;
    return this.blocks.get(this.order[this.order.length - 1]);
  }

  getRange(): { min: number; max: number; count: number } | null {
    if (this.order.length === 0) return null;
    return {
      min: this.order[0],
      max: this.order[this.order.length - 1],
      count: this.order.length,
    };
  }
}
