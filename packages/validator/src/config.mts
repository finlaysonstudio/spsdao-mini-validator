export interface ValidatorAccount {
  account: string;
  postingKey: string;
}

const env = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

const envInt = (key: string, fallback: number): number => {
  const v = process.env[key];
  return v !== undefined ? parseInt(v, 10) : fallback;
};

function parseValidators(raw: string): ValidatorAccount[] {
  if (!raw) return [];
  return raw.split(",").map((entry) => {
    const colonIdx = entry.indexOf(":");
    if (colonIdx <= 0 || colonIdx === entry.length - 1) {
      throw new Error(
        `Invalid VALIDATORS entry "${entry}" — expected "account:postingKey"`,
      );
    }
    return {
      account: entry.slice(0, colonIdx).trim(),
      postingKey: entry.slice(colonIdx + 1).trim(),
    };
  });
}

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

  validators: parseValidators(env("VALIDATORS", "")),

  dbBlockRetention: envInt("DB_BLOCK_RETENTION", 0),

  seedFile: env("SEED_FILE", "seed.json"),
};
