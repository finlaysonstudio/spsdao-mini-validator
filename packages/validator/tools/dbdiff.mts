/**
 * Backtest harness: replay from a seed and compare every produced transaction
 * row and block hash against the upstream validator database.
 *
 *   DATABASE_URL=... SEED_FILE=seed.ndjson BLOCK_CACHE_DIR=.cache tsx tools/dbdiff.mts [max_blocks]
 */
import pg from "pg";
import { config } from "../src/config.mjs";
import { BlockProcessor } from "../src/block/processor.mjs";
import { loadSeed } from "../src/bootstrap/seed.mjs";
import { streamBlocks } from "../src/hive/stream.mjs";
import { Services } from "../src/services.mjs";
import { StateStore } from "../src/state/index.mjs";
import { log } from "../src/util/log.mjs";
import type { TransactionEntity } from "../src/types.mjs";

pg.types.setTypeParser(1114, (s: string) => new Date(s.replace(" ", "T") + "Z"));
pg.types.setTypeParser(1700, (s: string) => s);

const maxBlocks = parseInt(process.argv[2] ?? "0", 10);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const state = new StateStore();
const meta = await loadSeed(state, config.seedFile);
const svc = new Services(state, { custom_json_id: config.customJsonId, custom_json_prefix: config.customJsonPrefix });
const processor = new BlockProcessor(svc);

const dbHead = (await client.query("select max(block_num) as n from blocks")).rows[0].n as number;
const stop = maxBlocks ? Math.min(dbHead, meta.block_num + maxBlocks) : process.env.FOLLOW === "1" ? 0 : dbHead;
log(`rss after seed load: ${(process.memoryUsage().rss / 1048576).toFixed(0)}MB`);
log(`replaying ${meta.block_num + 1}..${stop} (db head ${dbHead})`);

type DbTx = { id: string; type: string; player: string | null; data: string; success: boolean | null; error: string | null; result: string | null; index: number };

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `@${i}\n  ours:   …${a.slice(Math.max(0, i - 120), i + 300)}\n  theirs: …${b.slice(Math.max(0, i - 120), i + 300)}`;
}

function compareTx(ours: TransactionEntity, theirs: DbTx): string[] {
  const problems: string[] = [];
  for (const k of ["id", "type", "player", "data", "success", "error", "result", "index"] as const) {
    const a = ours[k];
    const b = theirs[k];
    if (a === b) continue;
    if (a === null || b === null || typeof a !== "string" || typeof b !== "string") problems.push(`${k}: ours=${JSON.stringify(a)} theirs=${JSON.stringify(b)}`);
    else problems.push(`${k}: ${firstDiff(a, b)}`);
  }
  return problems;
}

let prev = meta.l2_block_id;
let n = 0;
let mismatches = 0;
const started = Date.now();
for await (const { block, blockNum } of streamBlocks(meta.block_num + 1, stop)) {
  const result = processor.process(blockNum, block, prev);
  let dbBlock = (await client.query("select l2_block_id, validator from blocks where block_num = $1", [blockNum])).rows[0];
  while (!dbBlock && process.env.FOLLOW === "1") {
    await new Promise((r) => setTimeout(r, 3000));
    dbBlock = (await client.query("select l2_block_id, validator from blocks where block_num = $1", [blockNum])).rows[0];
  }
  if (!dbBlock) {
    log(`block ${blockNum} not in db yet; stopping`);
    break;
  }
  const dbTxs = (await client.query("select id, type, player, data, success, error, result, index from validator_transactions where block_num = $1 order by index", [blockNum])).rows as DbTx[];
  const problems: string[] = [];
  if (dbTxs.length !== result.transactions.length) {
    problems.push(`tx count ours=${result.transactions.length} theirs=${dbTxs.length}`);
    problems.push(`ours:   ${result.transactions.map((t) => `${t.index}:${t.type}:${t.id}`).join(" ")}`);
    problems.push(`theirs: ${dbTxs.map((t) => `${t.index}:${t.type}:${t.id}`).join(" ")}`);
  }
  const m = Math.min(dbTxs.length, result.transactions.length);
  for (let i = 0; i < m; i++) {
    const p = compareTx(result.transactions[i], dbTxs[i]);
    if (p.length) problems.push(`tx[${i}] ${result.transactions[i].type} ${result.transactions[i].id}:\n  ${p.join("\n  ")}`);
  }
  if ((result.validator ?? null) !== dbBlock.validator) problems.push(`validator ours=${result.validator} theirs=${dbBlock.validator}`);
  if (result.l2_block_id !== dbBlock.l2_block_id) problems.push(`hash ours=${result.l2_block_id} theirs=${dbBlock.l2_block_id}`);
  if (problems.length) {
    mismatches++;
    log(`MISMATCH block ${blockNum}:\n${problems.join("\n")}`);
    if (process.env.CONTINUE_ON_MISMATCH !== "1") break;
  }
  // follow the upstream chain so one bad block does not cascade
  prev = dbBlock.l2_block_id;
  n++;
  if (n % 100 === 0) log(`ok through ${blockNum} (${n} blocks, ${(n / ((Date.now() - started) / 1000)).toFixed(1)}/s, rss=${(process.memoryUsage().rss / 1048576).toFixed(0)}MB)`);
}
log(`done: ${n} blocks compared, ${mismatches} mismatching`);
await client.end();
process.exit(mismatches ? 1 : 0);
