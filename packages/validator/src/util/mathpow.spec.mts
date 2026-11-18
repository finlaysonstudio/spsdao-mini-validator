import { describe, expect, it } from "vitest";
import { assertConsensusMathPow, findMathPowMismatches, MATH_POW_VECTORS } from "./mathpow.mjs";

describe("math pow guard", () => {
  it("runtime pow matches the reference implementation (Node >= 24 needs --no-use-std-math-pow)", () => {
    expect(findMathPowMismatches()).toEqual([]);
    expect(() => assertConsensusMathPow()).not.toThrow();
  });

  it("reports a 1 ulp mismatch like std::pow", () => {
    const stdPow = (base: number, exponent: number): number => {
      if (base === 0.99 && exponent === 32) return 0.7249803359578534;
      return MATH_POW_VECTORS.find((v) => v.base === base && v.exponent === exponent)?.expected ?? NaN;
    };
    expect(findMathPowMismatches(stdPow)).toEqual([{ actual: 0.7249803359578534, base: 0.99, expected: 0.7249803359578535, exponent: 32 }]);
  });
});
