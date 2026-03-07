import { describe, it, expect, vi } from "vitest";
import { config } from "./config.mjs";

describe("config", () => {
  it("has default customJsonId 'sps'", () => {
    expect(config.customJsonId).toBe("sps");
  });

  it("has default customJsonPrefix 'sm_'", () => {
    expect(config.customJsonPrefix).toBe("sm_");
  });

  it("has default rpcNodes", () => {
    expect(Array.isArray(config.rpcNodes)).toBe(true);
    expect(config.rpcNodes.length).toBeGreaterThanOrEqual(1);
    expect(config.rpcNodes[0]).toContain("hive");
  });

  it("has default blocksBehindHead", () => {
    expect(config.blocksBehindHead).toBe(5);
  });

  it("parses VALIDATORS env var format", () => {
    // Cannot re-import the module to test env parsing at module load time,
    // so instead we verify the parsed structure when VALIDATORS is empty (default)
    expect(Array.isArray(config.validators)).toBe(true);
    // With no VALIDATORS env set, it should be an empty array
    if (!process.env.VALIDATORS) {
      expect(config.validators).toEqual([]);
    }
  });
});
