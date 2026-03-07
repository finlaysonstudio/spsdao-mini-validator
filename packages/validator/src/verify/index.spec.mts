import { describe, it, expect, vi } from "vitest";
import { verifyHash, logVerifyResult } from "./index.mjs";

describe("verifyHash", () => {
  it("returns null when block not in knownHashes", () => {
    const knownHashes = new Map<number, string>();
    expect(verifyHash(100, "abc", knownHashes)).toBeNull();
  });

  it("returns match:true when hashes match", () => {
    const knownHashes = new Map<number, string>([[100, "abc"]]);
    const result = verifyHash(100, "abc", knownHashes);
    expect(result).not.toBeNull();
    expect(result!.match).toBe(true);
  });

  it("returns match:false when hashes differ", () => {
    const knownHashes = new Map<number, string>([[100, "expected"]]);
    const result = verifyHash(100, "computed", knownHashes);
    expect(result).not.toBeNull();
    expect(result!.match).toBe(false);
  });

  it("includes blockNum, computed, expected in result", () => {
    const knownHashes = new Map<number, string>([[42, "expected_hash"]]);
    const result = verifyHash(42, "computed_hash", knownHashes);
    expect(result).toEqual({
      blockNum: 42,
      computed: "computed_hash",
      expected: "expected_hash",
      match: false,
    });
  });
});

describe("logVerifyResult", () => {
  it("logs success message for match", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logVerifyResult({
      blockNum: 100,
      computed: "abcdef1234567890abcdef",
      expected: "abcdef1234567890abcdef",
      match: true,
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("HASH OK");
    expect(spy.mock.calls[0][0]).toContain("100");
    spy.mockRestore();
  });

  it("logs error messages for mismatch", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logVerifyResult({
      blockNum: 200,
      computed: "computed_val",
      expected: "expected_val",
      match: false,
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0]).toContain("HASH MISMATCH");
    expect(spy.mock.calls[0][0]).toContain("200");
    expect(spy.mock.calls[1][0]).toContain("computed_val");
    expect(spy.mock.calls[2][0]).toContain("expected_val");
    spy.mockRestore();
  });
});
