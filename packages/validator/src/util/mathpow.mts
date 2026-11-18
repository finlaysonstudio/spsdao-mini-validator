/**
 * Consensus guard for floating point exponentiation.
 *
 * Since Node 24.0, V8 defaults `--use-std-math-pow` to on, so `Math.pow` and `**` delegate to the
 * platform std::pow, which differs by 1 ulp from the V8-internal pow of Node <= 23 (upstream runs
 * node:23.3). Staking reward pool decline (`(1 - pct / 100) ** reductions`) then hashes differently.
 *
 * `node --no-use-std-math-pow` restores the V8-internal pow. It is a V8 flag rejected in
 * NODE_OPTIONS, so it goes on the node command line (Dockerfile, bin shebang, vitest execArgv).
 */

export const MATH_POW_FLAG = "--no-use-std-math-pow";

/** Known vectors where std::pow and the V8-internal pow disagree. Expected values match Node 23.3. */
export const MATH_POW_VECTORS: ReadonlyArray<{ base: number; exponent: number; expected: number }> = [
  { base: 0.99, exponent: 32, expected: 0.7249803359578535 },
  { base: 0.99, exponent: 100, expected: 0.36603234127322914 },
];

export interface MathPowMismatch {
  actual: number;
  base: number;
  expected: number;
  exponent: number;
}

export function findMathPowMismatches(pow: (base: number, exponent: number) => number = Math.pow): MathPowMismatch[] {
  const mismatches: MathPowMismatch[] = [];
  for (const { base, exponent, expected } of MATH_POW_VECTORS) {
    const actual = pow(base, exponent);
    if (!Object.is(actual, expected)) mismatches.push({ actual, base, expected, exponent });
  }
  return mismatches;
}

let verified = false;

/** Throws when the runtime's pow would fork consensus hashes. Checked once per process. */
export function assertConsensusMathPow(): void {
  if (verified) return;
  const mismatches = findMathPowMismatches();
  if (mismatches.length > 0) {
    const detail = mismatches.map((m) => `${m.base} ** ${m.exponent} = ${m.actual} (expected ${m.expected})`).join("; ");
    throw new Error(
      `Math.pow does not match the reference implementation: ${detail}. ` +
        `On Node >= 24 run node with ${MATH_POW_FLAG} (it is rejected in NODE_OPTIONS); node ${process.version}.`,
    );
  }
  verified = true;
}
