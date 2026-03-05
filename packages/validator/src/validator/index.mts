import { config } from "../config.mjs";
import { broadcastCustomJson } from "../hive/broadcast.mjs";
import type { StateStore } from "../state/index.mjs";
import {
  getAccountsNeedingCheckIn,
  getAccountsSelectedForValidation,
} from "./accounts.mjs";

export function afterBlock({
  state,
  blockNum,
  blockId,
  prevBlockId,
  l2Hash,
}: {
  state: StateStore;
  blockNum: number;
  blockId: string;
  prevBlockId: string;
  l2Hash: string;
}): void {
  if (config.validators.length === 0) return;

  const checkIns = getAccountsNeedingCheckIn({
    accounts: config.validators,
    state,
    currentBlock: blockNum,
  });

  for (const ci of checkIns) {
    const json = JSON.stringify([
      {
        action: "check_in_validator",
        params: { block_num: ci.refBlockNum, hash: ci.hash },
      },
    ]);
    broadcastCustomJson({
      account: ci.account,
      postingKey: ci.postingKey,
      id: config.customJsonId,
      json,
      action: "check_in_validator",
      blockNum,
    });
  }

  const validations = getAccountsSelectedForValidation({
    accounts: config.validators,
    state,
    blockId,
    prevBlockId,
    blockNum,
    l2Hash,
  });

  for (const v of validations) {
    const json = JSON.stringify([
      {
        action: "validate_block",
        params: { block_num: v.blockNum, hash: v.l2Hash },
      },
    ]);
    broadcastCustomJson({
      account: v.account,
      postingKey: v.postingKey,
      id: config.customJsonId,
      json,
      action: "validate_block",
      blockNum,
    });
  }
}
