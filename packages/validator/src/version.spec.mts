import { describe, expect, it } from "vitest";
import { defaultValidatorVersion, packageVersion, UPSTREAM_VERSION } from "./version.mjs";

describe("validator version", () => {
  it("joins the upstream version and the spud release", () => {
    expect(defaultValidatorVersion("0.3.0")).toBe(`${UPSTREAM_VERSION}/spud-v0.3.0`);
  });

  it("defaults to this package's version", () => {
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(defaultValidatorVersion()).toBe(`${UPSTREAM_VERSION}/spud-v${packageVersion()}`);
  });
});
