const env = (key: string, fallback: string): string => process.env[key] ?? fallback;
const envInt = (key: string, fallback: number): number => {
  const v = process.env[key];
  return v !== undefined ? parseInt(v, 10) : fallback;
};

export const config = {
  customJsonId: env("CUSTOM_JSON_ID", "sm_sps"),
  customJsonPrefix: env("CUSTOM_JSON_PREFIX", "sm_"),
  rpcNodes: env("RPC_NODES", "https://api.hive.blog,https://api.deathwing.me,https://api.openhive.network,https://techcoderx.com,https://rpc.mahdiyari.info").split(","),
  blocksBehindHead: envInt("BLOCKS_BEHIND_HEAD", 6),
  blocksHeadMode: env("BLOCKS_HEAD_MODE", "irreversible") as "irreversible" | "head",
  replayBatchSize: envInt("REPLAY_BATCH_SIZE", 25),
  seedFile: env("SEED_FILE", "seed.ndjson"),
  /** Optional on-disk cache of raw Hive blocks (JSON per block) for repeated replays. */
  blockCacheDir: env("BLOCK_CACHE_DIR", ""),
  /** Stop after this block (0 = never). */
  stopBlock: envInt("STOP_BLOCK", 0),
  /** Write `block_num l2_block_id` lines here in addition to stdout. */
  hashLog: env("HASH_LOG", ""),
  /** Keep retrying a failing RPC call (with backoff) this long before it is fatal. */
  rpcRetryDeadlineMs: envInt("RPC_RETRY_DEADLINE_MS", 600000),
  /** Per-request RPC timeout. */
  rpcTimeoutMs: envInt("RPC_TIMEOUT_MS", 60000),
  /** Compact 1000-block chunk cache (see hive/chunks.mts); used while more than a chunk behind head. */
  chunkCacheDir: env("CHUNK_CACHE_DIR", ""),
  /** Directory for periodic state checkpoints (empty = none). */
  checkpointDir: env("CHECKPOINT_DIR", ""),
  /** Write a checkpoint every this many blocks (on multiples of it). */
  checkpointEvery: envInt("CHECKPOINT_EVERY", 100000),
  /** Keep this many most recent checkpoints, plus every one on a multiple of CHECKPOINT_KEEP_EVERY. */
  checkpointKeep: envInt("CHECKPOINT_KEEP", 5),
  checkpointKeepEvery: envInt("CHECKPOINT_KEEP_EVERY", 1000000),
  /** Upstream validator API used as hash reference (`/block/:n`); empty = no verification. */
  referenceApi: env("REFERENCE_API", ""),
  /** Verify against the reference every this many blocks (and always before a checkpoint). */
  verifyEvery: envInt("VERIFY_EVERY", 10000),
  /** Validator accounts to validate and check in for (comma-separated; VALIDATOR_ACCOUNT also accepted). Empty = observer only. */
  validatorAccounts: env("VALIDATOR_ACCOUNTS", env("VALIDATOR_ACCOUNT", ""))
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean),
  /** Only "shadow" exists: duties are computed and logged, nothing is signed or sent. */
  validatorMode: env("VALIDATOR_MODE", "shadow"),
  /** Fire Horse VALIDATE_BLOCK_DELAY: 0 = leader, > 0 = follower. */
  validateBlockDelay: envInt("VALIDATE_BLOCK_DELAY", 0),
  enableCheckIns: env("ENABLE_CHECK_INS", "true") === "true",
  checkInRetryBlocks: envInt("CHECK_IN_RETRY_BLOCKS", 100),
  /** Version string sent with validate_block / check_in_validator (recorded on chain as last_version). */
  validatorVersion: env("VALIDATOR_VERSION", "1.5.1-mini.0"),
  /** Append duty events (JSONL) here in addition to stdout. */
  dutyLog: env("DUTY_LOG", ""),
};
