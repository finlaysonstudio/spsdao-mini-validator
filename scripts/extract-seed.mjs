#!/usr/bin/env node

/**
 * Extract a seed file from a running SPS-Validator PostgreSQL database.
 *
 * Run from the SPS-Validator repo root (where docker-compose.yml lives):
 *   node /path/to/spsdao-mini-validator/scripts/extract-seed.mjs [block_num] [hash_count]
 *
 * Arguments:
 *   block_num   — snapshot block (default: latest block in DB)
 *   hash_count  — how many subsequent block hashes to include for verification (default: 200)
 *
 * DB connection is read from the DB env var (JSON string) or individual vars:
 *   DB='{"host":"localhost","port":5432,"database":"validator","user":"validator","password":"validator"}'
 *   — or —
 *   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
 *
 * Output: writes seed.json to cwd
 *
 * Memory: uses SQL cursors to stream large tables — peak usage is ~one batch
 * (5000 rows) regardless of table size.
 */

import pg from "pg";
import { createWriteStream } from "node:fs";

const { Client } = pg;

const CURSOR_BATCH = 5000;

// ---------------------------------------------------------------------------
// Parse DB connection
// ---------------------------------------------------------------------------

function getConnectionConfig() {
  if (process.env.DB) {
    try {
      const parsed = JSON.parse(process.env.DB);
      return {
        host: parsed.host ?? "localhost",
        port: parsed.port ?? 5432,
        database: parsed.database ?? "validator",
        user: parsed.user ?? "validator",
        password: parsed.password ?? "validator",
      };
    } catch {
      console.error("Failed to parse DB env var as JSON, falling back to PG* vars");
    }
  }

  return {
    host: process.env.PGHOST ?? "localhost",
    port: parseInt(process.env.PGPORT ?? "5432", 10),
    database: process.env.PGDATABASE ?? process.env.APP_DATABASE ?? "validator",
    user: process.env.PGUSER ?? process.env.APP_USER ?? "validator",
    password: process.env.PGPASSWORD ?? process.env.APP_PASSWORD ?? "validator",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function query(client, sql) {
  const result = await client.query(sql);
  return result.rows;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Streaming JSON writer
// ---------------------------------------------------------------------------

class JsonStreamWriter {
  constructor(filePath) {
    this.stream = createWriteStream(filePath, { highWaterMark: 64 * 1024 });
    this.bytesWritten = 0;
    this.needsComma = false;
  }

  write(str) {
    this.stream.write(str);
    this.bytesWritten += Buffer.byteLength(str);
  }

  /** Drain the write buffer if backpressured */
  async drain() {
    if (this.stream.writableNeedDrain) {
      await new Promise((resolve) => this.stream.once("drain", resolve));
    }
  }

  startObject() {
    this.write("{");
    this.needsComma = false;
  }

  endObject() {
    this.write("\n}");
  }

  writeKey(key) {
    if (this.needsComma) this.write(",");
    this.write(`\n${JSON.stringify(key)}: `);
    this.needsComma = true;
  }

  writeKeyValue(key, value) {
    this.writeKey(key);
    this.write(JSON.stringify(value));
  }

  writeKeyArrayStreamed(key, rows) {
    this.writeKey(key);
    this.write("[");
    for (let i = 0; i < rows.length; i++) {
      if (i > 0) this.write(",");
      this.write("\n" + JSON.stringify(rows[i]));
    }
    this.write("\n]");
  }

  async close() {
    return new Promise((resolve, reject) => {
      this.stream.end(() => resolve());
      this.stream.on("error", reject);
    });
  }

  get sizeMB() {
    return (this.bytesWritten / 1024 / 1024).toFixed(1);
  }
}

// ---------------------------------------------------------------------------
// Cursor-based streaming: fetches rows in batches, writes each to disk,
// never holds more than CURSOR_BATCH rows in memory.
// ---------------------------------------------------------------------------

let cursorCounter = 0;

/**
 * Stream a SQL query's results as a JSON array directly to the writer.
 * Uses a server-side cursor so only `CURSOR_BATCH` rows are in memory at once.
 * Optional `transform` maps each row before writing.
 */
async function streamQueryToArray(client, writer, key, sql, transform) {
  const cursorName = `c_${++cursorCounter}`;

  await client.query("BEGIN");
  await client.query(`DECLARE ${cursorName} CURSOR FOR ${sql}`);

  writer.writeKey(key);
  writer.write("[");

  let totalRows = 0;
  let first = true;

  while (true) {
    const result = await client.query(`FETCH ${CURSOR_BATCH} FROM ${cursorName}`);
    const rows = result.rows;
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!first) writer.write(",");
      first = false;
      const out = transform ? transform(row) : row;
      writer.write("\n" + JSON.stringify(out));
    }

    totalRows += rows.length;
    if (totalRows % 50000 === 0) console.log(`    ... ${totalRows} rows`);

    await writer.drain();
  }

  writer.write("\n]");
  await client.query(`CLOSE ${cursorName}`);
  await client.query("COMMIT");

  console.log(`  ${totalRows} rows`);
  return totalRows;
}

/**
 * Like streamQueryToArray but writes a flat string array (just one column).
 */
async function streamNamesArray(client, writer, key, sql, column) {
  const cursorName = `c_${++cursorCounter}`;

  await client.query("BEGIN");
  await client.query(`DECLARE ${cursorName} CURSOR FOR ${sql}`);

  writer.writeKey(key);
  writer.write("[");

  let totalRows = 0;
  let first = true;

  while (true) {
    const result = await client.query(`FETCH ${CURSOR_BATCH} FROM ${cursorName}`);
    const rows = result.rows;
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!first) writer.write(",");
      first = false;
      writer.write(JSON.stringify(row[column]));
    }

    totalRows += rows.length;
    if (totalRows % 50000 === 0) console.log(`    ... ${totalRows} rows`);

    await writer.drain();
  }

  writer.write("]");
  await client.query(`CLOSE ${cursorName}`);
  await client.query("COMMIT");

  console.log(`  ${totalRows} rows`);
  return totalRows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const hashCount = parseInt(args[1] ?? "200", 10);

  const connConfig = getConnectionConfig();
  console.log(`Connecting to ${connConfig.host}:${connConfig.port}/${connConfig.database} as ${connConfig.user}...`);

  const client = new Client(connConfig);
  await client.connect();

  const outPath = "seed.json";
  const writer = new JsonStreamWriter(outPath);

  try {
    // ------------------------------------------------------------------
    // 1. Determine snapshot block
    // ------------------------------------------------------------------
    let blockNum;
    if (args[0]) {
      blockNum = parseInt(args[0], 10);
    } else {
      const rows = await query(
        client,
        `SELECT block_num AS max_block FROM blocks ORDER BY block_num DESC LIMIT 1`,
      );
      blockNum = rows[0]?.max_block;
      if (!blockNum) {
        console.error("No blocks found in database");
        process.exit(1);
      }
      console.log(`No block_num specified, using latest: ${blockNum}`);
    }

    // ------------------------------------------------------------------
    // 2. Get the snapshot block itself
    // ------------------------------------------------------------------
    const [block] = await query(
      client,
      `SELECT block_num, block_id, prev_block_id, l2_block_id, block_time
       FROM blocks WHERE block_num = ${blockNum}`,
    );
    if (!block) {
      console.error(`Block ${blockNum} not found in database`);
      process.exit(1);
    }
    console.log(`Snapshot block: ${blockNum} (L2: ${block.l2_block_id?.slice(0, 16)}...)`);

    // Start writing — scalar fields first
    writer.startObject();
    writer.writeKeyValue("_meta", {
      extracted_at: new Date().toISOString(),
      source_db: `${connConfig.host}:${connConfig.port}/${connConfig.database}`,
      description: "SPS Validator state snapshot for mini-validator bootstrap",
    });
    writer.writeKeyValue("block_num", block.block_num);
    writer.writeKeyValue("l2_block_id", block.l2_block_id);
    writer.writeKeyValue("block_id", block.block_id);
    writer.writeKeyValue("prev_block_id", block.prev_block_id);
    writer.writeKeyValue("block_time", block.block_time);

    // ------------------------------------------------------------------
    // 3. Balances — CURSOR STREAMED
    // ------------------------------------------------------------------
    console.log("Extracting balances...");
    await streamQueryToArray(
      client,
      writer,
      "balances",
      `SELECT player, token, balance::float AS balance FROM balances WHERE balance != 0`,
    );

    // ------------------------------------------------------------------
    // 4. Validators (small table, normal query is fine)
    // ------------------------------------------------------------------
    console.log("Extracting validators...");
    const validators = await query(
      client,
      `SELECT account_name, is_active, total_votes::float AS total_votes,
              missed_blocks, post_url, reward_account, api_url, last_version
       FROM validators`,
    );
    console.log(`  ${validators.length} validators`);
    writer.writeKeyArrayStreamed("validators", validators);

    // ------------------------------------------------------------------
    // 5. Validator votes (small table)
    // ------------------------------------------------------------------
    console.log("Extracting validator votes...");
    const validatorVotes = await query(
      client,
      `SELECT voter, validator, vote_weight::float AS vote_weight FROM validator_votes`,
    );
    console.log(`  ${validatorVotes.length} validator votes`);
    writer.writeKeyArrayStreamed("validator_votes", validatorVotes);

    // ------------------------------------------------------------------
    // 6. Active delegations — CURSOR STREAMED
    // ------------------------------------------------------------------
    console.log("Extracting active delegations...");
    await streamQueryToArray(
      client,
      writer,
      "active_delegations",
      `SELECT delegator, delegatee, token, amount::float AS amount,
              last_delegation_tx, last_undelegation_date
       FROM active_delegations WHERE amount > 0`,
    );

    // ------------------------------------------------------------------
    // 7. Token unstaking (likely small, only active records)
    // ------------------------------------------------------------------
    console.log("Extracting token unstaking...");
    const rawUnstaking = await query(
      client,
      `SELECT player, unstake_tx, token,
              total_qty::float AS total_qty,
              total_unstaked::float AS total_unstaked,
              next_unstake_date, is_active,
              unstaking_periods, unstaking_interval_seconds
       FROM token_unstaking WHERE is_active = true`,
    );
    const tokenUnstaking = rawUnstaking.map((r) => ({
      player: r.player,
      unstake_tx: r.unstake_tx,
      token: r.token,
      quantity: round3(r.total_qty / (r.unstaking_periods || 4)),
      quantity_left: round3(r.total_qty - (r.total_unstaked || 0)),
      total_qty: round3(r.total_qty),
      next_unstake_date: r.next_unstake_date,
      is_active: r.is_active,
      unstaking_periods: r.unstaking_periods,
      unstaking_interval_seconds: r.unstaking_interval_seconds,
    }));
    console.log(`  ${tokenUnstaking.length} unstaking records`);
    writer.writeKeyArrayStreamed("token_unstaking", tokenUnstaking);

    // ------------------------------------------------------------------
    // 8. Config (small table)
    // ------------------------------------------------------------------
    console.log("Extracting config...");
    const config = await query(
      client,
      `SELECT group_name, name, index, value_type, value FROM config ORDER BY group_name, name`,
    );
    console.log(`  ${config.length} config entries`);
    writer.writeKeyArrayStreamed("config", config);

    // ------------------------------------------------------------------
    // 9. Staking pools (table may not exist in all schemas)
    // ------------------------------------------------------------------
    console.log("Extracting staking pools...");
    let pools = [];
    try {
      pools = await query(
        client,
        `SELECT name, token, reward_token, tokens_per_block::float AS tokens_per_block,
                start_block, acc_tokens_per_share::float AS acc_tokens_per_share,
                last_reward_block, is_active
         FROM staking_pool`,
      );
    } catch {
      console.log("  (staking_pool table not found, skipping)");
    }
    console.log(`  ${pools.length} staking pools`);
    writer.writeKeyArrayStreamed("pools", pools);

    // ------------------------------------------------------------------
    // 10. Staking pool reward debt — CURSOR STREAMED
    // ------------------------------------------------------------------
    console.log("Extracting staking pool reward debt...");
    await streamQueryToArray(
      client,
      writer,
      "staking_pool_reward_debt",
      `SELECT player, pool_name, reward_debt::float AS reward_debt FROM staking_pool_reward_debt`,
    );

    // ------------------------------------------------------------------
    // 10. Promises (open only, likely small)
    // ------------------------------------------------------------------
    console.log("Extracting promises...");
    const promises = await query(
      client,
      `SELECT id, ext_id, type, status, params, controllers,
              fulfill_timeout_seconds, fulfilled_by, fulfilled_at,
              fulfilled_expiration, created_date, updated_date
       FROM promise WHERE status = 'open'`,
    );
    console.log(`  ${promises.length} open promises`);
    writer.writeKeyArrayStreamed("promises", promises);

    // ------------------------------------------------------------------
    // 11. Validator check-ins (small table)
    // ------------------------------------------------------------------
    console.log("Extracting validator check-ins...");
    const checkIns = await query(
      client,
      `SELECT account, status, last_check_in_block_num, last_check_in FROM validator_check_in`,
    );
    console.log(`  ${checkIns.length} check-in records`);
    writer.writeKeyArrayStreamed("check_ins", checkIns);

    // ------------------------------------------------------------------
    // 12. Hive accounts — CURSOR STREAMED (names only)
    // ------------------------------------------------------------------
    console.log("Extracting hive accounts...");
    await streamNamesArray(
      client,
      writer,
      "hive_accounts",
      `SELECT name FROM hive_accounts`,
      "name",
    );

    // ------------------------------------------------------------------
    // 13. Price history (small table)
    // ------------------------------------------------------------------
    console.log("Extracting price history...");
    const priceHistory = await query(
      client,
      `SELECT validator, token, block_num, block_time,
              token_price::float AS token_price
       FROM price_history`,
    );
    console.log(`  ${priceHistory.length} price entries`);
    writer.writeKeyArrayStreamed("price_history", priceHistory);

    // ------------------------------------------------------------------
    // 14. Known hashes — individual PK lookups (partitioned table)
    // ------------------------------------------------------------------
    console.log(`Extracting known hashes (${hashCount} blocks after snapshot)...`);
    writer.writeKey("known_hashes");
    writer.write("[");
    let khCount = 0;
    for (let i = 1; i <= hashCount; i++) {
      const rows = await query(
        client,
        `SELECT block_num, l2_block_id, block_id, prev_block_id, block_time
         FROM blocks WHERE block_num = ${blockNum + i}`,
      );
      if (rows.length > 0) {
        if (khCount > 0) writer.write(",");
        writer.write("\n" + JSON.stringify(rows[0]));
        khCount++;
      }
      if (i % 50 === 0) console.log(`  ... ${i}/${hashCount}`);
    }
    writer.write("\n]");
    console.log(`  ${khCount} known hashes`);

    // ------------------------------------------------------------------
    // 15. Recent blocks — individual PK lookups (partitioned table)
    // ------------------------------------------------------------------
    console.log("Extracting recent blocks (500 blocks)...");
    writer.writeKey("recent_blocks");
    writer.write("[");
    let rbCount = 0;
    for (let i = -500; i <= 0; i++) {
      const rows = await query(
        client,
        `SELECT block_num, block_id, prev_block_id, l2_block_id, block_time, validator, validation_tx
         FROM blocks WHERE block_num = ${blockNum + i}`,
      );
      if (rows.length > 0) {
        if (rbCount > 0) writer.write(",");
        writer.write("\n" + JSON.stringify(rows[0]));
        rbCount++;
      }
      if ((500 + i) % 100 === 0) console.log(`  ... ${500 + i}/500`);
    }
    writer.write("\n]");
    console.log(`  ${rbCount} recent blocks`);

    // ------------------------------------------------------------------
    // Done
    // ------------------------------------------------------------------
    writer.endObject();
    await writer.close();

    console.log(`\nWrote ${outPath} (${writer.sizeMB} MB)`);
    console.log(`  Snapshot block: ${blockNum}`);
    console.log(`  Verification hashes: ${khCount} blocks (${blockNum + 1}–${blockNum + khCount})`);
    console.log(`\nCopy seed.json to your mini-validator directory and run: npm run dev`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});

