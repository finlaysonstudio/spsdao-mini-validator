/**
 * Exact decimal helpers that mirror how PostgreSQL `numeric` columns behave
 * when the upstream validator sends JavaScript numbers through node-postgres.
 *
 * node-postgres serialises a JS number with `String(n)` (shortest round-trip
 * representation, possibly with an exponent). Postgres parses that text into an
 * exact decimal, performs exact arithmetic, and rounds half away from zero to
 * the column scale when storing.
 */

export type Decimal = { neg: boolean; digits: bigint; scale: number };

/** Parse a decimal / scientific-notation string into an exact decimal. */
export function parseDecimal(input: string): Decimal {
  let s = input.trim();
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  let exp = 0;
  const eIdx = s.search(/[eE]/);
  if (eIdx >= 0) {
    exp = parseInt(s.slice(eIdx + 1), 10);
    s = s.slice(0, eIdx);
  }
  const dot = s.indexOf(".");
  let intPart = dot >= 0 ? s.slice(0, dot) : s;
  let fracPart = dot >= 0 ? s.slice(dot + 1) : "";
  if (intPart === "") intPart = "0";
  let scale = fracPart.length - exp;
  let digitsStr = intPart + fracPart;
  if (scale < 0) {
    digitsStr = digitsStr + "0".repeat(-scale);
    scale = 0;
  }
  const digits = BigInt(digitsStr.replace(/^0+(?=\d)/, "") || "0");
  return { neg: neg && digits !== 0n, digits, scale };
}

const PG_NUMERIC_TEXT = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;

/**
 * The exact decimal text node-postgres would send for a JS value bound to a
 * numeric parameter. Upstream types these as numbers, but payload strings leak
 * through unconverted (e.g. a delegation offer's `qty: "10000.000"`): JS then
 * concatenates (`0 + "10000.000"` is "010000.000") and node-postgres sends the
 * string as-is for Postgres to parse. Text Postgres would reject throws here.
 */
export function numberToDecimalString(n: number | string): string {
  if (typeof n === "string") {
    if (!PG_NUMERIC_TEXT.test(n)) throw new Error(`invalid input syntax for type numeric: "${n}"`);
    return n;
  }
  if (!Number.isFinite(n)) throw new Error(`Non-finite number ${n}`);
  return String(n);
}

/** Rescale a decimal to `scale` digits, rounding half away from zero. */
export function rescale(d: Decimal, scale: number): bigint {
  let v = d.digits;
  if (d.scale === scale) {
    // nothing
  } else if (d.scale < scale) {
    v = v * 10n ** BigInt(scale - d.scale);
  } else {
    const div = 10n ** BigInt(d.scale - scale);
    const q = v / div;
    const r = v % div;
    v = r * 2n >= div ? q + 1n : q;
  }
  return d.neg ? -v : v;
}

/** Scaled integer (e.g. thousandths for scale 3) from a decimal string. */
export function toScaled(text: string, scale: number): bigint {
  return rescale(parseDecimal(text), scale);
}

/** Scaled integer from a JS number, exactly as postgres would parse it. */
export function numberToScaled(n: number, scale: number): bigint {
  return toScaled(numberToDecimalString(n), scale);
}

/** Format a scaled integer the way postgres prints a numeric(…, scale). */
export function formatScaled(v: bigint, scale: number): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(scale + 1, "0");
  const intPart = s.slice(0, s.length - scale);
  const frac = s.slice(s.length - scale);
  const body = scale > 0 ? `${intPart}.${frac}` : intPart;
  return neg ? `-${body}` : body;
}

/** parseFloat() of the postgres text representation. */
export function scaledToNumber(v: bigint, scale: number): number {
  return parseFloat(formatScaled(v, scale));
}

/** Exact sum of a stored numeric and a JS number, stored at `scale`. */
export function addScaled(stored: bigint, amount: number, scale: number): bigint {
  const d = parseDecimal(numberToDecimalString(amount));
  const s = Math.max(scale, d.scale);
  const a = rescale({ neg: false, digits: stored < 0n ? -stored : stored, scale }, s) * (stored < 0n ? -1n : 1n);
  const b = rescale(d, s);
  return rescale({ neg: a + b < 0n, digits: a + b < 0n ? -(a + b) : a + b, scale: s }, scale);
}

/** Number → plain decimal text without exponent (as jsonb would print it). */
export function plainDecimalString(n: number): string {
  const s = String(n);
  if (!/[eE]/.test(s)) return s;
  const d = parseDecimal(s);
  const txt = formatScaled(d.neg ? -d.digits : d.digits, d.scale);
  // strip trailing zeros in fraction (numeric keeps the scale, but JS inputs
  // with exponents never carry trailing zeros)
  return txt;
}
