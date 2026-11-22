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
  /** Directory for portable seed exports (format 2, loadable as SEED_FILE; empty = none). */
  snapshotDir: env("SNAPSHOT_DIR", ""),
  /** Export a seed every this many blocks (on multiples of it); 28800 ≈ one day. */
  snapshotEvery: envInt("SNAPSHOT_EVERY", 28800),
  /** Keep this many most recent seed exports. */
  snapshotKeep: envInt("SNAPSHOT_KEEP", 3),
  /** Upstream validator API used as hash reference (`/block/:n`); empty = no verification. */
  referenceApi: env("REFERENCE_API", ""),
  /** Verify against the reference every this many blocks (and always before a checkpoint). */
  verifyEvery: envInt("VERIFY_EVERY", 10000),
  /** Validator accounts to validate and check in for (comma-separated; VALIDATOR_ACCOUNT also accepted). Empty = observer only. */
  validatorAccounts: env("VALIDATOR_ACCOUNTS", env("VALIDATOR_ACCOUNT", ""))
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean),
  /**
   * "shadow": duties are computed and logged, nothing is signed or sent.
   * "live": duties are signed and broadcast. VALIDATOR_KEY holds one or more posting WIFs
   * (comma-separated); each account signs with the one holding its posting authority, and an
   * account none can sign for is skipped (kept in shadow). Keys are read once at startup and
   * removed from process.env; they are never part of this object.
   */
  validatorMode: env("VALIDATOR_MODE", "shadow") as "shadow" | "live",
  /** Fire Horse VALIDATE_BLOCK_DELAY: 0 = leader, > 0 = follower. */
  validateBlockDelay: envInt("VALIDATE_BLOCK_DELAY", 0),
  enableCheckIns: env("ENABLE_CHECK_INS", "true") === "true",
  checkInRetryBlocks: envInt("CHECK_IN_RETRY_BLOCKS", 100),
  /** Version string sent with validate_block / check_in_validator (recorded on chain as last_version). */
  validatorVersion: env("VALIDATOR_VERSION", "1.5.1-mini.0"),
  /** Price feed duty for top validators (upstream PriceFeedPlugin); needs at least one external feed. */
  enablePriceFeed: env("ENABLE_PRICE_FEED", "true") === "true",
  /** Upstream hive_engine_rpc_nodes, in failover order. */
  hiveEngineRpcNodes: env("HIVE_ENGINE_RPC_NODES", "https://api.hive-engine.com/rpc,https://engine.rishipanthee.com,https://herpc.dtools.dev,https://ha.herpc.dtools.dev,https://api.primersion.com,https://herpc.kanibot.com,https://ctpmain.com,https://herpc.actifit.io")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Upstream price_feed_* settings (same env names and defaults). The API keys are optional. */
  priceFeed: {
    dao: { api_url: env("PRICE_FEED_DAO_API_URL", "https://prices.splinterlands.workers.dev") },
    coinGecko: {
      api_url: env("PRICE_FEED_COIN_GECKO_API_URL", "https://pro-api.coingecko.com"),
      demo_api_url: env("PRICE_FEED_COIN_GECKO_DEMO_API_URL", "https://coingecko.com"),
      demo: env("PRICE_FEED_COIN_GECKO_DEMO", "false") === "true",
      api_key: env("PRICE_FEED_COIN_GECKO_API_KEY", ""),
    },
    coinMarketCap: {
      api_url: env("PRICE_FEED_COIN_MARKET_CAP_API_URL", "https://pro-api.coinmarketcap.com"),
      api_key: env("PRICE_FEED_COIN_MARKET_CAP_API_KEY", ""),
      token_map: JSON.parse(env("PRICE_FEED_COIN_MARKET_CAP_TOKEN_MAP", '{"HIVE":"5370"}')) as Record<string, string>,
    },
  },
  /** Append duty events (JSONL) here in addition to stdout. */
  dutyLog: env("DUTY_LOG", ""),
};
