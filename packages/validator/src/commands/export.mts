/**
 * `sps-mini-validator export <checkpoint-dir> <out.ndjson.gz> [block] [--verify]`: export a seed (format 2)
 * from a checkpoint, optionally proving it reloads to the same state.
 *
 * Without a block, the newest checkpoint is used. --verify reloads the seed and compares every
 * store field with the checkpoint (src/state/compare.mts); exits 1 on any difference.
 */
import { exportSeed } from "../bootstrap/export.mjs";
import { loadSeed } from "../bootstrap/seed.mjs";
import { listCheckpoints, loadCheckpoint } from "../state/checkpoint.mjs";
import { diffStates } from "../state/compare.mjs";
import { StateStore } from "../state/index.mjs";
import { error, log } from "../util/log.mjs";

export async function exportCommand(argv: string[]): Promise<number> {
  const args = argv.filter((a) => !a.startsWith("--"));
  const verify = argv.includes("--verify");
  const [dir, out, blockArg] = args;
  if (!dir || !out) throw new Error("usage: sps-mini-validator export <checkpoint-dir> <out.ndjson.gz> [block] [--verify]");

  const block = blockArg ? parseInt(blockArg, 10) : listCheckpoints(dir).at(-1);
  if (block === undefined) throw new Error(`no checkpoints in ${dir}`);

  let t0 = Date.now();
  const { state, meta } = loadCheckpoint(dir, block);
  log("checkpoint loaded", { block_num: meta.block_num, seconds: (Date.now() - t0) / 1000 });

  t0 = Date.now();
  const manifest = await exportSeed(state, { block_num: meta.block_num, l2_block_id: meta.l2_block_id, block_id: meta.block_id }, out);
  log("seed exported", { ...manifest, seconds: (Date.now() - t0) / 1000 });

  if (verify) {
    t0 = Date.now();
    const reloaded = new StateStore();
    await loadSeed(reloaded, out);
    const diffs = diffStates(state, reloaded);
    if (diffs.length > 0) {
      error("seed does not reload to the checkpoint state", { diffs });
      return 1;
    }
    log("seed verified", { block_num: meta.block_num, seconds: (Date.now() - t0) / 1000 });
  }
  return 0;
}
