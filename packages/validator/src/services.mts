import type { StateStore } from "./state/index.mjs";
import { BalanceRepository } from "./repos/balance.mjs";
import { BlockRepository } from "./repos/blocks.mjs";
import { ConfigLoader } from "./repos/config.mjs";
import { ActiveDelegationsRepository, DelegationManager, RentalDelegationExpirationSource, RentalDelegationRepository } from "./repos/delegations.mjs";
import { HiveAccountRepository } from "./repos/hive_accounts.mjs";
import { CheckInRepository, LicenseManager } from "./repos/license_manager.mjs";
import { PriceFeedProducer, PriceHistoryRepository } from "./repos/price_feed.mjs";
import { DelegationOfferPromiseHandler, DelegationPromiseHandler, PromiseManager, PromiseRepository } from "./repos/promises.mjs";
import { StakingRewardsRepository } from "./repos/staking_rewards.mjs";
import { TRANSITION_POINTS, TransitionManager } from "./repos/transitions.mjs";
import { TokenUnstakingRepository } from "./repos/unstaking.mjs";
import { ValidatorRepository, ValidatorVoteRepository } from "./repos/validators.mjs";

export type PrefixOpts = { custom_json_id: string; custom_json_prefix: string };

/** Wires every repository the way the upstream DI container does. */
export class Services {
  readonly config: ConfigLoader;
  readonly balances: BalanceRepository;
  readonly blocks: BlockRepository;
  readonly hiveAccounts: HiveAccountRepository;
  readonly transitions: TransitionManager;
  readonly validators: ValidatorRepository;
  readonly votes: ValidatorVoteRepository;
  readonly stakingRewards: StakingRewardsRepository;
  readonly unstaking: TokenUnstakingRepository;
  readonly checkIns: CheckInRepository;
  readonly licenseManager: LicenseManager;
  readonly priceHistory: PriceHistoryRepository;
  readonly priceFeed: PriceFeedProducer;
  readonly delegations: ActiveDelegationsRepository;
  readonly rentals: RentalDelegationRepository;
  readonly rentalExpiration: RentalDelegationExpirationSource;
  readonly delegationManager: DelegationManager;
  readonly promises: PromiseRepository;
  readonly promiseManager: PromiseManager;

  constructor(readonly state: StateStore, readonly prefix: PrefixOpts) {
    this.config = new ConfigLoader(state);
    this.balances = new BalanceRepository(state);
    this.blocks = new BlockRepository(state);
    this.hiveAccounts = new HiveAccountRepository(state);
    this.transitions = new TransitionManager(prefix.custom_json_id);
    this.validators = new ValidatorRepository(state, this.config);
    this.votes = new ValidatorVoteRepository(state, this.balances);
    this.stakingRewards = new StakingRewardsRepository(state, this.config, this.balances, this.blocks);
    this.unstaking = new TokenUnstakingRepository(state, this.config, prefix.custom_json_id);
    this.checkIns = new CheckInRepository(state);
    this.licenseManager = new LicenseManager(prefix.custom_json_id, this.checkIns, this.stakingRewards, this.balances, this.config, this.blocks);
    this.priceHistory = new PriceHistoryRepository(state);
    this.priceFeed = new PriceFeedProducer(this.priceHistory, this.validators, this.config);
    this.delegations = new ActiveDelegationsRepository(state, this.balances, this.unstaking);
    this.rentals = new RentalDelegationRepository(state);
    this.rentalExpiration = new RentalDelegationExpirationSource(prefix.custom_json_id, this.rentals, TRANSITION_POINTS.delegation_offer_block);
    this.delegationManager = new DelegationManager(this.hiveAccounts, this.delegations, this.rentals, this.transitions);
    this.promises = new PromiseRepository(state);
    this.promiseManager = new PromiseManager(
      prefix.custom_json_id,
      this.config,
      this.promises,
      new DelegationPromiseHandler(this.delegationManager),
      new DelegationOfferPromiseHandler(this.delegationManager, this.rentals, this.promises, this.config),
    );
  }
}
