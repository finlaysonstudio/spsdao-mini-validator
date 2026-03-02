# SPS Mini Validator

A lightweight validator that replays the [Splinterlands SPS](https://github.com/TheSPSDAO/SPS-Validator) layer-2 blockchain and independently verifies L2 block hashes. Optionally participates as an active validator — checking in and validating blocks on behalf of one or more accounts.

## Motivation

The SPS Validator is a large, full-featured system with database dependencies, a web server, and operational complexity. If you just want to answer "are the L2 hashes correct?", you shouldn't need all of that.

This project strips the validator down to its essential pipeline: bootstrap from a state snapshot, stream Hive blocks, replay every operation and virtual operation in the exact same order, compute the L2 hash, and compare it to known-good values. If the hashes match, the chain is honest. If they don't, something is wrong.

The goal is **hash-for-hash parity** with the production validator using minimal code, no database, and zero external services beyond Hive RPC nodes.

## How It Works

```
seed.json ──► Bootstrap State
                   │
                   ▼
         Stream Hive Blocks (RPC)
                   │
          ┌────────┴────────┐
          ▼                 ▼
   Virtual Operations   Parse custom_json
   (system-generated)   (blockchain ops)
          │                 │
          └────────┬────────┘
                   ▼
         Build TransactionEntities
         (deterministic field order)
                   │
                   ▼
          Compute L2 Hash
          SHA256(prevHash + "." + JSON)
                   │
                   ▼
         Verify Against Known Hashes
```

### 1. Bootstrap

The validator starts from a `seed.json` — a snapshot of all state at a known block. This includes token balances, validators, delegations, staking pools, promises, check-ins, config, and a set of known L2 hashes to verify against.

### 2. Stream Blocks

Connects to Hive RPC nodes and fetches blocks sequentially. During catch-up it batch-fetches 25 blocks in parallel; near the head it streams one at a time with a 3-second poll interval. Nodes rotate on failure.

### 3. Process Each Block

For every block, two categories of operations execute in strict order:

**Virtual operations** (system-generated, run first):
1. Token unstaking completions
2. Staking pool reward accruals
3. Burned token cleanup
4. Promise expiration
5. Validator check-in expiration
6. Missed block tracking
7. Protocol transitions

**Blockchain operations** (from Hive `custom_json`):
- Filtered by ID `"sps"` or prefix `"sm_"`
- Authorization checked (posting vs active auth)
- ~26 operation types: transfers, staking, delegation, pools, promises, validators, licenses, price feeds, etc.

### 4. Compute L2 Hash

Each operation produces a `TransactionEntity` with fields in an exact, deterministic order. The L2 hash is:

```
SHA256(previous_l2_hash + "." + JSON.stringify(all_transactions))
```

JSON key order, date serialization (`Date.toJSON()`), and numeric precision (3 decimals) all must match the upstream validator exactly.

### 5. Verify

If the block number appears in the known hashes map, the computed hash is compared. Match = the chain is valid up to that point. Mismatch = halt with a full transaction dump for debugging.

## Running

```bash
npm install
npm run dev
```

Requires a `seed.json` in the project root (or set `SEED_FILE`).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SEED_FILE` | `seed.json` | Path to state snapshot |
| `RPC_NODES` | `https://api.hive.blog,...` | Comma-separated Hive RPC URLs |
| `BLOCKS_BEHIND_HEAD` | `5` | How far behind head to stream |
| `BLOCKS_HEAD_MODE` | `irreversible` | `irreversible` or `head` |
| `REPLAY_BATCH_SIZE` | `25` | Parallel block fetch count |
| `VALIDATORS` | _(empty)_ | Comma-separated `account:postingKey` pairs for active validation |

### Multi-Account Validator Mode

When `VALIDATORS` is set, the mini validator actively participates on-chain:

```bash
# Single account
VALIDATORS='myaccount:5JpostingKeyWIF...' npm run dev

# Multiple accounts
VALIDATORS='account1:5Jkey1...,account2:5Jkey2...' npm run dev
```

For each configured account, the validator will:
- **Check in** automatically when the account's check-in expires or is missing
- **Validate blocks** when the account is selected as the block validator via weighted PRNG

Broadcasts only happen when the node is near the chain head (not during catch-up replay). Posting keys are validated at startup — invalid WIF keys cause an immediate error.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run directly with tsx |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | ESLint |
| `npm test` | Vitest |

## Development Decisions

### In-Memory State, No Database

All state lives in Maps. This keeps the code simple, the dependencies minimal, and the replay fast. The tradeoff is that you must restart from the seed on every run — there's no checkpointing. For a verification tool, this is acceptable.

### Seed-Based Bootstrap

Rather than syncing from genesis (millions of blocks), the validator starts from a state snapshot at a recent block. This makes startup fast and lets you verify any range of blocks by choosing an appropriate seed.

### Deterministic Hashing via Field Order

The L2 hash depends on `JSON.stringify` output, which in JavaScript preserves object key insertion order. Transaction entities are constructed as object literals with keys in the exact order the upstream validator expects. This is fragile by nature — any field reordering, extra field, or serialization difference breaks the hash.

### Virtual Operations Run First

The upstream validator registers virtual operation sources before blockchain operations. This means system-generated transactions (unstaking completions, pool claims, expired check-ins) appear before user transactions in every block. The ordering within virtual sources is also fixed and critical.

### 3-Decimal Precision

All token amounts use `Math.round(value * 1000) / 1000`. This matches the upstream validator's precision and avoids floating-point drift across thousands of blocks.

### Validator Selection via Seeded PRNG

Block validators are selected deterministically using `seedrandom(blockId + prevBlockId)` with stake-weighted random selection. This means any node can independently compute who should have validated a given block.

### Check-In Status vs Deletion

When a validator's check-in expires, the record is set to `"inactive"` rather than deleted. This matches the upstream behavior where check-in records persist in the database with a status field, and only `"active"` check-ins are considered for expiration.

## Project Structure

```
src/
├── main.mts                 # Entry point, block processing loop
├── config.mts               # Environment variable configuration
├── types.mts                # Shared type definitions
├── bootstrap/               # Seed file loading and state initialization
├── hive/                    # RPC client, block streaming, and broadcast
├── hash/                    # L2 hash computation and transaction building
├── operations/              # Blockchain operation parsing and handlers
│   └── handlers/            # Individual operation type handlers
├── state/                   # In-memory state stores (balances, validators, etc.)
├── validator/               # Active validator participation (check-in, validation)
├── virtual/                 # Virtual operation generators
└── verify/                  # Hash comparison and logging
```

## Token Types

| Token | Description |
|-------|-------------|
| `SPS` | Liquid, transferable |
| `SPSP` | Staked SPS (suffix convention) |
| `LICENSE` | Transferable license token |
| `ACTIVATED_LICENSE` | Activated, non-transferable |
| `RUNNING_LICENSE` | Staked via validator operation |

## License

ISC
