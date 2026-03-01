import type { StateStore } from "../state/index.mjs";
import type { ParsedAction } from "../operations/types.mjs";
import type { OperationResult, EventLog } from "../types.mjs";

export function generateExpireCheckIns(
  state: StateStore,
  blockNum: number,
  _blockTime: Date,
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

  const events: EventLog[] = [];

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
        state.balances.subtract(
          checkIn.account,
          "RUNNING_LICENSE",
          runningLicenseBalance,
        );
        state.balances.add(
          checkIn.account,
          "ACTIVATED_LICENSE",
          runningLicenseBalance,
        );
      }
    }

    state.checkIns.remove(checkIn.account);

    events.push({
      type: "expire_check_in",
      data: { account: checkIn.account },
    });
  }

  return [
    {
      action: {
        name: "expire_check_ins",
        players: ["$SYSTEM"],
        params: { count: expired.length },
        trxId: `sl_expire_check_ins_${blockNum}`,
        opIndex: 0,
        actionIndex: 0,
      },
      result: { success: true, events },
    },
  ];
}
