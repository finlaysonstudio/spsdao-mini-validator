/**
 * Extract a transaction-consistent seed from the upstream validator database.
 *
 *   DATABASE_URL=postgres://validator:...@localhost:5432/validator tsx tools/extract-seed.mts out.ndjson
 *
 * Everything is read inside one REPEATABLE READ transaction so the snapshot
 * corresponds to exactly one block boundary (the validator commits per block).
 */
import { createWriteStream } from "node:fs";
import pg from "pg";

// timestamp without time zone → treat as UTC (the validator container runs in UTC)
pg.types.setTypeParser(1114, (s: string) => new Date(s.replace(" ", "T") + "Z"));
// keep numerics as text
pg.types.setTypeParser(1700, (s: string) => s);

const out = process.argv[2];
if (!out) throw new Error("usage: extract-seed.mts <out.ndjson>");
const retention = parseInt(process.env.SEED_BLOCK_RETENTION ?? "5000", 10);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

const ws = createWriteStream(out);
let pending = 0;
function write(t: string, r: unknown) {
  if (!ws.write(JSON.stringify({ t, r }) + "\n")) pending++;
}
async function drain() {
  if (pending > 0) {
    await new Promise((res) => ws.once("drain", res));
    pending = 0;
  }
}

const head = await client.query("select block_num, block_id, l2_block_id from blocks order by block_num desc limit 1");
const meta = { ...head.rows[0], extracted_at: new Date().toISOString() };
write("meta", meta);
console.log(`snapshot at block ${meta.block_num}`);

async function dump(t: string, sql: string, map?: (r: any) => unknown) {
  const cursor = client.query(new (await import("pg-cursor")).default(sql));
  let n = 0;
  for (;;) {
    const rows: any[] = await new Promise((res, rej) => cursor.read(5000, (e: Error | undefined, r: any[]) => (e ? rej(e) : res(r))));
    if (rows.length === 0) break;
    for (const r of rows) {
      write(t, map ? map(r) : r);
      n++;
    }
    await drain();
  }
  await new Promise<void>((res) => cursor.close(() => res()));
  console.log(`${t}: ${n}`);
}

await dump("blocks", `select block_num, block_id, prev_block_id, l2_block_id, block_time, validator, validation_tx from blocks where block_num > ${meta.block_num - retention} order by block_num`);
await dump("config", "select group_name, group_type, name, index, value_type, value, last_updated_date, last_updated_tx from config order by group_name, index, name");
await dump("balances", "select player, token, balance from balances");
await dump("hive_accounts", "select name, authority from hive_accounts", (r) => (r.authority && Object.keys(r.authority).length > 0 ? r : { name: r.name }));
await dump("validators", "select * from validators");
await dump("validator_votes", "select voter, validator, vote_weight from validator_votes");
await dump("validator_check_in", "select account, status, last_check_in_block_num, last_check_in from validator_check_in");
await dump("token_unstaking", "select * from token_unstaking where is_active");
await dump("price_history", "select validator, token, block_num, block_time, token_price from price_history");
await dump("staking_pool_reward_debt", "select player, pool_name, reward_debt from staking_pool_reward_debt");
await dump("active_delegations", "select * from active_delegations");
await dump("token_transfer_keys", "select account, key from token_transfer_keys");
await dump(
  "promise",
  "select ext_id, type, status, params, controllers, fulfill_timeout_seconds, fulfilled_by, fulfilled_at, fulfilled_expiration, created_date, updated_date from promise where status in ('open','fulfilled')",
);
await dump("promise_closed", "select type, ext_id, status, params->>'lender' as lender, controllers from promise where status not in ('open','fulfilled')");
await dump("rental_delegations", "select * from rental_delegations where status = 'active'");
await dump("rental_ids", "select id from rental_delegations where status <> 'active'");

await client.query("COMMIT");
await client.end();
await new Promise<void>((res) => ws.end(res));
console.log("done");
