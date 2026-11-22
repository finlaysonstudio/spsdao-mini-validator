import { config } from "../config.mjs";
import type { HiveBlock } from "./types.mjs";

let currentNodeIndex = 0;

function getNode(): string {
  return config.rpcNodes[currentNodeIndex % config.rpcNodes.length];
}

function rotateNode(): void {
  currentNodeIndex = (currentNodeIndex + 1) % config.rpcNodes.length;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One JSON-RPC call, rotating through the nodes on failure. After every full
 * pass over the nodes without success it backs off exponentially (public nodes
 * answer bursts with HTTP 429), and only gives up after `rpcRetryDeadlineMs`.
 */
async function rpcCall<T>(method: string, { params, node: preferredNode, deadlineMs = config.rpcRetryDeadlineMs }: { params: unknown; node?: string; deadlineMs?: number }): Promise<T> {
  const deadline = Date.now() + deadlineMs;
  let lastError: Error | null = null;

  for (let attempt = 0; ; attempt++) {
    const node = attempt === 0 && preferredNode ? preferredNode : getNode();
    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(config.rpcTimeoutMs),
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
    if ((attempt + 1) % config.rpcNodes.length === 0) {
      const pass = (attempt + 1) / config.rpcNodes.length;
      const wait = Math.min(30_000, 500 * 2 ** (pass - 1));
      if (Date.now() + wait > deadline) break;
      await sleep(wait);
    }
  }

  throw lastError ?? new Error("All RPC nodes failed");
}

export async function getBlock(blockNum: number): Promise<HiveBlock | null> {
  const result = await rpcCall<{ block: HiveBlock | null }>("block_api.get_block", { params: { block_num: blockNum } });
  return result?.block ?? null;
}

export async function getHeadBlockNum(): Promise<number> {
  const result = await rpcCall<{
    head_block_number?: number;
    last_irreversible_block_num?: number;
  }>("condenser_api.get_dynamic_global_properties", { params: [] });

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

/** block_api.get_block_range (at most 1000 blocks per call). */
export async function getBlockRange(startBlock: number, count: number, node?: string): Promise<HiveBlock[]> {
  const result = await rpcCall<{ blocks?: HiveBlock[] }>("block_api.get_block_range", { params: { starting_block_num: startBlock, count }, node });
  return result?.blocks ?? [];
}

export type DynamicGlobalProperties = { head_block_number: number; head_block_id: string; time: string; last_irreversible_block_num: number };

export async function getDynamicGlobalProperties({ deadlineMs }: { deadlineMs?: number } = {}): Promise<DynamicGlobalProperties> {
  return rpcCall<DynamicGlobalProperties>("condenser_api.get_dynamic_global_properties", { params: [], deadlineMs });
}

export type Authority = { weight_threshold: number; account_auths: [string, number][]; key_auths: [string, number][] };
export type HiveAccount = { name: string; posting: Authority };

export async function getAccounts(names: string[]): Promise<HiveAccount[]> {
  return rpcCall<HiveAccount[]>("condenser_api.get_accounts", { params: [names] });
}

/**
 * Broadcast a signed transaction, rotating nodes on failure until `deadlineMs`. Resending the
 * same signed transaction is safe: a node that already has it answers "duplicate".
 */
export async function broadcastTransaction(tx: unknown, { deadlineMs = 20_000 }: { deadlineMs?: number } = {}): Promise<void> {
  await rpcCall<unknown>("condenser_api.broadcast_transaction", { params: [tx], deadlineMs });
}
