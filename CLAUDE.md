# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A lightweight TypeScript/Node validator for the Splinterlands SPS layer-2 blockchain. It computes L2 block hashes independently without a database, achieving hash-for-hash parity with the production `TheSPSDAO/SPS-Validator`. The upstream repo is indexed in DeepWiki for reference.

## Commands

| Task | Command |
|------|---------|
| Run | `npm run dev` (uses tsx) |
| Build | `npm run build` (tsc → dist/) |
| Lint | `npm run lint` |
| Test | `npm test` |
| Test (watch) | `npm run test:watch` |
| Sort package.json | `npm run sort` |

Tests use Vitest. Test files live alongside source as `src/**/*.spec.mts`.

## Architecture

**ESM-only** (`"type": "module"`). All source files use `.mts` extension. Node 22+.

### Processing Pipeline (src/main.mts)

Each Hive block is processed sequentially:

1. **Virtual operations** — 7 system-generated op types in strict order (src/virtual/)
2. **Blockchain operations** — Parse `custom_json` from Hive block (src/operations/parser.mts), dispatch to 26 handlers (src/operations/handlers/)
3. **Build TransactionEntity[]** — Each op gets a global index (virtual ops first, then blockchain ops)
4. **Compute L2 hash** — `SHA256(prevHash + "." + JSON.stringify(transactions))`
5. **Verify** — Compare against known hashes from seed; halt on mismatch
6. **Validator participation** — Check-ins and block validation broadcasts when near head

### State (src/state/)

All state is in-memory. `StateStore` composes 11 specialized stores (balances, validators, delegations, unstaking, pools, promises, check-ins, config, blocks, priceHistory, hiveAccounts). Bootstrapped from `seed.json` snapshot at a known block.

### Determinism Requirements

Hash parity with the upstream validator is the core correctness criterion. These are **critical invariants**:

- `TransactionEntity` field order in the type definition dictates JSON.stringify key order — do not reorder fields
- Virtual ops run before blockchain ops; virtual op categories execute in their registration order in src/virtual/index.mts
- `globalIndex` increments across all ops in a block (virtual + blockchain)
- All token amounts use 3-decimal precision via `round3(value * 1000) / 1000`
- Date serialization uses `Date.toJSON()` producing ISO 8601 format
- Error serialization: only the numeric code, not the full error object
- Result serialization: wrapped in `{ events: [...] }`

### Key Modules

- **src/hive/client.mts** — RPC client with automatic node rotation on failure
- **src/hive/stream.mts** — Batch fetch (25 blocks) during catch-up, single-block near head
- **src/hive/broadcast.mts** — Check-in and validation broadcasts to Hive
- **src/operations/parser.mts** — Extracts custom_json; handles two formats (prefix `sm_*` and ID `sps`)
- **src/hash/transaction.mts** — Builds TransactionEntity from action + result
- **src/hash/trxId.mts** — Unique transaction ID generation (virtual ops use special format)
- **src/validator/accounts.mts** — Stake-weighted PRNG validator selection; check-in logic

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SEED_FILE` | `seed.json` | Bootstrap state snapshot |
| `RPC_NODES` | 3 Hive API nodes | Comma-separated RPC endpoints |
| `BLOCKS_BEHIND_HEAD` | 5 | Lag behind chain head |
| `VALIDATORS` | (empty) | `account:postingKey` pairs, comma-separated |
| `BLOCKS_HEAD_MODE` | `irreversible` | `irreversible` or `head` |
| `REPLAY_BATCH_SIZE` | 25 | Blocks fetched in parallel during catch-up |

## Reference

- **PLAN.md** — Detailed protocol spec and design decisions
- **AGENTS.md** — Notes on DeepWiki access for the upstream repo
- **seed.json** — ~125MB state snapshot (gitignored binary)
