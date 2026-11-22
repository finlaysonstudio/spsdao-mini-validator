/** Mirrors validator/src/entities/errors.ts */
export enum ErrorType {
  AdminOnly = 2,
  InvalidConfig = 3,
  TestError = 10,
  AmountNotPositive = 30,
  InsufficientBalance = 31,
  MisconfiguredValidator = 42,
  NoSystemAccount = 101,
  SelfTransfer = 112,
  AccountNotKnown = 113,
  NoMultiTokenTransfer = 114,
  MismatchedAccount = 115,
  DuplicateAccount = 116,
  DuplicateTransferKey = 117,
  InvalidTransferKey = 118,
  ActiveUnstaking = 132,
  NoStakingToken = 141,
  NoActiveUnstaking = 142,
  ActiveKeyRequired = 143,
  DelegationNotSupportedForToken = 144,
  CannotDelegateToSelf = 145,
  CannotUndelegateToSelf = 146,
  NoTokensDelegated = 147,
  UndelegationTooSoon = 148,
  UndelegationAmountTooHigh = 149,
  NoUndelegationPending = 150,
  NoActiveDelegation = 151,
  CannotUndelegateMoreThanPending = 152,
  DelegationAuthorityNotAllowed = 153,
  InvalidUnstakingQty = 154,
  UnknownValidator = 210,
  InactiveValidator = 211,
  DoubleValidatorVote = 212,
  MaxValidatorVotes = 213,
  NoSuchValidatorVote = 221,
  NoSuchBlock = 230,
  WrongBlockValidator = 231,
  OldBlock = 232,
  AlreadyValidatedBlock = 233,
  BlockHashMismatch = 234,
  BlockValidationPaused = 235,
  InvalidTransitionBlock = 236,
  TransitionStateInvalid = 237,
  NoSuchSale = 330,
  SaleNotStarted = 331,
  SaleOutOfStock = 332,
  MaxPerSale = 333,
  SaleDiscountMismatch = 334,
  SaleOfferMismatch = 335,
  UnsupportedToken = 336,
  AutonomousPoolAlreadyRegistered = 401,
  AutonomousPoolInvalid = 402,
  AutonomousPoolWithoutName = 403,
  AutonomousPoolNotRegistered = 404,
  TokenAlreadyRegistered = 501,
  AutonomousMintInvalid = 502,
  TokenReferenceNotFound = 503,
  NoAuthority = 600,
  InvalidRewardDelegationPercent = 700,
  InvalidRewardPoolType = 701,
  InvalidRewardPoolToken = 702,
  RewardPoolClaimCooldown = 703,
  RewardPoolIgnoredAccount = 704,
  InvalidPromiseType = 800,
  PromiseAlreadyExists = 801,
  InvalidPromise = 802,
  InvalidPromiseStatus = 803,
  NotPromiseController = 804,
  DelegationPromiseTokenMismatch = 805,
  InvalidPromiseParams = 806,
  TransitionRequired = 807,
  InvalidCheckIn = 900,
}

export type LogObj = { message: string; code: number; action: string };

/**
 * Upstream `ActionError` is NOT caught by Action.execute (it rethrows) and
 * would abort block processing. We model that as a fatal error.
 */
export class ActionError extends Error {
  readonly log_obj: LogObj;
  constructor(message: string, actionId: string, public readonly code: number) {
    super(message);
    this.name = this.constructor.name;
    this.log_obj = { message, code, action: actionId };
  }
}

/** Caught by Action.execute → success=false, error=code. */
export class ValidationError extends ActionError {
  constructor(message: string, actionId: string, code: ErrorType) {
    super(message, actionId, code);
  }
}

/** Thrown when we hit a code path we have not ported faithfully. */
export class UnsupportedPathError extends Error {}
