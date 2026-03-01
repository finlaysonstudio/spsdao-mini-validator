import type {
  OperationHandler,
  ParsedAction,
  ActionContext,
} from "./types.mjs";
import type { OperationResult } from "../types.mjs";

// Handler imports
import {
  handleTokenTransfer,
  handleTokenTransferMulti,
} from "./handlers/tokenTransfer.mjs";
import { handleTokenAward } from "./handlers/tokenAward.mjs";
import { handleBurn } from "./handlers/burn.mjs";
import {
  handleStakeTokens,
  handleStakeTokensMulti,
} from "./handlers/stakeTokens.mjs";
import {
  handleUnstakeTokens,
  handleCancelUnstakeTokens,
} from "./handlers/unstakeTokens.mjs";
import {
  handleDelegateTokens,
  handleUndelegateTokens,
  handleUndelegateTokensMulti,
  handleReturnTokens,
} from "./handlers/delegateTokens.mjs";
import { handleClaimStakingRewards } from "./handlers/claimStakingRewards.mjs";
import { handleShopPurchase } from "./handlers/shopPurchase.mjs";
import {
  handleApproveValidator,
  handleUnapproveValidator,
  handleUpdateValidator,
} from "./handlers/validators.mjs";
import { handleCheckInValidator } from "./handlers/checkIn.mjs";
import {
  handleActivateLicense,
  handleDeactivateLicense,
} from "./handlers/licenses.mjs";
import { handleValidateBlock } from "./handlers/validateBlock.mjs";
import { handlePriceFeed } from "./handlers/priceFeed.mjs";
import {
  handleAddPool,
  handleUpdatePool,
  handleDisablePool,
} from "./handlers/pools.mjs";
import {
  handleCreatePromise,
  handleFulfillPromise,
  handleFulfillPromiseMulti,
  handleCompletePromise,
  handleCancelPromise,
  handleReversePromise,
} from "./handlers/promises.mjs";
import {
  handleSetAuthority,
  handleConfigUpdate,
} from "./handlers/authority.mjs";

const handlers = new Map<string, OperationHandler>();

handlers.set("token_transfer", handleTokenTransfer);
handlers.set("token_transfer_multi", handleTokenTransferMulti);
handlers.set("token_award", handleTokenAward);
handlers.set("burn", handleBurn);
handlers.set("stake_tokens", handleStakeTokens);
handlers.set("stake_tokens_multi", handleStakeTokensMulti);
handlers.set("unstake_tokens", handleUnstakeTokens);
handlers.set("cancel_unstake_tokens", handleCancelUnstakeTokens);
handlers.set("delegate_tokens", handleDelegateTokens);
handlers.set("undelegate_tokens", handleUndelegateTokens);
handlers.set("undelegate_tokens_multi", handleUndelegateTokensMulti);
handlers.set("return_tokens", handleReturnTokens);
handlers.set("claim_staking_rewards", handleClaimStakingRewards);
handlers.set("shop_purchase", handleShopPurchase);
handlers.set("approve_validator", handleApproveValidator);
handlers.set("unapprove_validator", handleUnapproveValidator);
handlers.set("update_validator", handleUpdateValidator);
handlers.set("check_in_validator", handleCheckInValidator);
handlers.set("activate_license", handleActivateLicense);
handlers.set("deactivate_license", handleDeactivateLicense);
handlers.set("validate_block", handleValidateBlock);
handlers.set("price_feed", handlePriceFeed);
handlers.set("add_pool", handleAddPool);
handlers.set("update_pool", handleUpdatePool);
handlers.set("disable_pool", handleDisablePool);
handlers.set("create_promise", handleCreatePromise);
handlers.set("fulfill_promise", handleFulfillPromise);
handlers.set("fulfill_promise_multi", handleFulfillPromiseMulti);
handlers.set("complete_promise", handleCompletePromise);
handlers.set("cancel_promise", handleCancelPromise);
handlers.set("reverse_promise", handleReversePromise);
handlers.set("set_authority", handleSetAuthority);
handlers.set("config_update", handleConfigUpdate);

export function processAction(
  action: ParsedAction,
  ctx: ActionContext,
): OperationResult {
  const handler = handlers.get(action.name);

  if (!handler) {
    // Unknown action — still produces a transaction entity with success=false
    return {
      success: false,
      error: { code: 1, message: `Unknown action: ${action.name}` },
      events: [],
    };
  }

  return handler(action, ctx);
}
