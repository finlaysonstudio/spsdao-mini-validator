# SPS Mini Validator (observer)

A minimal, in-memory port of the [TheSPSDAO/SPS-Validator](https://github.com/TheSPSDAO/SPS-Validator)
block-processing core. It replays Hive blocks, applies every SPS layer-2 action and virtual
operation exactly as the upstream validator does, and computes the same L2 block hash, with
no database and no web UI. It can perform a validator's duties (block validation, check-ins) in
shadow mode or live. It exports portable snapshots that other nodes start from.

Target: hash-for-hash parity with upstream **1.5.1** (verified continuously against a running
upstream node's Postgres with `tools/dbdiff.mts`).

## Install

Docker (recommended; Node 24 image for linux/amd64 and linux/arm64):

```sh
curl -fsSL https://raw.githubusercontent.com/finlaysonstudio/spsdao-mini-validator/main/install.sh | sh
```

Bare metal (Node 24+; installs the `sps-mini` CLI with npm and a systemd user unit or launchd agent):

```sh
curl -fsSL https://raw.githubusercontent.com/finlaysonstudio/spsdao-mini-validator/main/install.sh | sh -s -- --bare-metal
```

| Option | Effect |
|---|---|
| `--accounts a,b` | Shadow-mode duties for these validator accounts (no keys are read; live mode is set in the env file) |
| `--genesis` | Start from the genesis seed (block 93703455) and replay to head: trustless, hours, ~6 GB chunk cache |
| `--dir DIR` | Install directory (default `~/.sps-mini`) |
| `--version vX.Y.Z` | Release tag (default latest) |
| `--no-start` | Write files only |

The installer downloads `seed-latest.ndjson.gz` (or `seed-genesis.ndjson.gz`) from the GitHub
release, checks it against the release's `SHA256SUMS`, writes `.env` (mode 600) and starts the
service. `sps-mini verify <seed>` also checks a seed's hash against the Splinterlands archive API.
Configuration lives in `<dir>/.env` (see Environment).

Releases (`.github/workflows/release.yml`, on tag `v*`): multi-arch image on GHCR, npm tarball,
`install.sh`, seeds carried forward from the previous release. `scripts/publish-seed.sh <seed>
[--genesis]` verifies a seed and replaces the release's seed assets and `SHA256SUMS`.

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

Requires Node 24+ started with `--no-use-std-math-pow` (the package scripts and the Docker image
pass it). Since Node 24, V8's default `Math.pow` is 1 ulp off upstream's Node 23.3 on inputs such as
`0.99 ** 32`, which forks the staking reward hash; the flag restores V8's internal pow. It is a V8
flag and is rejected in `NODE_OPTIONS`. Block processing refuses to start when the runtime fails
the check (`src/util/mathpow.mts`).

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
| `SNAPSHOT_DIR` | (none) | Export a portable seed here (see Snapshots) |
| `SNAPSHOT_EVERY` | 28800 | Export on multiples of this block number (≈ daily) |
| `SNAPSHOT_KEEP` | 3 | Seed exports kept in `SNAPSHOT_DIR` |

## Snapshots

A snapshot is a seed that `SEED_FILE` loads, so any node can start from another node's state
instead of an upstream database or the genesis replay.

- **Format 2** (written from memory) = the format-1 rows `extract-seed` writes from Postgres plus
  `hash64` rows (hive account names, closed promises and rental ids, which this port stores only as
  64-bit hashes), `hive_account_authority` and `promise_closed_tables`. Rows keep each store's
  iteration order. Unlike checkpoints (`.v8.gz`, V8 serialization of this build's classes), seeds
  are independent of the Node version and of internal field layout.
- With `SNAPSHOT_DIR` set, the runner writes `seed-<block>.ndjson.gz`, `seed-<block>.manifest.json`
  (`block_num`, `l2_block_id`, `bytes`, `sha256`, ...) and `latest.json`. With `REFERENCE_API` set,
  the block is verified first and nothing is exported on a mismatch.
- From a checkpoint: `npm run export-seed --workspace packages/validator -- <checkpoint-dir> <out.ndjson.gz> [block] --verify`.
  `--verify` reloads the seed and compares every store field with the checkpoint (`src/state/compare.mts`).
- Size and speed at block 111770000: 63 MB, export 14 s, load 3.6 s.

## Validator duties

With `VALIDATOR_ACCOUNTS` set, the observer also performs the validator's duties for each listed
account. Every `validate_block` and `check_in_validator` transaction is built exactly as upstream's
`HiveClient` broadcasts it (one `custom_json`, `id: sm_sps`, posting authority).

- **Shadow mode** (default): transactions are logged; nothing is signed or sent and no key is read.
- **Live mode** (`VALIDATOR_MODE=live`): transactions are signed and broadcast, referencing the
  head block and expiring 60 s after it. Signatures are byte-identical to dhive's
  (`src/hive/signing.spec.mts`). `VALIDATOR_KEY` holds one or more posting key WIFs, comma-separated;
  at startup each account is matched with a key that alone satisfies its posting authority
  (directly, or through an `account_auths` grant). An account no key can sign for, or a malformed
  key, is reported and skipped: its duties stay in shadow mode and the process keeps running.
  Keys are removed from `process.env` once read and never logged.

- **Block validation** (upstream `processor.ts`): when the seeded PRNG picks a listed account for a
  block within `max_block_age` of the head, send `{block_num, hash, version}`.
- **Leader/follower** (Fire Horse `VALIDATE_BLOCK_DELAY`): with a delay of `N > 0` the validation is
  held for `N` blocks and sent only if no validation for that block has appeared on chain.
- **Check-ins** (upstream `ValidatorCheckInPlugin`, Fire Horse jitter): per reward account, check in
  at `last_check_in + check_in_interval_blocks + jitter` (`jitter = sha256("account:last")` modulo
  half the window, so every node agrees), plus the follower delay. An unconfirmed check-in is re-sent
  after `CHECK_IN_RETRY_BLOCKS`. Accounts that share a reward account check in once.
- **Price feed** (upstream `PriceFeedPlugin`, `src/validator/price_feed.mts`): while a listed account
  is among the top `num_top_validators` (active, by votes), rewards have started and are not paused,
  and the node is within `price_feed.interval_blocks` of the head, send `price_feed` with the SPS price
  in USD every interval plus a random 0 to 1 interval. Price = HIVE/USD from the configured external
  feeds ÷ the Hive Engine `SWAP.HIVE:SPS` pool `basePrice`, to 7 decimals. The DAO feed needs no
  key; CoinGecko and CoinMarketCap are used only when their API keys are set. Upstream behaviour is
  kept: every feed is asked, in random order, and the last answer wins.
- **Observation**: every `validate_block` / `check_in_validator` on chain from a listed account
  (for example, sent by the upstream node that holds the key) is compared with this node's hash and
  with what it intended to send.

| Variable | Default | Purpose |
|----------|---------|---------|
| `VALIDATOR_ACCOUNTS` | (none) | Comma-separated validator accounts (`VALIDATOR_ACCOUNT` also accepted); empty disables duties |
| `VALIDATOR_MODE` | `shadow` | `shadow` (log only) or `live` (sign and broadcast) |
| `VALIDATOR_KEY` | (none) | Live mode: posting key WIFs, comma-separated. In the container, `LOCAL/validator.env` (`scripts/make-validator-env.sh`) |
| `VALIDATE_BLOCK_DELAY` | 0 | 0 = leader; `N` = follower that waits `N` blocks |
| `ENABLE_CHECK_INS` | `true` | Check in for the listed accounts |
| `CHECK_IN_RETRY_BLOCKS` | 100 | Re-send an unconfirmed check-in after this many blocks |
| `VALIDATOR_VERSION` | `1.5.1-mini.0` | `version` param (recorded on chain as the validator's `last_version`) |
| `ENABLE_PRICE_FEED` | `true` | Price feed duty (runs only for top validators) |
| `PRICE_FEED_DAO_API_URL` | `https://prices.splinterlands.workers.dev` | DAO HIVE/USD feed (no key) |
| `PRICE_FEED_COIN_GECKO_API_KEY` | (none) | Enables the CoinGecko feed (`PRICE_FEED_COIN_GECKO_API_URL`, `_DEMO_API_URL`, `_DEMO` as upstream) |
| `PRICE_FEED_COIN_MARKET_CAP_API_KEY` | (none) | Enables the CoinMarketCap feed (`PRICE_FEED_COIN_MARKET_CAP_API_URL`, `_TOKEN_MAP` as upstream) |
| `HIVE_ENGINE_RPC_NODES` | upstream's eight nodes | Hive Engine nodes, in failover order |
| `DUTY_LOG` | (none) | Also append duty events (JSONL) to this file |

Duty log lines (`mode: "shadow"` or `"live"`):

| msg | status | meaning |
|---|---|---|
| `shadow broadcast` | info | a transaction this node would send; `custom_json` is the exact operation (`reason: no_key` in live mode for a skipped account) |
| `duty deferred` / `duty skipped` | info / warning | follower hold, leader already validated, paused, or too old after the delay |
| `observed validation` | ok / error | on-chain `validate_block` by a listed account; `match` = its hash equals ours, `intent_match` = equals what we would have sent |
| `observed check-in` | ok / error | on-chain check-in; `match` = its hash equals ours for that block; `blocks_from_intent` = how far it landed from our intended block |
| `validation missed` | error | a block we would have validated passed `max_block_age` with no validation on chain |
| `posting authority verified` | info | live startup, per account: the signing public key and `via` (`key` or `account_auth` + `grantee`) |
| `validator account skipped` | error | live startup: no configured key can sign for the account; it stays in shadow (`reason`) |
| `validator key skipped` | error | live startup: a malformed key (`key_index`, never the value) |
| `price feed source failed` | warning | one external feed failed (others may still answer) |
| `price feed failed` | error | no price this time; retried on the next block |
| `broadcast sent` | info | live: the node accepted the transaction; `trx_id`, `expiration`, `ms`, `duplicate` when a retry found it already accepted |
| `broadcast failed` | error | live: `stage` `prepare` (no head block) or `send` (rejected or unreachable); `error` |

## Logs and health check

Both containers write one JSON object per line (JSONL), suitable for shipping to Datadog as is. `status` is the log level (`info`, `warning`, `error`, or `ok` for a passing health check).

Observer block line, emitted for every block once within 50 blocks of the head (every 100th block while catching up):

```json
{"ts":"2026-11-01T14:07:03.323Z","status":"info","msg":"block","block_num":111284491,"l2_block_id":"ea32…64ac","txs":2,"validator":"bamlolx","reward":0.364581,"reward_token":"SPS","head_block":111284491,"behind":0,"rate":0.33,"rss_mb":875}
```

| field | meaning |
|---|---|
| `block_num` | Hive block number that was just processed |
| `l2_block_id` | the computed L2 block hash: `sha256(previous l2_block_id + "." + JSON of the block's transaction rows)`; must equal `blocks.l2_block_id` in the upstream database |
| `txs` | number of L2 transactions in the block (matching `custom_json` ops plus virtual ops such as expirations) |
| `validator` | the validator that upstream's seeded RNG selects to validate this block (`null` when none is selected) |
| `reward`, `reward_token` | amount and token paid to that validator if it validates the block |
| `head_block` | the newest block the observer is allowed to process (last irreversible block minus `BLOCKS_BEHIND_HEAD`) |
| `behind` | `head_block - block_num`; 0 means caught up |
| `rate` | blocks processed per second over the last 200 blocks (about 0.33 at the head, since Hive produces one block every 3 s) |
| `rss_mb` | resident memory of the observer process |

The `checker` service compares the newest `CHECK_WINDOW` lines of `hashes.log` with the upstream `blocks` table every `CHECK_INTERVAL_SECONDS` and emits one line:

```json
{"ts":"…","status":"ok","msg":"hashes match","reason":"ok","compared":5000,"matching":5000,"mismatching":0,"first_mismatch":null,"observer_head":111284491,"db_head":111284491,"lag":0,"window_blocks":5000}
```

| status | reason | meaning |
|---|---|---|
| `ok` | `ok` | every compared hash matches and the observer is within `CHECK_MAX_LAG` blocks of the DB head |
| `error` | `mismatch` | at least one hash differs; `first_mismatch` has the block and both hashes |
| `error` | `lagging` | no mismatch, but the observer is more than `CHECK_MAX_LAG` blocks behind the database and not gaining on it |
| `warning` | `catching_up` | more than `CHECK_MAX_LAG` behind but replaying faster than the chain (normal for a few minutes after a restart) |
| `warning` | `no_log`, `no_overlap`, `db_error` | nothing could be compared (empty log, blocks not in the DB yet, or Postgres unreachable) |

The checker joins the upstream compose network (`validator:postgres`) and reads credentials from `LOCAL/checker.env`, created with `scripts/make-checker-env.sh` from the running `pg` container's environment. The file is mode 600 and gitignored.

## Known gaps

Paths that upstream can take but that never occur on the current chain are not ported and
raise `UnsupportedPathError` (which aborts processing rather than silently diverging):
`config_update` by an admin, the legacy `validator_tranche_info` shop sale, pool admin
actions (`add_pool`, `update_pool`, `disable_pool`, `claim_pool`), the legacy admin price feed,
and the one-time transition actions. `fulfill_promise_multi` is ported but its multi-row
`RETURNING` order is approximated (never seen on chain).

Memory: about 0.9 GB RSS after loading the current seed (2.6M Hive account names, 1.4M
promise ids, 1.5M rental ids are kept as 64-bit hashes).
