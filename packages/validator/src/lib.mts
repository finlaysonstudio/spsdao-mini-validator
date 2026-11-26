/**
 * Library surface for embedding the validator (for example in a scheduled Lambda that replays a
 * range of blocks and persists the state elsewhere). Everything a host needs to load state,
 * replay, verify, persist and perform validator duties is exported here, so hosts depend on one
 * entry point rather than on the source layout.
 */
export { BlockProcessor, type ProcessedBlock } from "./block/processor.mjs";
export {
  exportSeed,
  manifestPath,
  SEED_FORMAT,
  sha256File,
  writeSnapshot,
  type SeedManifest,
} from "./bootstrap/export.mjs";
export { loadSeed, type SeedMeta } from "./bootstrap/seed.mjs";
export { readSeedMeta } from "./commands/verify.mjs";
export { config } from "./config.mjs";
export { getAccounts, getDynamicGlobalProperties, getHeadBlockNum, type HiveAccount } from "./hive/client.mjs";
export { ReferenceApi, type RefBlock } from "./hive/reference.mjs";
export { streamBlocks } from "./hive/stream.mjs";
export type { HiveBlock } from "./hive/types.mjs";
export { Services } from "./services.mjs";
export {
  listCheckpoints,
  loadCheckpoint,
  pruneCheckpoints,
  writeCheckpoint,
  type CheckpointMeta,
} from "./state/checkpoint.mjs";
export { StateStore } from "./state/index.mjs";
export { deterministicPow } from "./util/pow.mjs";
export { defaultValidatorVersion, UPSTREAM_VERSION } from "./version.mjs";
export {
  LiveBroadcaster,
  parseKeys,
  resolveSigners,
  type Chain,
  type Signer,
  type SkippedAccount,
} from "./validator/broadcast.mjs";
export {
  ValidatorDuties,
  type Broadcaster,
  type BroadcastRequest,
  type DutiesOptions,
  type DutyEvent,
} from "./validator/duties.mjs";
