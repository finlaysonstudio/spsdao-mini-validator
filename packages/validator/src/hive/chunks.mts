/**
 * Compact on-disk cache of Hive blocks in 1000-block chunks, filled with
 * `block_api.get_block_range`. Only what the block processor reads is kept:
 * the header fields, and transactions that contain an account creation or a
 * custom_json matching the validator id/prefix. Inside a kept transaction,
 * unrelated operations are replaced by a `{type: "x"}` placeholder so that
 * `op_index` stays identical to the real chain.
 *
 * Layout: <dir>/<floor(start / 1e6)>/<start>.json.gz, where start is a
 * multiple of CHUNK_SIZE. Files are written atomically (tmp + rename).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { config } from "../config.mjs";
import { getBlockRange } from "./client.mjs";
import type { HiveBlock, HiveOperation } from "./types.mjs";

export const CHUNK_SIZE = 1000;
const ACCOUNT_CREATE = new Set(["account_create_operation", "account_create_with_delegation_operation", "create_claimed_account_operation"]);

export const chunkStart = (n: number): number => Math.floor(n / CHUNK_SIZE) * CHUNK_SIZE;

function relevant(op: HiveOperation): boolean {
  if (ACCOUNT_CREATE.has(op.type)) return true;
  if (op.type !== "custom_json_operation") return false;
  const id = String(op.value.id ?? "");
  return id === config.customJsonId || id.startsWith(config.customJsonPrefix);
}

export function compactBlock(b: HiveBlock): HiveBlock {
  const transactions: HiveBlock["transactions"] = [];
  const transaction_ids: string[] = [];
  b.transactions.forEach((t, i) => {
    if (!t.operations.some(relevant)) return;
    transactions.push({
      ref_block_num: 0,
      ref_block_prefix: 0,
      expiration: "",
      extensions: [],
      signatures: [],
      operations: t.operations.map((o) => (relevant(o) ? o : { type: "x", value: {} })),
    });
    transaction_ids.push(b.transaction_ids[i]);
  });
  return { block_id: b.block_id, previous: b.previous, timestamp: b.timestamp, transactions, transaction_ids };
}

export class ChunkCache {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  path(start: number): string {
    return join(this.dir, `${Math.floor(start / 1_000_000)}`, `${start}.json.gz`);
  }

  has(start: number): boolean {
    return existsSync(this.path(start));
  }

  read(start: number): HiveBlock[] | null {
    const f = this.path(start);
    if (!existsSync(f)) return null;
    return JSON.parse(gunzipSync(readFileSync(f)).toString("utf8"));
  }

  write(start: number, blocks: HiveBlock[]): void {
    const f = this.path(start);
    mkdirSync(join(this.dir, `${Math.floor(start / 1_000_000)}`), { recursive: true });
    const tmp = `${f}.tmp-${process.pid}`;
    writeFileSync(tmp, gzipSync(JSON.stringify(blocks)));
    renameSync(tmp, f);
  }

  /**
   * Fetch, verify and store one full chunk. Block 0 of the chain is never
   * requested (chunk 0 starts at block 1). Throws if the node returns a short
   * or discontinuous range.
   */
  async fetch(start: number, node?: string): Promise<HiveBlock[]> {
    const first = Math.max(1, start);
    const count = start + CHUNK_SIZE - first;
    const raw = await getBlockRange(first, count, node);
    if (raw.length !== count) throw new Error(`chunk ${start}: got ${raw.length} of ${count} blocks`);
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].previous !== raw[i - 1].block_id) throw new Error(`chunk ${start}: discontinuity at block ${first + i}`);
    }
    for (let i = 0; i < raw.length; i++) {
      const num = parseInt(raw[i].block_id.slice(0, 8), 16);
      if (num !== first + i) throw new Error(`chunk ${start}: block ${first + i} has id for ${num}`);
    }
    const blocks = raw.map(compactBlock);
    this.write(start, blocks);
    return blocks;
  }

  async get(start: number): Promise<HiveBlock[]> {
    return this.read(start) ?? (await this.fetch(start));
  }
}
