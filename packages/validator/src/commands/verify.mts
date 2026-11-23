/**
 * `sps-mini-validator verify <seed.ndjson.gz> [--reference <url>]`: check a downloaded seed before use.
 *
 * - The manifest next to the seed (if present) must match the file's size and sha256, and its
 *   block and hash must equal the seed's meta line.
 * - The meta line's `l2_block_id` must equal the reference archive API's hash for that block
 *   (default REFERENCE_API, else the Splinterlands archive). `--reference ""` skips this.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { manifestPath, sha256File, type SeedManifest } from "../bootstrap/export.mjs";
import type { SeedMeta } from "../bootstrap/seed.mjs";
import { ReferenceApi } from "../hive/reference.mjs";
import { error, logStatus, warn } from "../util/log.mjs";

export const DEFAULT_REFERENCE_API = "https://splinterlands-validator-api.splinterlands.com";

export async function readSeedMeta(path: string): Promise<SeedMeta> {
  let input: Readable = createReadStream(path);
  if (path.endsWith(".gz")) input = input.pipe(createGunzip());
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      const { t, r } = JSON.parse(line);
      if (t !== "meta") throw new Error(`${path}: first row is ${t}, expected meta`);
      return r as SeedMeta;
    }
  } finally {
    rl.close();
    input.destroy();
  }
  throw new Error(`${path}: empty seed`);
}

function option(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? "") : undefined;
}

export async function verifyCommand(argv: string[]): Promise<number> {
  const seed = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--reference");
  if (!seed) throw new Error("usage: sps-mini-validator verify <seed.ndjson.gz> [--reference <url>]");
  const reference = option(argv, "--reference") ?? (process.env.REFERENCE_API || DEFAULT_REFERENCE_API);
  const meta = await readSeedMeta(seed);
  const problems: string[] = [];

  const mpath = manifestPath(seed);
  if (existsSync(mpath)) {
    const m = JSON.parse(readFileSync(mpath, "utf8")) as SeedManifest;
    const bytes = statSync(seed).size;
    const sha256 = await sha256File(seed);
    if (m.bytes !== bytes) problems.push(`size ${bytes} != manifest ${m.bytes}`);
    if (m.sha256 !== sha256) problems.push(`sha256 ${sha256} != manifest ${m.sha256}`);
    if (m.block_num !== meta.block_num || m.l2_block_id !== meta.l2_block_id) problems.push("manifest block/hash differ from the seed's meta line");
  } else {
    warn("no manifest next to the seed; checksum not checked", { seed, manifest: mpath });
  }

  if (reference) {
    const ref = await new ReferenceApi(reference).block(meta.block_num);
    if (!ref) problems.push(`reference has no block ${meta.block_num}`);
    else if (ref.l2_block_id !== meta.l2_block_id) problems.push(`l2_block_id ${meta.l2_block_id} != reference ${ref.l2_block_id}`);
  }

  if (problems.length > 0) {
    error("seed rejected", { seed, block_num: meta.block_num, problems });
    return 1;
  }
  logStatus("ok", "seed verified", { seed, block_num: meta.block_num, l2_block_id: meta.l2_block_id, reference: reference || null });
  return 0;
}
