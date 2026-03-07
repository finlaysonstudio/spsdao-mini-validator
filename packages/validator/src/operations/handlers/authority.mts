import type { OperationResult } from "../../types.mjs";
import type { ParsedAction, ActionContext } from "../types.mjs";
import { successResult, errorResult } from "../types.mjs";

export function handleSetAuthority(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { account_name, authorities } = action.params as {
    account_name?: string;
    authorities?: Record<string, string>;
  };

  if (!account_name) {
    return errorResult(1, "Missing account_name");
  }

  if (authorities) {
    for (const [key, value] of Object.entries(authorities)) {
      ctx.state.config.set("authority", `${account_name}.${key}`, value);
    }
  }

  return successResult([
    { object_type: "config", event_type: "update", data: { account_name } },
  ]);
}

export function handleConfigUpdate(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const { group_name, name, value } = action.params as {
    group_name?: string;
    name?: string;
    value?: string;
  };

  if (!group_name || !name || value === undefined) {
    return errorResult(1, "Missing config params");
  }

  ctx.state.config.set(group_name, name, String(value));

  return successResult([
    {
      object_type: "config",
      event_type: "update",
      data: { group_name, name, value },
    },
  ]);
}
