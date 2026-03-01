import { config } from "../config.mjs";
import type { HiveTransaction } from "../hive/types.mjs";
import type { ParsedAction } from "./types.mjs";

/** Actions that require posting auth (vs active auth) */
const POSTING_AUTH_ACTIONS = new Set([
  "token_award",
  "stake_tokens",
  "stake_tokens_multi",
  "unstake_tokens",
  "claim_staking_rewards",
  "cancel_unstake_tokens",
  "delegate_tokens",
  "undelegate_tokens",
  "undelegate_tokens_multi",
  "return_tokens",
  "fulfill_promise",
  "fulfill_promise_multi",
  "activate_license",
  "deactivate_license",
  "validate_block",
  "check_in_validator",
  "price_feed",
]);

interface CustomJsonOp {
  id: string;
  json: string;
  required_auths: string[];
  required_posting_auths: string[];
}

export function parseBlockActions(
  transactions: HiveTransaction[],
  transactionIds: string[],
): ParsedAction[] {
  const actions: ParsedAction[] = [];

  for (let txIdx = 0; txIdx < transactions.length; txIdx++) {
    const tx = transactions[txIdx];
    const txId = transactionIds[txIdx];

    for (let opIdx = 0; opIdx < tx.operations.length; opIdx++) {
      const [opType, opBody] = tx.operations[opIdx];

      if (opType === "custom_json") {
        const customJson = opBody as unknown as CustomJsonOp;
        const parsed = parseCustomJson(customJson, txId, opIdx);
        actions.push(...parsed);
      }
    }
  }

  return actions;
}

function parseCustomJson(
  op: CustomJsonOp,
  txId: string,
  opIndex: number,
): ParsedAction[] {
  const { id, json: rawJson, required_auths, required_posting_auths } = op;

  // Check if this is an SPS operation
  const isPrefixFormat = id.startsWith(config.customJsonPrefix);
  const isIdFormat = id === config.customJsonId;

  if (!isPrefixFormat && !isIdFormat) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }

  if (isPrefixFormat) {
    // Prefix format: action name = id minus prefix
    const actionName = id.slice(config.customJsonPrefix.length);
    const players = getPlayers(
      actionName,
      required_auths,
      required_posting_auths,
    );
    if (players.length === 0) return [];

    const trxOpId = opIndex > 0 ? `${txId}-${opIndex}` : txId;

    return [
      {
        name: actionName,
        players,
        params: (parsed as Record<string, unknown>) ?? {},
        trxId: trxOpId,
        opIndex,
        actionIndex: 0,
      },
    ];
  }

  // ID format: { action, params } or array of them
  const items = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
  const actions: ParsedAction[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as {
      action?: string;
      params?: Record<string, unknown>;
    };
    if (!item?.action) continue;

    const players = getPlayers(
      item.action,
      required_auths,
      required_posting_auths,
    );
    if (players.length === 0) continue;

    const trxOpId = opIndex > 0 ? `${txId}-${opIndex}` : txId;
    const uniqueTrxId = i > 0 ? `${trxOpId}.${i}` : trxOpId;

    actions.push({
      name: item.action,
      players,
      params: item.params ?? {},
      trxId: uniqueTrxId,
      opIndex,
      actionIndex: i,
    });
  }

  return actions;
}

function getPlayers(
  actionName: string,
  requiredAuths: string[],
  requiredPostingAuths: string[],
): string[] {
  if (POSTING_AUTH_ACTIONS.has(actionName)) {
    return requiredPostingAuths.length > 0 ? requiredPostingAuths : [];
  }
  return requiredAuths.length > 0 ? requiredAuths : [];
}
