import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";

export function handleApproveValidator(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { account_name } = action.params as { account_name?: string };

  if (!account_name) {
    return errorResult(1, "Missing account_name");
  }

  let validator = ctx.state.validators.get(account_name);
  if (!validator) {
    validator = {
      account_name,
      is_active: true,
      total_votes: 0,
      missed_blocks: 0,
      post_url: "",
    };
  }
  validator.is_active = true;
  ctx.state.validators.set(validator);

  return successResult([
    { type: "approve_validator", data: { account: account_name } },
  ]);
}

export function handleUnapproveValidator(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { account_name } = action.params as { account_name?: string };

  if (!account_name) {
    return errorResult(1, "Missing account_name");
  }

  const validator = ctx.state.validators.get(account_name);
  if (!validator) {
    return errorResult(2, "Validator not found");
  }

  validator.is_active = false;
  ctx.state.validators.set(validator);

  return successResult([
    { type: "unapprove_validator", data: { account: account_name } },
  ]);
}

export function handleUpdateValidator(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { account_name, post_url } = action.params as {
    account_name?: string;
    post_url?: string;
  };
  const player = action.players[0];
  const account = account_name ?? player;

  const validator = ctx.state.validators.get(account);
  if (!validator) {
    return errorResult(2, "Validator not found");
  }

  if (post_url !== undefined) {
    validator.post_url = post_url;
  }

  ctx.state.validators.set(validator);

  return successResult([{ type: "update_validator", data: { account } }]);
}
