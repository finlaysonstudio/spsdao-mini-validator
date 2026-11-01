# SPS Mini Validator (observer)

A minimal, in-memory port of the [TheSPSDAO/SPS-Validator](https://github.com/TheSPSDAO/SPS-Validator)
block-processing core. It replays Hive blocks, applies every SPS layer-2 action and virtual
operation exactly as the upstream validator does, and computes the same L2 block hash, with
no database, no web UI, and no broadcasting.

Target: hash-for-hash parity with upstream **1.5.1** (verified continuously against a running
upstream node's Postgres with `tools/dbdiff.mts`).

## How it works

1. **Seed**: an NDJSON snapshot of the upstream validator's state tables, extracted from a live
   database inside one `REPEATABLE READ` transaction (`tools/extract-seed.mts`), so it is
   consistent at exactly one block boundary.
2. **Stream**: Hive blocks are fetched from public RPC nodes (`block_api.get_block`),
   optionally cached on disk.
3. **Process** (`src/block/processor.mts`): per block, in upstream order
   - compute the block reward,
   - run all virtual payload sources against block-start state (token unstaking, pool
     claims, burned-token clearing, promise expiration, check-in expiration, missed blocks,
     transitions, rental expiration), then execute their operations,
   - execute every `sm_sps` / `sm_*` custom_json operation in block order,
   - pick the block validator with the seeded PRNG,
   - build the `TransactionEntity[]` list and hash it:
     `sha256(prev_l2_block_id + "." + JSON.stringify(transactions))`.
4. **Log** the hash (stdout and optionally `HASH_LOG`).

Every repository (`src/repos/`) mirrors the corresponding upstream repository: same event
objects, same key order, same numeric rounding. Numbers are stored as scaled `bigint`s so
that arithmetic matches Postgres `numeric` exactly, while every place upstream does float
math in JavaScript is reproduced as float math here.

## Running

```sh
npm install
# extract a seed from a running upstream validator database
PGHOST=127.0.0.1 PGUSER=... PGPASSWORD=... PGDATABASE=validator \
  npm run extract-seed --workspace packages/validator -- LOCAL/seed.ndjson
gzip -k LOCAL/seed.ndjson
# observe
SEED_FILE=LOCAL/seed.ndjson.gz HASH_LOG=LOCAL/hashes.log npm run dev --workspace packages/validator
```

Container (observer only, no keys):

```sh
mkdir -p LOCAL/observer && cp LOCAL/seed.ndjson.gz LOCAL/observer/
docker compose up -d --build
docker compose logs -f observer
```

### Backtesting against a running upstream node

```sh
FOLLOW=1 CONTINUE_ON_MISMATCH=1 SEED_FILE=LOCAL/seed.ndjson BLOCK_CACHE_DIR=LOCAL/blockcache \
  PGHOST=... npm run dbdiff --workspace packages/validator
```

The harness replays from the seed and compares, for every block, each
`validator_transactions` row (id, type, player, data, success, error, result, index), the
chosen validator and `blocks.l2_block_id`. It follows the upstream chain after a mismatch so
one divergence does not cascade. `LOCAL/check-hashes.sh` compares a container's hash log with
the database.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `SEED_FILE` | `seed.ndjson` | NDJSON (or `.gz`) seed |
| `RPC_NODES` | 5 public nodes | Comma-separated Hive RPC endpoints |
| `BLOCKS_BEHIND_HEAD` | 6 | Lag behind the (irreversible) head |
| `BLOCKS_HEAD_MODE` | `irreversible` | `irreversible` or `head` |
| `REPLAY_BATCH_SIZE` | 25 | Blocks fetched in parallel during catch-up |
| `BLOCK_CACHE_DIR` | (none) | On-disk cache of raw Hive blocks |
| `HASH_LOG` | (none) | Append `block_num l2_block_id` lines here |
| `STOP_BLOCK` | 0 | Stop after this block |
| `CUSTOM_JSON_ID` / `CUSTOM_JSON_PREFIX` | `sm_sps` / `sm_` | Upstream operation ids |

## Known gaps

Paths that upstream can take but that never occur on the current chain are not ported and
raise `UnsupportedPathError` (which aborts processing rather than silently diverging):
`config_update` by an admin, the legacy `validator_tranche_info` shop sale, pool admin
actions (`add_pool`, `update_pool`, `disable_pool`, `claim_pool`), the legacy admin price feed,
and the one-time transition actions. `fulfill_promise_multi` is ported but its multi-row
`RETURNING` order is approximated (never seen on chain).

Memory: about 0.9 GB RSS after loading the current seed (2.6M Hive account names, 1.4M
promise ids, 1.5M rental ids are kept as 64-bit hashes).
