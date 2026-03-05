import type { StateStore } from "./state/index.mjs";
import type { TransactionEntity } from "./types.mjs";
import type { ActionContext } from "./operations/types.mjs";
import type { HiveBlock } from "./hive/types.mjs";
import { parseBlockActions } from "./operations/parser.mjs";
import { processAction } from "./operations/index.mjs";
import { runVirtualOperations } from "./virtual/index.mjs";
import { buildTransactionEntity } from "./hash/transaction.mjs";
import { computeL2Hash } from "./hash/index.mjs";

export interface VirtualOpBreakdown {
  source: string;
  count: number;
  transactions: TransactionEntity[];
}

export interface BlockDetail {
  blockNum: number;
  blockId: string;
  prevBlockId: string;
  blockTime: Date;
  prevL2Hash: string;
  l2Hash: string;
  hashInput: string;
  virtualTransactions: TransactionEntity[];
  blockchainTransactions: TransactionEntity[];
  allTransactions: TransactionEntity[];
  virtualOpBreakdown: VirtualOpBreakdown[];
  selectedValidator: string | null;
  activeValidatorCount: number;
}

export function processBlock(
  block: HiveBlock,
  blockNum: number,
  state: StateStore,
  prevL2Hash: string,
): BlockDetail {
  const blockTime = new Date(block.timestamp + "Z");
  const virtualTransactions: TransactionEntity[] = [];
  const blockchainTransactions: TransactionEntity[] = [];
  let globalIndex = 0;

  // 1. Virtual operations (before blockchain ops)
  const virtualResults = runVirtualOperations(state, blockNum, blockTime);
  const breakdownMap = new Map<
    string,
    { source: string; transactions: TransactionEntity[] }
  >();

  for (const { action, result, source } of virtualResults) {
    const txEntity = buildTransactionEntity(
      action,
      result,
      blockNum,
      globalIndex++,
      block.block_id,
      block.previous,
      blockTime,
    );
    virtualTransactions.push(txEntity);

    // Group by source for breakdown
    let entry = breakdownMap.get(source);
    if (!entry) {
      entry = { source, transactions: [] };
      breakdownMap.set(source, entry);
    }
    entry.transactions.push(txEntity);
  }

  // 2. Blockchain custom JSON operations (in block order)
  const blockActions = parseBlockActions(
    block.transactions,
    block.transaction_ids,
  );
  for (const action of blockActions) {
    const ctx: ActionContext = {
      state,
      blockNum,
      blockTime,
      blockId: block.block_id,
      prevBlockId: block.previous,
      trxId: action.trxId,
      actionType: action.name,
    };
    const result = processAction(action, ctx);
    if (result === null) continue;
    const txEntity = buildTransactionEntity(
      action,
      result,
      blockNum,
      globalIndex++,
      block.block_id,
      block.previous,
      blockTime,
    );
    blockchainTransactions.push(txEntity);
  }

  // 3. Handle create_claimed_account operations
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

  const allTransactions = [...virtualTransactions, ...blockchainTransactions];

  // 4. Compute L2 hash
  const hashInput = `${prevL2Hash}.${JSON.stringify(allTransactions)}`;
  const l2Hash = computeL2Hash(prevL2Hash, allTransactions);

  // 5. Store block reference
  state.blocks.set({
    block_num: blockNum,
    block_id: block.block_id,
    prev_block_id: block.previous,
    block_time: blockTime,
    l2_block_id: l2Hash,
  });

  // Validator selection info
  const minValidators = state.config.getNumber(
    "validator",
    "min_validators",
    3,
  );
  const selected = state.validators.selectValidator(
    block.block_id,
    block.previous,
    minValidators,
  );
  const activeValidatorCount = state.validators.getActive().length;

  // Build breakdown
  const virtualOpBreakdown: VirtualOpBreakdown[] = [];
  for (const entry of breakdownMap.values()) {
    virtualOpBreakdown.push({
      source: entry.source,
      count: entry.transactions.length,
      transactions: entry.transactions,
    });
  }

  return {
    blockNum,
    blockId: block.block_id,
    prevBlockId: block.previous,
    blockTime,
    prevL2Hash,
    l2Hash,
    hashInput,
    virtualTransactions,
    blockchainTransactions,
    allTransactions,
    virtualOpBreakdown,
    selectedValidator: selected?.account_name ?? null,
    activeValidatorCount,
  };
}
