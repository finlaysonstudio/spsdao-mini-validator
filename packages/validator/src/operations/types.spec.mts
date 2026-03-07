import { describe, it, expect } from "vitest";
import { successResult, errorResult } from "./types.mjs";

describe("successResult", () => {
  it("returns {success: true, events: []}", () => {
    const result = successResult();
    expect(result).toEqual({ success: true, events: [] });
  });

  it("includes provided events", () => {
    const events = [
      { object_type: "balance", event_type: "transfer", data: { amount: 10 } },
    ];
    const result = successResult(events);
    expect(result.success).toBe(true);
    expect(result.events).toEqual(events);
  });
});

describe("errorResult", () => {
  it("returns {success: false, error: {code, message}, events: []}", () => {
    const result = errorResult(404, "not found");
    expect(result).toEqual({
      success: false,
      error: { code: 404, message: "not found" },
      events: [],
    });
  });

  it("works without message", () => {
    const result = errorResult(500);
    expect(result.success).toBe(false);
    expect(result.error).toEqual({ code: 500, message: undefined });
    expect(result.events).toEqual([]);
  });
});
