/**
 * Structural comparison of two StateStores, used to prove that a seed export reloads to the same
 * state. Every field of every store is walked; Map and Set order is significant except where
 * nothing reads it in order (ORDER_FREE). Hash tables compare as sorted entry lists, since slot
 * layout depends on insertion history but lookups do not. Index entries holding an empty
 * collection count as absent (older builds left them behind after deletes).
 */
import { Hash64Map } from "../util/hash64.mjs";
import type { StateStore } from "./index.mjs";

/**
 * Collections whose iteration order no reader depends on: `Votes.byValidator` (length and sum
 * only), `Rentals.byPair` (keyed lookups; set size and exact sum only).
 */
const ORDER_FREE = new Set(["Rentals.byPair", "Votes.byValidator"]);

function normalize(v: unknown, path: string, orderFree: boolean): unknown {
  if (v instanceof Hash64Map) {
    const entries = Array.from(v.entries()).map(([a, b, x]) => `${a}:${b}:${x}`);
    return entries.sort();
  }
  if (v instanceof Map) {
    // An index entry holding an empty collection reads the same as no entry.
    const live = Array.from(v.entries()).filter(([, x]) => !((x instanceof Set || x instanceof Map) && x.size === 0));
    const out = live.map(([k, x]) => [normalize(k, path, false), normalize(x, path, orderFree)]);
    return orderFree ? out.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)) : out;
  }
  if (v instanceof Set) {
    const out = Array.from(v).map((x) => normalize(x, path, false));
    return orderFree ? out.map(String).sort() : out;
  }
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  if (typeof v === "bigint") return `${v}n`;
  if (Array.isArray(v)) return v.map((x) => normalize(x, path, false));
  if (v && typeof v === "object") {
    const cls = Object.getPrototypeOf(v) === Object.prototype ? "" : v.constructor.name;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const p = cls ? `${cls}.${k}` : path;
      if (cls && k === "capacity") continue;
      out[k] = normalize(x, p, orderFree || ORDER_FREE.has(p));
    }
    return out;
  }
  return v;
}

/** Paths (store.field) whose normalized contents differ; empty when the states are equivalent. */
export function diffStates(a: StateStore, b: StateStore): string[] {
  const diffs: string[] = [];
  for (const store of Object.keys(a) as (keyof StateStore)[]) {
    const sa = a[store] as unknown as Record<string, unknown>;
    const sb = b[store] as unknown as Record<string, unknown>;
    for (const field of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      const p = `${sa.constructor.name}.${field}`;
      const na = JSON.stringify(normalize(sa[field], p, ORDER_FREE.has(p)));
      const nb = JSON.stringify(normalize(sb[field], p, ORDER_FREE.has(p)));
      if (na !== nb) diffs.push(`${String(store)}.${field}`);
    }
  }
  return diffs;
}
