/**
 * State checkpoints: the whole StateStore, serialized with V8's structured
 * clone (Maps, Sets, BigInts, Dates and typed arrays round-trip exactly) and
 * gzip-compressed (level 1; zstd is not available in upstream's Node 23.3).
 *
 * The store's classes are walked generically: every own field of every class
 * instance is captured, so new fields are picked up without changes here. On
 * restore the fields are poured back into a freshly constructed StateStore.
 *
 * File: <dir>/checkpoint-<block_num>.v8.gz, written atomically.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { gunzipSync, gzipSync } from "node:zlib";
import { StateStore } from "./index.mjs";

const VERSION = 1;

export type CheckpointMeta = {
  version: number;
  block_num: number;
  l2_block_id: string;
  block_id: string;
  /** Whether l2_block_id was confirmed against the reference API when written. */
  verified: boolean;
  written_at: string;
};

type Instance = { __class: string; fields: Record<string, unknown> };

const isInstance = (v: unknown): v is object =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  !(v instanceof Map) &&
  !(v instanceof Set) &&
  !(v instanceof Date) &&
  !ArrayBuffer.isView(v) &&
  Object.getPrototypeOf(v) !== Object.prototype &&
  Object.getPrototypeOf(v) !== null;

function capture(obj: object): Instance {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = isInstance(v) ? capture(v) : v;
  return { __class: obj.constructor.name, fields };
}

function restore(target: object, snap: Instance): void {
  if (target.constructor.name !== snap.__class) throw new Error(`checkpoint class mismatch: ${target.constructor.name} vs ${snap.__class}`);
  const t = target as Record<string, unknown>;
  const ownKeys = new Set(Object.keys(t));
  for (const [k, v] of Object.entries(snap.fields)) {
    if (!ownKeys.has(k)) throw new Error(`checkpoint field ${snap.__class}.${k} does not exist in this build`);
    const cur = t[k];
    if (v && typeof v === "object" && "__class" in (v as object) && isInstance(cur)) restore(cur, v as Instance);
    else t[k] = v;
  }
  for (const k of ownKeys) if (!(k in snap.fields)) throw new Error(`checkpoint lacks field ${snap.__class}.${k}`);
}

const fileFor = (dir: string, block: number) => join(dir, `checkpoint-${String(block).padStart(10, "0")}.v8.gz`);

export function writeCheckpoint(dir: string, state: StateStore, meta: Omit<CheckpointMeta, "version" | "written_at">): string {
  mkdirSync(dir, { recursive: true });
  const full: CheckpointMeta = { ...meta, version: VERSION, written_at: new Date().toISOString() };
  const buf = gzipSync(serialize({ meta: full, state: capture(state) }), { level: 1 });
  const f = fileFor(dir, meta.block_num);
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, buf);
  renameSync(tmp, f);
  writeFileSync(join(dir, `checkpoint-${String(meta.block_num).padStart(10, "0")}.json`), JSON.stringify(full) + "\n");
  return f;
}

export function listCheckpoints(dir: string): number[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => /^checkpoint-(\d+)\.v8\.gz$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => parseInt(m[1], 10))
    .sort((a, b) => a - b);
}

export function loadCheckpoint(dir: string, block: number): { state: StateStore; meta: CheckpointMeta } {
  const { meta, state: snap } = deserialize(gunzipSync(readFileSync(fileFor(dir, block)))) as { meta: CheckpointMeta; state: Instance };
  if (meta.version !== VERSION) throw new Error(`checkpoint version ${meta.version} != ${VERSION}`);
  const state = new StateStore();
  restore(state, snap);
  return { state, meta };
}

/** Keep the newest `keep` checkpoints and every one on a multiple of `keepEvery`. */
export function pruneCheckpoints(dir: string, keep: number, keepEvery: number): void {
  const all = listCheckpoints(dir);
  const recent = new Set(all.slice(-keep));
  for (const b of all) {
    if (recent.has(b) || (keepEvery > 0 && b % keepEvery === 0)) continue;
    for (const ext of [".v8.gz", ".json"]) {
      try {
        unlinkSync(fileFor(dir, b).replace(/\.v8\.gz$/, ext));
      } catch {
        /* already gone */
      }
    }
  }
}
