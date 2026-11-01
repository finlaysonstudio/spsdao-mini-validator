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
};
