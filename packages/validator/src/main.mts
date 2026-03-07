import { PrivateKey } from "@hiveio/dhive";
import { config } from "./config.mjs";
import { StateStore } from "./state/index.mjs";
import { bootstrap } from "./bootstrap/index.mjs";
import { streamBlocks } from "./hive/stream.mjs";
import { processBlock } from "./pipeline.mjs";
import { verifyHash, logVerifyResult } from "./verify/index.mjs";
import { afterBlock } from "./validator/index.mjs";

async function main() {
  console.log("SPS Mini Validator starting...");

  const state = new StateStore();
  const { startBlock, prevL2Hash, knownHashes } = await bootstrap(
    state,
    config.seedFile,
  );

  // Validate posting keys at startup
  for (const v of config.validators) {
    PrivateKey.fromString(v.postingKey); // throws if invalid WIF
  }

  let currentPrevL2Hash = prevL2Hash;
  let blocksProcessed = 0;
  let consecutiveMatches = 0;

  console.log(`Starting from block ${startBlock}`);
  console.log(`RPC nodes: ${config.rpcNodes.join(", ")}`);
  if (config.validators.length > 0) {
    console.log(
      `Validator accounts: ${config.validators.map((v) => v.account).join(", ")}`,
    );
  }
  console.log("");

  for await (const { block, blockNum, nearHead } of streamBlocks(startBlock)) {
    const detail = processBlock(block, blockNum, state, currentPrevL2Hash);

    // Active validator participation (only near head)
    if (nearHead) {
      afterBlock({
        state,
        blockNum,
        blockId: block.block_id,
        prevBlockId: block.previous,
        l2Hash: detail.l2Hash,
      });
    }

    // Verify against known hashes
    const verification = verifyHash(blockNum, detail.l2Hash, knownHashes);
    if (verification) {
      logVerifyResult(verification);
      if (!verification.match) {
        console.error(`\nHALTING: Hash mismatch at block ${blockNum}`);
        console.error(
          `  Transactions in block: ${detail.allTransactions.length}`,
        );
        console.error(
          `  All transactions:\n${JSON.stringify(detail.allTransactions, null, 2)}`,
        );
        process.exit(1);
      }
      consecutiveMatches++;
    }

    currentPrevL2Hash = detail.l2Hash;
    blocksProcessed++;

    // Progress logging
    if (blocksProcessed % 100 === 0) {
      console.log(
        `Block ${blockNum} | ${blocksProcessed} processed | ${detail.allTransactions.length} txns | hash: ${detail.l2Hash.slice(0, 12)}... | ${consecutiveMatches} verified`,
      );
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
