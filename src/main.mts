import { PrivateKey } from "@hiveio/dhive";
import { config } from "./config.mjs";
import { StateStore } from "./state/index.mjs";
import { bootstrap } from "./bootstrap/index.mjs";
import { streamBlocks } from "./hive/stream.mjs";
import { parseBlockActions } from "./operations/parser.mjs";
import { processAction } from "./operations/index.mjs";
import { runVirtualOperations } from "./virtual/index.mjs";
import { buildTransactionEntity } from "./hash/transaction.mjs";
import { computeL2Hash } from "./hash/index.mjs";
import { verifyHash, logVerifyResult } from "./verify/index.mjs";
import { afterBlock } from "./validator/index.mjs";
import type { TransactionEntity } from "./types.mjs";
import type { ActionContext } from "./operations/types.mjs";

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
    const blockTime = new Date(block.timestamp + "Z");

    const ctx: ActionContext = {
      state,
      blockNum,
      blockTime,
      blockId: block.block_id,
      prevBlockId: block.previous,
    };

    const allTransactions: TransactionEntity[] = [];
    let globalIndex = 0;

    // 1. Virtual operations (before blockchain ops)
    const virtualResults = runVirtualOperations(state, blockNum, blockTime);
    for (const { action, result } of virtualResults) {
      const txEntity = buildTransactionEntity(
        action,
        result,
        blockNum,
        globalIndex++,
        block.block_id,
        block.previous,
        blockTime,
      );
      allTransactions.push(txEntity);
    }

    // 2. Blockchain custom JSON operations (in block order)
    const blockActions = parseBlockActions(
      block.transactions,
      block.transaction_ids,
    );
    for (const action of blockActions) {
      // Process create_claimed_account — handled in parser as regular ops
      const result = processAction(action, ctx);
      const txEntity = buildTransactionEntity(
        action,
        result,
        blockNum,
        globalIndex++,
        block.block_id,
        block.previous,
        blockTime,
      );
      allTransactions.push(txEntity);
    }

    // 3. Handle create_claimed_account operations (upsert into hive_accounts)
    for (const tx of block.transactions) {
      for (const op of tx.operations) {
        if (op.type === "create_claimed_account_operation") {
          const newAccount = (op.value as { new_account_name?: string })
            .new_account_name;
          if (newAccount) {
            state.hiveAccounts.add(newAccount);
          }
        }
      }
    }

    // 4. Compute L2 hash
    const l2Hash = computeL2Hash(currentPrevL2Hash, allTransactions);

    // 5. Store block reference
    state.blocks.set({
      block_num: blockNum,
      block_id: block.block_id,
      prev_block_id: block.previous,
      block_time: blockTime,
      l2_block_id: l2Hash,
    });

    // 6. Active validator participation (only near head)
    if (nearHead) {
      afterBlock({
        state,
        blockNum,
        blockId: block.block_id,
        prevBlockId: block.previous,
        l2Hash,
      });
    }

    // 7. Verify against known hashes
    const verification = verifyHash(blockNum, l2Hash, knownHashes);
    if (verification) {
      logVerifyResult(verification);
      if (!verification.match) {
        console.error(`\nHALTING: Hash mismatch at block ${blockNum}`);
        console.error(`  Transactions in block: ${allTransactions.length}`);
        console.error(
          `  All transactions:\n${JSON.stringify(allTransactions, null, 2)}`,
        );
        process.exit(1);
      }
      consecutiveMatches++;
    }

    currentPrevL2Hash = l2Hash;
    blocksProcessed++;

    // Progress logging
    if (blocksProcessed % 100 === 0) {
      console.log(
        `Block ${blockNum} | ${blocksProcessed} processed | ${allTransactions.length} txns | hash: ${l2Hash.slice(0, 12)}... | ${consecutiveMatches} verified`,
      );
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
