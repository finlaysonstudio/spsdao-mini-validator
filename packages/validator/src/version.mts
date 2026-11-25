import { readFileSync } from "node:fs";

/** Upstream TheSPSDAO/SPS-Validator release this port follows (hash parity target). */
export const UPSTREAM_VERSION = "1.5.1";

/** This package's version from its package.json; "unknown" when bundled without it (e.g. in a Lambda). */
export function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

/** Version sent with validate_block / check_in_validator unless VALIDATOR_VERSION overrides it: `1.5.1/spud-v0.3.0`. */
export function defaultValidatorVersion(version = packageVersion()): string {
  return `${UPSTREAM_VERSION}/spud-v${version}`;
}
