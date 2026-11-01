/**
 * Approximation of PostgreSQL ordering under en_US.utf8 (glibc) for the short
 * ASCII identifiers used by the validator (account names, tokens, ids).
 * Punctuation is ignored at the first level; byte order breaks ties.
 */
export function pgCompare(a: string, b: string): number {
  const ka = a.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
  const kb = b.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Plain byte order (C collation). */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
