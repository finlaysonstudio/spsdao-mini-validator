/**
 * PostgreSQL ordering under en_US.utf8 (glibc 2.36, ISO 14651) for ASCII text,
 * derived from and checked against the upstream Postgres image:
 *
 * 1. primary: non-ignorable characters only, case-folded; `$` < digits < letters.
 *    All other ASCII punctuation (including `-`, `.`, `_`) is ignored here.
 * 2. (accents: nothing to do for ASCII)
 * 3. case of the non-ignorable characters: lowercase before uppercase.
 * 4. every character by its position in the collation table (TABLE below):
 *    ignorable punctuation first, then `$`, digits, `aAbB...zZ`.
 *
 * Non-ASCII characters fall back to code point order after all ASCII.
 *
 * Exact on every real corpus checked (balances.player incl. `$` system accounts,
 * hive account names, tokens, promise/rental/unstake ids). Level 4 uses plain table
 * order rather than glibc's position rule, so contrived strings with several
 * punctuation characters around `$` (e.g. "$_$a" vs "$$a") can differ.
 */
const TABLE = "!\"#%&'()*+,-./:;<=>?@[\\]^_`{|}~$0123456789" + Array.from("abcdefghijklmnopqrstuvwxyz", (c) => c + c.toUpperCase()).join("");

const IGNORABLE = new Set(Array.from(TABLE.slice(0, TABLE.indexOf("$"))));
const POSITION = new Map(Array.from(TABLE, (c, i) => [c, i]));

function primary(c: string): number {
  if (c === "$") return 1;
  if (c >= "0" && c <= "9") return 2 + (c.charCodeAt(0) - 48);
  const l = c.toLowerCase();
  if (l >= "a" && l <= "z") return 12 + (l.charCodeAt(0) - 97);
  return 1000 + c.codePointAt(0)!;
}

const position = (c: string) => POSITION.get(c) ?? 1000 + c.codePointAt(0)!;
const isUpper = (c: string) => c >= "A" && c <= "Z";

function compareSeq(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

type Key = [number[], number[], number[]];
const cache = new Map<string, Key>();

function key(s: string): Key {
  let k = cache.get(s);
  if (k) return k;
  const l1: number[] = [];
  const l3: number[] = [];
  const l4: number[] = [];
  for (const c of s) {
    l4.push(position(c));
    if (IGNORABLE.has(c)) continue;
    l1.push(primary(c));
    l3.push(isUpper(c) ? 1 : 0);
  }
  k = [l1, l3, l4];
  if (cache.size > 200_000) cache.clear();
  cache.set(s, k);
  return k;
}

export function pgCompare(a: string, b: string): number {
  if (a === b) return 0;
  const ka = key(a);
  const kb = key(b);
  return compareSeq(ka[0], kb[0]) || compareSeq(ka[1], kb[1]) || compareSeq(ka[2], kb[2]) || (a < b ? -1 : 1);
}

/** Plain byte order (C collation). */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
