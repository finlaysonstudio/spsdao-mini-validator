import { sha256 } from "js-sha256";
import type { StateStore } from "../state/index.mjs";
import type { ValidatorAccount } from "../config.mjs";

export interface CheckInNeeded {
  account: string;
  postingKey: string;
  refBlockNum: number;
  hash: string;
}

export interface ValidationNeeded {
  account: string;
  postingKey: string;
  blockNum: number;
  l2Hash: string;
}

const CHECK_IN_SAFETY_MARGIN = 10;

export function getAccountsNeedingCheckIn({
  accounts,
  state,
  currentBlock,
}: {
  accounts: ValidatorAccount[];
  state: StateStore;
  currentBlock: number;
}): CheckInNeeded[] {
  const intervalBlocks = state.config.getNumber(
    "validator_check_in",
    "check_in_interval_blocks",
    28800,
  );

  const results: CheckInNeeded[] = [];

  for (const { account, postingKey } of accounts) {
    const checkIn = state.checkIns.get(account);
    const needsCheckIn =
      !checkIn ||
      checkIn.status !== "active" ||
      currentBlock - checkIn.block_num >= intervalBlocks;

    if (!needsCheckIn) continue;

    const refBlockNum = currentBlock - CHECK_IN_SAFETY_MARGIN;
    const refBlock = state.blocks.get(refBlockNum);
    if (!refBlock) continue;

    const hash = sha256(refBlock.l2_block_id + account);
    results.push({ account, postingKey, refBlockNum, hash });
  }

  return results;
}

export function getAccountsSelectedForValidation({
  accounts,
  state,
  blockId,
  prevBlockId,
  blockNum,
  l2Hash,
}: {
  accounts: ValidatorAccount[];
  state: StateStore;
  blockId: string;
  prevBlockId: string;
  blockNum: number;
  l2Hash: string;
}): ValidationNeeded[] {
  const minValidators = state.config.getNumber(
    "validator",
    "min_validators",
    3,
  );

  const selected = state.validators.selectValidator(
    blockId,
    prevBlockId,
    minValidators,
  );
  if (!selected) return [];

  const match = accounts.find((a) => a.account === selected.account_name);
  if (!match) return [];

  return [
    {
      account: match.account,
      postingKey: match.postingKey,
      blockNum,
      l2Hash,
    },
  ];
}
