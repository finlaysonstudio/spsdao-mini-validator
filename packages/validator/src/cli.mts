#!/usr/bin/env node
/**
 * spudsps: command-line entry for native installs (the Docker image runs main.mjs directly).
 *
 *   spudsps run                         follow the chain (configured by environment, see README)
 *   spudsps export <checkpoint-dir> <out> [block] [--verify]
 *   spudsps verify <seed.ndjson.gz> [--reference <url>]
 *   spudsps version
 */
import { error } from "./util/log.mjs";
import { packageVersion } from "./version.mjs";

const USAGE = `usage: spudsps <run | export | verify | version> [args]

  run                                        follow the chain; configured by environment (README)
  export <checkpoint-dir> <out> [block] [--verify]
                                             write a portable seed from a checkpoint
  verify <seed.ndjson.gz> [--reference <url>]
                                             check a seed's checksum and hash before use
  version                                    print package and node versions`;

function version(): string {
  return packageVersion();
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
      console.log(`spudsps ${version()} (node ${process.version})`);
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
