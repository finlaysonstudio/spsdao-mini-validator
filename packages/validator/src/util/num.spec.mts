import { describe, expect, it } from "vitest";
import { addScaled, formatScaled, numberToScaled, scaledToNumber, toScaled } from "./num.mjs";

describe("scaled numerics", () => {
  it("round-trips numeric(x,3) text", () => {
    for (const t of ["0.000", "1.500", "-945386431.635", "84187267.010"]) expect(formatScaled(toScaled(t, 3), 3)).toBe(t);
  });

  it("parses into exact thousandths", () => {
    expect(toScaled("200.927", 3)).toBe(200927n);
    expect(toScaled("-0.001", 3)).toBe(-1n);
  });

  it("converts JS floats the way Postgres numeric does", () => {
    // 200.927 - 0.485000...01364 stored into numeric(x,3)
    expect(formatScaled(numberToScaled(0.48500000000001364, 3), 3)).toBe("0.485");
    expect(formatScaled(addScaled(toScaled("200.927", 3), -0.48500000000001364, 3), 3)).toBe("200.442");
  });

  it("parseFloat(text) semantics for reads", () => {
    expect(scaledToNumber(toScaled("0.442", 3), 3)).toBe(0.442);
  });
});
