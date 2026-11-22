# Plan / status

The previous from-first-principles implementation never reached hash parity (it diverged on
the first block after its seed). It was replaced (branch `feat/parity-rewrite`) by a direct
port of the upstream 1.5.1 processing core; see README.md and CLAUDE.md.

Status:
- [x] Port repositories, actions, virtual sources, processor
- [x] Consistent seed extraction from a live upstream DB
- [x] DB-diff backtest harness; first blocks after the seed match exactly
- [x] Validator container (no DB; keys only in live mode)
- [ ] Multi-day soak: validator hash log vs upstream DB (`var/check-hashes.sh`)
- [ ] Port remaining rare paths if they ever appear (see README "Known gaps")
- [ ] Reduce memory further (compact promise params, drop balance rows that are zero)
