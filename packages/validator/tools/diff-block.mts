/**
 * Replay to block N from the nearest checkpoint (or the seed) and diff our
 * transaction rows for N against the reference API's /transactions/N.
 *
 *   CHECKPOINT_DIR=... CHUNK_CACHE_DIR=... SEED_FILE=... REFERENCE_API=... \
 *     npm run diff-block --workspace packages/validator -- <block_num> [<to_block_num>]
 *
 * With a second argument, every block in [N, M] is compared and the first
 * block whose hash differs is diffed.
 */
import { config } from "../src/config.mjs";
import { BlockProcessor, type ProcessedBlock } from "../src/block/processor.mjs";
import { loadSeed } from "../src/bootstrap/seed.mjs";
import { ReferenceApi } from "../src/hive/reference.mjs";
import { streamBlocks } from "../src/hive/stream.mjs";
import { Services } from "../src/services.mjs";
import { listCheckpoints, loadCheckpoint } from "../src/state/checkpoint.mjs";
import { StateStore } from "../src/state/index.mjs";

const target = parseInt(process.argv[2] ?? "", 10);
const until = parseInt(process.argv[3] ?? process.argv[2] ?? "", 10);
if (!Number.isInteger(target)) throw new Error("usage: diff-block <block_num> [<to_block_num>]");
if (!config.referenceApi) throw new Error("REFERENCE_API is required");
const ref = new ReferenceApi(config.referenceApi);

let state: StateStore;
let from: number;
let prev: string;
const cps = config.checkpointDir ? listCheckpoints(config.checkpointDir).filter((b) => b < target) : [];
if (cps.length > 0) {
  const b = cps[cps.length - 1];
  const cp = loadCheckpoint(config.checkpointDir, b);
  state = cp.state;
  from = b;
  prev = cp.meta.l2_block_id;
} else {
  state = new StateStore();
  const meta = await loadSeed(state, config.seedFile);
  from = meta.block_num;
  prev = meta.l2_block_id;
}
console.error(`replaying ${from + 1}..${until} (${until - from} blocks)`);
const processor = new BlockProcessor(new Services(state, { custom_json_id: config.customJsonId, custom_json_prefix: config.customJsonPrefix }));

const FIELDS = ["id", "type", "player", "data", "success", "error", "result", "index"] as const;

function firstDiff(a: unknown, b: unknown, path = ""): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = Array.from(new Set([...Object.keys(a as object), ...Object.keys(b as object)]));
    const ka = Object.keys(a as object).join(",");
    const kb = Object.keys(b as object).join(",");
    for (const k of keys) {
      const d = firstDiff((a as any)[k], (b as any)[k], `${path}.${k}`);
      if (d) return d;
    }
    if (ka !== kb) return `${path}: key order\n    ours:   ${ka}\n    theirs: ${kb}`;
  }
  return `${path || "(value)"}\n    ours:   ${JSON.stringify(a)}\n    theirs: ${JSON.stringify(b)}`;
}

const parse = (v: unknown) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

async function report(n: number, result: ProcessedBlock) {
  const theirs = ((await ref.transactions(n)) ?? []) as Record<string, unknown>[];
  const refBlock = await ref.block(n);
  console.log(`block ${n}: ours ${result.l2_block_id} theirs ${refBlock?.l2_block_id} ${refBlock?.l2_block_id === result.l2_block_id ? "MATCH" : "MISMATCH"}`);
  console.log(`validator: ours ${result.validator} theirs ${refBlock?.validator}`);
  const ours = result.transactions as unknown as Record<string, unknown>[];
  console.log(`transactions: ours ${ours.length} theirs ${theirs.length}`);
  theirs.sort((a, b) => (a.index as number) - (b.index as number));
  const len = Math.max(ours.length, theirs.length);
  let shown = 0;
  for (let i = 0; i < len && shown < 5; i++) {
    const o = ours[i];
    const t = theirs[i];
    if (!o || !t) {
      console.log(`#${i}: only in ${o ? "ours" : "theirs"}: ${JSON.stringify(o ?? t).slice(0, 400)}`);
      shown++;
      continue;
    }
    for (const f of FIELDS) {
      const d = firstDiff(parse(o[f]), parse(t[f]), f);
      if (d) {
        console.log(`#${i} ${t.type} ${t.id} by ${t.player}: ${d}`);
        shown++;
        break;
      }
      // byte-level check (formatting of numbers, key order inside strings)
      if (o[f] !== t[f] && typeof t[f] === "string") {
        console.log(`#${i} ${t.type} ${t.id}: ${f} differs textually\n    ours:   ${String(o[f]).slice(0, 600)}\n    theirs: ${String(t[f]).slice(0, 600)}`);
        shown++;
        break;
      }
    }
  }
}

for await (const { block, blockNum } of streamBlocks(from + 1, until)) {
  const result = processor.process(blockNum, block, prev);
  prev = result.l2_block_id;
  if (blockNum < target) continue;
  if (blockNum === until) {
    await report(blockNum, result);
    break;
  }
  const r = await ref.block(blockNum);
  if (r && r.l2_block_id !== result.l2_block_id) {
    await report(blockNum, result);
    break;
  }
}
process.exit(0);
