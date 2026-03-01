import { config } from "../config.mjs";
import type { HiveBlock } from "./types.mjs";

let currentNodeIndex = 0;

function getNode(): string {
  return config.rpcNodes[currentNodeIndex % config.rpcNodes.length];
}

function rotateNode(): void {
  currentNodeIndex = (currentNodeIndex + 1) % config.rpcNodes.length;
}

async function rpcCall<T>(
  method: string,
  params: unknown,
): Promise<T> {
  const maxAttempts = config.rpcNodes.length * 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const node = getNode();
    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${node}`);
      }

      const json = (await res.json()) as {
        result?: T;
        error?: { message: string };
      };

      if (json.error) {
        throw new Error(`RPC error: ${json.error.message}`);
      }

      return json.result as T;
    } catch (err) {
      lastError = err as Error;
      rotateNode();
    }
  }

  throw lastError ?? new Error("All RPC nodes failed");
}

export async function getBlock(blockNum: number): Promise<HiveBlock | null> {
  const result = await rpcCall<{ block: HiveBlock | null }>(
    "block_api.get_block",
    { block_num: blockNum },
  );
  return result?.block ?? null;
}

export async function getHeadBlockNum(): Promise<number> {
  const result = await rpcCall<{
    head_block_number?: number;
    last_irreversible_block_num?: number;
  }>("condenser_api.get_dynamic_global_properties", []);

  if (config.blocksHeadMode === "irreversible") {
    return (result.last_irreversible_block_num ?? 0) - config.blocksBehindHead;
  }
  return (result.head_block_number ?? 0) - config.blocksBehindHead;
}

export async function getBlocks(
  startBlock: number,
  count: number,
): Promise<(HiveBlock | null)[]> {
  const promises = Array.from({ length: count }, (_, i) =>
    getBlock(startBlock + i),
  );
  return Promise.all(promises);
}
