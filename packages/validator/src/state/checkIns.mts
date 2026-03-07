export interface CheckIn {
  account: string;
  block_num: number;
  hash: string;
  status: string;
}

export class CheckInStore {
  private checkIns = new Map<string, CheckIn>();

  get(account: string): CheckIn | undefined {
    return this.checkIns.get(account);
  }

  set(checkIn: CheckIn): void {
    this.checkIns.set(checkIn.account, checkIn);
  }

  remove(account: string): void {
    this.checkIns.delete(account);
  }

  getAll(): CheckIn[] {
    return Array.from(this.checkIns.values());
  }

  /** Set a check-in to inactive (instead of deleting) */
  setInactive(account: string): void {
    const ci = this.checkIns.get(account);
    if (ci) {
      ci.status = "inactive";
    }
  }

  /** Get check-ins that have expired (older than maxAge blocks from currentBlock) */
  getExpired(
    currentBlock: number,
    intervalBlocks: number,
    windowBlocks: number,
  ): CheckIn[] {
    const maxAge = intervalBlocks + windowBlocks;
    return Array.from(this.checkIns.values()).filter(
      (ci) => ci.status === "active" && currentBlock - ci.block_num > maxAge,
    );
  }

  load(entries: Partial<CheckIn>[]): void {
    for (const e of entries) {
      if (!e.account) continue;
      this.set({
        account: e.account,
        block_num: e.block_num ?? 0,
        hash: e.hash ?? "",
        status: e.status ?? "active",
      });
    }
  }
}
