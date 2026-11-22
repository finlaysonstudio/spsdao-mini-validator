import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getBlock as rpcGetBlock } from "./client.mjs";
import type { HiveBlock } from "./types.mjs";

export class BlockCache {
  constructor(private readonly dir: string) {
    if (dir) mkdirSync(dir, { recursive: true });
  }

  private file(n: number): string {
    return join(this.dir, `${Math.floor(n / 1000)}`, `${n}.json`);
  }

  async get(n: number): Promise<HiveBlock | null> {
    if (this.dir) {
      const f = this.file(n);
      if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
    }
    const block = await rpcGetBlock(n);
    if (block && this.dir) {
      const f = this.file(n);
      mkdirSync(join(this.dir, `${Math.floor(n / 1000)}`), { recursive: true });
      writeFileSync(f, JSON.stringify(block));
    }
    return block;
  }
}
