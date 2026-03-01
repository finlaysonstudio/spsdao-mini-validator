# SPS Validator Protocol Spec — Independent Reimplementation

## Context

Spec for building a TypeScript/Node SPS validator from scratch that produces **identical L2 hashes** to the existing network. Scope: license rewards only (process blocks, compute hashes, check in, validate when selected). Must handle all operation types to maintain hash compatibility.

---

## 1. Core Loop

For each Hive block (sequentially, starting from snapshot's last block):

1. Fetch block from Hive RPC via `block_api.get_block`
2. Apply microfork transforms (skip transactions in known-bad blocks)
3. **Within a single atomic DB transaction:**
   a. Process virtual operations (before blockchain ops)
   b. Process blockchain custom JSON operations (in block order)
   c. Build `TransactionEntity[]` array from all action results
   d. Compute L2 hash: `SHA256(prev_l2_hash + "." + JSON.stringify(transactions))`
   e. Store block + hash
4. If this node was selected to validate, broadcast validation to Hive
5. Periodically broadcast check-in to Hive

---

## 2. Hive Block Streaming

- **RPC method**: POST `block_api.get_block` to any node in `RPC_NODES`
- **Head mode**: `irreversible` (default), lag `BLOCKS_BEHIND_HEAD` (default 5)
- **Batch size**: `REPLAY_BATCH_SIZE` (default 25) blocks fetched in parallel during catch-up
- **Block fields used**: `block_id`, `previous`, `timestamp`, `transactions[]`, `transaction_ids[]`

### Timestamp parsing
```
block_time = new Date(block.timestamp + "Z")
```
Hive timestamps lack timezone — append `Z` for UTC.

### PRNG (for validator selection)
```
prng = seedrandom(block.block_id + block.previous)
```

---

## 3. Operation Filtering

From each Hive block, extract `custom_json` operations where:
- `op[1].id === CUSTOM_JSON_ID` (e.g., `"sps"` or `"sm_sps"`), OR
- `op[1].id.startsWith(CUSTOM_JSON_PREFIX)` (e.g., `"sm_"`)

Also process `create_claimed_account` operations (upsert into `hive_accounts`).

### Two JSON formats

**Prefix format** (`id.startsWith(prefix)`):
```json
id: "sm_token_transfer"
json: { "to": "alice", "qty": 100, "token": "SPS" }
```
→ action name = `id` minus prefix (e.g., `"token_transfer"`), params = json body

**ID format** (`id === custom_json_id`):
```json
id: "sps"
json: { "action": "token_transfer", "params": { "to": "alice", "qty": 100, "token": "SPS" } }
```
Or an array of such objects for batch operations.

### Authorization
Actions in this list require **posting auth** (checked via `required_posting_auths`):
```
token_award, stake_tokens, stake_tokens_multi, unstake_tokens,
claim_staking_rewards, cancel_unstake_tokens, delegate_tokens,
undelegate_tokens, undelegate_tokens_multi, return_tokens,
fulfill_promise, fulfill_promise_multi, activate_license,
deactivate_license, validate_block, check_in_validator, price_feed
```
All others require **active auth** (`required_auths`). Unauthorized actions are silently dropped.

---

## 4. L2 Hash Calculation (Critical)

### TransactionEntity shape (what gets JSON.stringified)

```typescript
{
  id: string,              // unique_trx_id (see below)
  created_date: Date,      // block_time — serializes as ISO 8601 via toJSON()
  block_num: number,
  index: number,           // 0-based position across ALL actions in this block
  block_id: string,        // Hive block_id
  prev_block_id: string,   // Hive previous
  type: string,            // action name (e.g., "token_transfer")
  player: string,          // action.players[0]
  data: string | null,     // JSON.stringify(action.params)
  success: boolean | null, // true/false/null
  error: string | null,    // JSON.stringify(error.code) — just the numeric code
  result: string | null    // JSON.stringify({ events: EventLog[] })
}
```

### unique_trx_id construction

```
transaction_id = hive transaction ID from block.transaction_ids[i]
                 (for virtual ops: custom string like "sl_token_unstaking_SPS_12345")

op_index = operation index within the Hive transaction
trx_op_id = op_index > 0 ? `${transaction_id}-${op_index}` : transaction_id

action_index = index of action within a batch (when JSON is an array)
unique_trx_id = action_index > 0 ? `${trx_op_id}.${action_index}` : trx_op_id
```

### Hash formula

```typescript
import { sha256 } from 'js-sha256';

const transactions: TransactionEntity[] = /* all actions from virtual + blockchain ops */;
const hash = sha256(`${prev_block_l2_hash}.${JSON.stringify(transactions)}`);
```

**`prev_block_l2_hash`** comes from the previous block's stored `l2_block_id`.

### JSON.stringify determinism

The `TransactionEntity` is a plain object built in code (not fetched from DB), so `JSON.stringify` key order matches declaration order above. `Date.toJSON()` produces `"YYYY-MM-DDTHH:mm:ss.sssZ"`. This is the exact format that goes into the hash.

---

## 5. Processing Order (Critical)

Within a single block, actions are accumulated in this exact order:

1. **Virtual operations** — from each `VirtualPayloadSource`, in registration order:
   - `TokenUnstakingRepository` → `token_unstaking`
   - `PoolClaimPayloads` → `claim_pool`
   - `SpsClearBurnedTokensSource` → `burn`
   - `PromiseManager` → `expire_promises`
   - `SpsValidatorLicenseManager` → `expire_check_ins`
   - `SpsUpdateMissedBlocksSource` → `update_missed_blocks`
   - `TransitionManager` → various `transition_*` ops at specific block numbers

2. **Blockchain operations** — in Hive block transaction order, then operation order within each transaction

The `index` field in `TransactionEntity` is 0-based across ALL actions (virtual first, then blockchain), incrementing sequentially.

---

## 6. All Operation Types

Every operation must be handled correctly to produce matching hashes. The hash includes action params, success/failure, error codes, and event logs.

### Real operations (from Hive custom_json)

| Action | State modified |
|--------|---------------|
| `token_transfer` | balances |
| `token_transfer_multi` | balances |
| `token_award` | balances |
| `burn` | balances |
| `stake_tokens` | balances |
| `stake_tokens_multi` | balances |
| `unstake_tokens` | token_unstaking |
| `cancel_unstake_tokens` | token_unstaking |
| `delegate_tokens` | active_delegations, balances |
| `undelegate_tokens` | active_delegations, balances |
| `undelegate_tokens_multi` | active_delegations, balances |
| `return_tokens` | active_delegations, balances |
| `claim_staking_rewards` | balances, staking_pool_reward_debt |
| `shop_purchase` | balances |
| `approve_validator` | validators |
| `unapprove_validator` | validators |
| `update_validator` | validators |
| `check_in_validator` | validator_check_in, validators |
| `activate_license` | balances (LICENSE → ACTIVATED_LICENSE) |
| `deactivate_license` | balances (ACTIVATED_LICENSE → LICENSE) |
| `validate_block` | blocks (validation_tx) |
| `price_feed` | price_history |
| `add_pool` | pools |
| `update_pool` | pools |
| `disable_pool` | pools |
| `create_promise` | promise |
| `fulfill_promise` | promise, balances |
| `fulfill_promise_multi` | promise, balances |
| `complete_promise` | promise |
| `cancel_promise` | promise |
| `reverse_promise` | promise |
| `set_authority` | config |
| `config_update` | config |

### Virtual operations (system-generated per block)

| Source | Action | trx_id format |
|--------|--------|---------------|
| TokenUnstaking | `token_unstaking` | `sl_token_unstaking_{token}_{block_num}` |
| PoolClaims | `claim_pool` | `sl_claim_pool_{pool_name}_{block_num}` |
| BurnCleanup | `burn` | `clear_burned_{block_num}@{timestamp}` |
| PromiseManager | `expire_promises` | `sl_expire_promises_{block_num}` |
| LicenseManager | `expire_check_ins` | `sl_expire_check_ins_{block_num}` |
| MissedBlocks | `update_missed_blocks` | `update_missed_blocks_{block_num}@{timestamp}` |
| TransitionManager | `transition_*` | `sl_{action_name}_{block_num}` |

---

## 7. Validator Selection

Determines which validator should validate each block:

```
active_validators = all validators where is_active=true AND total_votes > 0
                    ordered by total_votes DESC, account_name ASC

if active_validators.length < min_validators: no validator selected

total_votes = sum of all active_validators.total_votes
index = prng() * total_votes    // prng seeded per block (see §2)

running_total = 0
for each validator in active_validators:
    running_total += validator.total_votes
    if index < running_total: return validator
```

Stake-weighted, deterministic (same block always selects same validator).

---

## 8. Check-In Mechanism

### When to check in
- At least `check_in_interval_blocks` (default 28800, ~10 days) since last check-in
- Referenced block must be within `check_in_window_blocks` (default 300) of current head

### Check-in hash
```
check_in_hash = SHA256(l2_block_id_of_referenced_block + validator_account_name)
```

### Broadcast format
```json
{
  "id": "sm_sps",
  "json": {
    "action": "check_in_validator",
    "params": {
      "block_num": 12345678,
      "hash": "<check_in_hash>",
      "version": "1.2.3"
    }
  },
  "required_posting_auths": ["validator_account"],
  "required_auths": []
}
```

### Expiration
If no check-in within `check_in_window_blocks + check_in_interval_blocks`, the `expire_check_ins` virtual op fires, marking the validator inactive and unstaking RUNNING_LICENSE tokens.

---

## 9. Block Validation Broadcast

When this node is the selected validator for a block:

```json
{
  "id": "sm_sps",
  "json": {
    "action": "validate_block",
    "params": {
      "block_num": 12345678,
      "hash": "<l2_block_id>",
      "version": "1.2.3"
    }
  },
  "required_posting_auths": ["validator_account"],
  "required_auths": []
}
```

Max block age for validation: `max_block_age` config (default 100 blocks).

---

## 10. Token Types

```
SPS              — liquid, transferable
SPSP             — staked SPS, not transferable, supports delegation
SPSP-IN / OUT    — delegation tracking tokens
LICENSE          — transferable, precision 0
ACTIVATED_LICENSE — non-transferable, converted from LICENSE
RUNNING_LICENSE  — staked ACTIVATED_LICENSE, earns validator_rewards pool
```

License lifecycle: `LICENSE → activate → ACTIVATED_LICENSE → (valid check-in) → RUNNING_LICENSE (staked, earns rewards)`

---

## 11. Bootstrap

A node starts from a **snapshot** (SQL dump of all state at a known block). It then replays blocks forward from that point. The snapshot includes: balances, validators, votes, check-ins, delegations, config, promises, pools, recent blocks.

---

## 12. Microfork Handling

Certain Hive blocks had node microforks producing inconsistent data. The validator hardcodes these blocks and replaces them with empty transactions to maintain hash chain consistency. These are encoded as "transition points" checked per block.

---

## 13. Configuration

### Environment variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `CUSTOM_JSON_ID` | `sps` | Primary action ID |
| `CUSTOM_JSON_PREFIX` | `sm_` | Action prefix |
| `RPC_NODES` | hive API nodes | Comma-separated Hive RPCs |
| `BLOCKS_BEHIND_HEAD` | `5` | Lag behind chain head |
| `BLOCKS_HEAD_MODE` | `irreversible` | Head block mode |
| `REPLAY_BATCH_SIZE` | `25` | Parallel fetch during replay |
| `VALIDATOR_ACCOUNT` | — | Hive account for broadcasting |
| `VALIDATOR_KEY` | — | Private posting key |
| `DB_BLOCK_RETENTION` | — | Blocks to retain (empty=all) |

### Database config (stored in `config` table)
| Group | Key | Default |
|-------|-----|---------|
| `validator` | `min_validators` | `3` |
| `validator` | `tokens_per_block` | `4.34` |
| `validator` | `max_block_age` | `100` |
| `validator` | `reduction_blocks` | `864000` |
| `validator` | `reduction_pct` | `1` |
| `validator_check_in` | `check_in_interval_blocks` | `28800` |
| `validator_check_in` | `check_in_window_blocks` | `300` |

---

## 14. Key Libraries

| Library | Purpose |
|---------|---------|
| `js-sha256` | SHA256 for L2 hash and check-in hash |
| `seedrandom` | Deterministic PRNG for validator selection |
| `splinterlands-dhive-sl` | Hive blockchain client (block fetching, broadcasting) |

---

## 15. Critical Determinism Requirements

For identical hashes across implementations:

1. **JSON.stringify key order** must match `TransactionEntity` field declaration order
2. **Date serialization**: `Date.toJSON()` → `"YYYY-MM-DDTHH:mm:ss.sssZ"`
3. **Virtual ops processed before blockchain ops**, in source registration order
4. **Action index** is global across all actions in the block (virtual + real), 0-based
5. **Error serialization**: `JSON.stringify(error.code)` — just the numeric code, not the full error object
6. **Result serialization**: `JSON.stringify({ events: EventLog[] })` — wraps event logs in `{ events: ... }`
7. **Numeric precision**: balances stored as `numeric(15,3)` — 3 decimal places
8. **Transition points**: hardcoded block numbers where protocol changes fire (must match exactly)
