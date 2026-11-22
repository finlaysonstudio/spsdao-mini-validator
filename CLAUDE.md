# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A minimal in-memory port of the TheSPSDAO/SPS-Validator block processor (target upstream
1.5.1) that computes identical L2 block hashes with no database or web UI, and performs
validator duties in shadow mode (log only) or live (signs and broadcasts; `src/validator/broadcast.mts`).
The upstream source is checked out at `~/Code/SPS-Validator`; a running upstream node's
Postgres is the ground truth for backtests. See README.md for usage.

## Commands

| Task | Command |
|------|---------|
| Run validator | `npm run dev --workspace packages/validator` |
| Typecheck | `npm run typecheck` |
| Extract seed | `npm run extract-seed --workspace packages/validator -- out.ndjson` (PG* env vars) |
| Backtest | `npm run dbdiff --workspace packages/validator` (PG*, SEED_FILE, BLOCK_CACHE_DIR, FOLLOW=1) |
| Container | `docker compose up -d --build` |

## Layout (packages/validator/src)

- `state/` in-memory tables (scaled-bigint numerics, hash sets for huge id sets)
- `repos/` one module per upstream repository/feature; event shapes are copied exactly
- `actions/` all actions + the block-range router; `actions/base.mts` is upstream `Action`
- `block/operation.mts`, `block/processor.mts` upstream `Operation` and `BlockProcessor`
- `virtual/sources.mts` the eight virtual payload sources in upstream order
- `bootstrap/seed.mts` NDJSON seed loader; `tools/` seed extractor and DB-diff harness
- `schema.mts` yup 0.32.11 schemas copied verbatim (params are the yup cast output)

## Parity rules (do not break)

- Event objects: `{object_type, event_type, data}` in that key order; `data` key order is
  the DB column order for `RETURNING *` rows, or the literal object order upstream builds.
- Numeric text is produced as Postgres would print it (`formatScaled`), and JS float math
  is used only where upstream does it in JS (e.g. `(record.amount + amount).toString()`).
- jsonb values are canonicalised (keys by length then bytewise, no exponents).
- Virtual sources run before block operations and compute payloads against block-start state.
- Anything not ported throws `UnsupportedPathError`; never silently approximate.
- `var/` holds seeds, block cache and logs and is gitignored.
