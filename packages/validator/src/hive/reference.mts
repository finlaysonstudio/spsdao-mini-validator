/**
 * Reference hashes from an upstream validator's public API (an archive node,
 * e.g. https://splinterlands-validator-api.splinterlands.com).
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RefBlock = { block_num: number; block_id: string; l2_block_id: string; validator: string | null };

export class ReferenceApi {
  constructor(private readonly base: string) {}

  private async get<T>(path: string): Promise<T | null> {
    let last: Error | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(`${this.base.replace(/\/$/, "")}${path}`, { signal: AbortSignal.timeout(30000) });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        last = err as Error;
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`reference ${path}: ${last?.message}`);
  }

  block(n: number): Promise<RefBlock | null> {
    return this.get<RefBlock>(`/block/${n}`);
  }

  /** Upstream validator_transactions rows for a block. */
  transactions(n: number): Promise<unknown[] | null> {
    return this.get<unknown[]>(`/transactions/${n}`);
  }
}
