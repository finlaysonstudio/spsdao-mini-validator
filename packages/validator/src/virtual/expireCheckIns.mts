import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult, EventLog } from "../types.mjs";
import {
  addBalance,
  subtractBalance,
  combineBalanceEvents,
} from "../operations/balanceOps.mjs";

export function generateExpireCheckIns(
  state: StateStore,
  blockNum: number,
  blockTime: Date,
): { action: ParsedAction; result: OperationResult }[] {
  const intervalBlocks = state.config.getNumber(
    "validator_check_in",
    "check_in_interval_blocks",
    28800,
  );
  const windowBlocks = state.config.getNumber(
    "validator_check_in",
    "check_in_window_blocks",
    300,
  );

  const expired = state.checkIns.getExpired(
    blockNum,
    intervalBlocks,
    windowBlocks,
  );
  if (expired.length === 0) return [];

  const trxId = `sl_expire_check_ins_${blockNum}`;
  const balCtx = {
    state,
    blockTime,
    blockNum,
    trxId,
    actionType: "expire_check_ins",
  };

  const otherEvents: EventLog[] = [];
  const balResults = [];

  for (const checkIn of expired) {
    // Deactivate the validator
    const validator = state.validators.get(checkIn.account);
    if (validator) {
      validator.is_active = false;
      state.validators.set(validator);

      // Unstake RUNNING_LICENSE
      const runningLicenseBalance = state.balances.get(
        checkIn.account,
        "RUNNING_LICENSE",
      );
      if (runningLicenseBalance > 0) {
        const sub = subtractBalance(
          balCtx,
          checkIn.account,
          "RUNNING_LICENSE",
          runningLicenseBalance,
        );
        if (sub) {
          balResults.push(sub);
        }
        const add = addBalance(
          balCtx,
          checkIn.account,
          "ACTIVATED_LICENSE",
          runningLicenseBalance,
        );
        balResults.push(add);
      }
    }

    state.checkIns.setInactive(checkIn.account);

    otherEvents.push({
      object_type: "check_ins",
      event_type: "update",
      data: { account: checkIn.account },
    });
  }

  const events = combineBalanceEvents(otherEvents, ...balResults);

  return [
    {
      action: {
        name: "expire_check_ins",
        players: ["$LICENSE_MANAGER"],
        params: {},
        trxId,
        opIndex: 0,
        actionIndex: 0,
      },
      result: { success: true, events },
    },
  ];
}
