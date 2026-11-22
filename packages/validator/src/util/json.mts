/**
 * JSON serialisation that is byte-for-byte identical to JSON.stringify, with
 * one addition: `RawJson` values are emitted verbatim. This is needed to
 * reproduce jsonb number formatting (postgres prints `1e-7` as `0.0000001`).
 */
export class RawJson {
  constructor(public readonly text: string) {}
}

function serialize(value: unknown): string | undefined {
  if (value === null) return "null";
  if (value instanceof RawJson) return value.text;
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      throw new TypeError("Do not know how to serialize a BigInt");
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return serialize((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => serialize(v) ?? "null").join(",")}]`;
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const s = serialize(v);
    if (s !== undefined) parts.push(`${JSON.stringify(k)}:${s}`);
  }
  return `{${parts.join(",")}}`;
}

export function stringify(value: unknown): string {
  const s = serialize(value);
  if (s === undefined) throw new Error("Cannot stringify undefined");
  return s;
}

/**
 * Reorder an object the way postgres jsonb stores it: keys sorted by length,
 * then bytewise; nested objects recursively; numbers printed without
 * exponents. Returns a structure suitable for `stringify`.
 */
export function jsonbCanonical(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") {
    const s = String(value);
    return /[eE]/.test(s) ? new RawJson(plainNumber(s)) : value;
  }
  if (Array.isArray(value)) return value.map(jsonbCanonical);
  if (typeof value === "object") {
    if (value instanceof Date) return value.toJSON();
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    // last duplicate wins in jsonb; JS objects cannot have duplicates anyway
    entries.sort(([a], [b]) => {
      const ab = Buffer.from(a, "utf8");
      const bb = Buffer.from(b, "utf8");
      if (ab.length !== bb.length) return ab.length - bb.length;
      return Buffer.compare(ab, bb);
    });
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = jsonbCanonical(v);
    return out;
  }
  return value;
}

function plainNumber(s: string): string {
  // expand exponent notation into plain decimal digits
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  const [mant, expStr] = s.split(/[eE]/);
  const exp = parseInt(expStr, 10);
  const [i, f = ""] = mant.split(".");
  let digits = i + f;
  let pointPos = i.length + exp;
  if (pointPos <= 0) {
    digits = "0".repeat(1 - pointPos) + digits;
    pointPos = 1;
  } else if (pointPos > digits.length) {
    digits = digits + "0".repeat(pointPos - digits.length);
  }
  let intPart = digits.slice(0, pointPos).replace(/^0+(?=\d)/, "");
  let frac = digits.slice(pointPos).replace(/0+$/, "");
  const body = frac.length > 0 ? `${intPart}.${frac}` : intPart;
  return neg ? `-${body}` : body;
}
