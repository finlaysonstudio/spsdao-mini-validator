const env = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

const envInt = (key: string, fallback: number): number => {
  const v = process.env[key];
  return v !== undefined ? parseInt(v, 10) : fallback;
};

export const config = {
  customJsonId: env("CUSTOM_JSON_ID", "sps"),
  customJsonPrefix: env("CUSTOM_JSON_PREFIX", "sm_"),

  rpcNodes: env(
    "RPC_NODES",
    "https://api.hive.blog,https://api.deathwing.me,https://anyx.io",
  ).split(","),

  blocksBehindHead: envInt("BLOCKS_BEHIND_HEAD", 5),
  blocksHeadMode: env("BLOCKS_HEAD_MODE", "irreversible") as
    | "irreversible"
    | "head",
  replayBatchSize: envInt("REPLAY_BATCH_SIZE", 25),

  validatorAccount: env("VALIDATOR_ACCOUNT", ""),
  validatorKey: env("VALIDATOR_KEY", ""),

  dbBlockRetention: envInt("DB_BLOCK_RETENTION", 0),

  seedFile: env("SEED_FILE", "seed.json"),
};
