import { describe, it, expect } from "vitest";
import { buildTrxId } from "./trxId.mjs";

describe("buildTrxId", () => {
  it("returns transactionId when opIndex=0 and actionIndex=0", () => {
    expect(buildTrxId("txid", 0, 0)).toBe("txid");
  });

  it("appends -opIndex when opIndex > 0", () => {
    expect(buildTrxId("txid", 2, 0)).toBe("txid-2");
  });

  it("appends .actionIndex when actionIndex > 0", () => {
    expect(buildTrxId("txid", 0, 3)).toBe("txid.3");
  });

  it("appends both when both > 0 (e.g., 'txid-2.3')", () => {
    expect(buildTrxId("txid", 2, 3)).toBe("txid-2.3");
  });
});
