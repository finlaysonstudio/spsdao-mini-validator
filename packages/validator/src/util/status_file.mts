/**
 * Progress file for `spud status`: when the process started, static facts about it (role, upstream version),
 * the newest processed block, the chain head the stream last saw, how far behind that is, the replay rate and
 * which configured accounts are not active validators (comma-separated `inactive_accounts`).
 * Rewritten atomically (temp file + rename); block updates at most once per `everyMs`.
 */
import { renameSync, writeFileSync } from "node:fs";

export interface StatusFileEntry {
  block_num: number;
  head_block: number;
  rate: number;
  /** Configured accounts that are not active validators at block_num. */
  inactive_accounts?: string[];
}

export type StatusFileInfo = Record<string, string | number | boolean | null>;

export class StatusFile {
  private lastWrite = 0;
  private readonly everyMs: number;
  private readonly startedAt: number;
  private info: StatusFileInfo;

  constructor(
    private readonly path: string,
    { everyMs = 1000, startedAt = Date.now(), info = {} }: { everyMs?: number; startedAt?: number; info?: StatusFileInfo } = {},
  ) {
    this.everyMs = everyMs;
    this.startedAt = startedAt;
    this.info = { ...info };
  }

  /** Merge static facts into every later write. */
  setInfo(info: StatusFileInfo): void {
    this.info = { ...this.info, ...info };
  }

  /** Write the file before the first block (state still loading). */
  start(now = Date.now()): boolean {
    if (!this.path) return false;
    this.write({ block_num: null, head_block: null, behind: null, rate: null }, now);
    return true;
  }

  update(entry: StatusFileEntry, now = Date.now()): boolean {
    if (!this.path || now - this.lastWrite < this.everyMs) return false;
    this.lastWrite = now;
    this.write(
      {
        block_num: entry.block_num,
        head_block: entry.head_block,
        behind: Math.max(0, entry.head_block - entry.block_num),
        rate: Number(entry.rate.toFixed(2)),
        ...(entry.inactive_accounts ? { inactive_accounts: entry.inactive_accounts.join(",") } : {}),
      },
      now,
    );
    return true;
  }

  private write(progress: StatusFileInfo, now: number): void {
    const body = {
      started_at: new Date(this.startedAt).toISOString(),
      started_unix: Math.floor(this.startedAt / 1000),
      ...this.info,
      ...progress,
      updated_at: new Date(now).toISOString(),
    };
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(body) + "\n");
    renameSync(tmp, this.path);
  }
}
