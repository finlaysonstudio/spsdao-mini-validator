#!/usr/bin/env node
/**
 * sps-mini: command-line entry for bare-metal installs (the Docker image runs main.mjs directly).
 *
 *   sps-mini run                                   follow the chain (configured by environment, see README)
 *   sps-mini export <checkpoint-dir> <out> [block] [--verify]
 *   sps-mini verify <seed.ndjson.gz> [--reference <url>]
 *   sps-mini version
 */
import { readFileSync } from "node:fs";
import { error } from "./util/log.mjs";

const USAGE = `usage: sps-mini <run | export | verify | version> [args]

  run                                        follow the chain; configured by environment (README)
  export <checkpoint-dir> <out> [block] [--verify]
                                             write a portable seed from a checkpoint
  verify <seed.ndjson.gz> [--reference <url>]
                                             check a seed's checksum and hash before use
  version                                    print package and node versions`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}

async function cli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "run":
      await import("./main.mjs");
      return -1; // main keeps running and exits on its own
    case "export":
      return (await import("./commands/export.mjs")).exportCommand(rest);
    case "verify":
      return (await import("./commands/verify.mjs")).verifyCommand(rest);
    case "version":
    case "--version":
      console.log(`sps-mini ${version()} (node ${process.version})`);
      return 0;
    default:
      console.error(USAGE);
      return command === undefined || command === "help" || command === "--help" ? 0 : 2;
  }
}

cli(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    error("fatal", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    process.exit(1);
  },
);
