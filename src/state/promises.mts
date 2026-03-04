export interface PromiseRecord {
  id: string;
  type: string;
  controller: string;
  fulfilled_by?: string;
  params: Record<string, unknown>;
  status: "open" | "fulfilled" | "completed" | "cancelled" | "reversed";
  created_block_num: number;
  expiration_block_num?: number;
}

export class PromiseStore {
  private promises = new Map<string, PromiseRecord>();

  get(id: string): PromiseRecord | undefined {
    return this.promises.get(id);
  }

  set(promise: PromiseRecord): void {
    this.promises.set(promise.id, promise);
  }

  remove(id: string): void {
    this.promises.delete(id);
  }

  getOpen(): PromiseRecord[] {
    return Array.from(this.promises.values()).filter(
      (p) => p.status === "open",
    );
  }

  getExpired(currentBlock: number): PromiseRecord[] {
    return Array.from(this.promises.values()).filter(
      (p) =>
        p.status === "open" &&
        p.expiration_block_num !== undefined &&
        p.expiration_block_num <= currentBlock,
    );
  }

  getAll(): PromiseRecord[] {
    return Array.from(this.promises.values());
  }

  load(entries: Partial<PromiseRecord>[]): void {
    for (const e of entries) {
      if (!e.id) continue;
      this.set({
        id: e.id,
        type: e.type ?? "",
        controller: e.controller ?? "",
        fulfilled_by: e.fulfilled_by,
        params: e.params ?? {},
        status: e.status ?? "open",
        created_block_num: e.created_block_num ?? 0,
        expiration_block_num: e.expiration_block_num,
      });
    }
  }
}
