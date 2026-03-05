export interface PriceEntry {
  validator: string;
  token: string;
  block_num: number;
  block_time: Date;
  token_price: number;
}

export class PriceHistoryStore {
  private entries: PriceEntry[] = [];

  add(entry: PriceEntry): void {
    this.entries.push(entry);
  }

  getLatest(token: string): PriceEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].token === token) return this.entries[i];
    }
    return undefined;
  }

  getAll(): PriceEntry[] {
    return [...this.entries];
  }

  load(
    entries: {
      validator?: string;
      token?: string;
      block_num?: number;
      block_time?: string | Date;
      token_price?: number;
    }[],
  ): void {
    for (const e of entries) {
      if (!e.validator || !e.token) continue;
      this.entries.push({
        validator: e.validator,
        token: e.token,
        block_num: e.block_num ?? 0,
        block_time: e.block_time ? new Date(e.block_time) : new Date(),
        token_price: e.token_price ?? 0,
      });
    }
  }
}
