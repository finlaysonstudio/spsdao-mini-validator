/**
 * Autonomous (inflation) pools: validator/src/libs/pool.ts, validator/src/utilities/pool_manager.ts
 * and validator/src/entities/claims.ts (PoolClaimPayloads).
 *
 * The pools live in config `sps.inflation_pools`. The manager keeps a wrapper that is rebuilt from
 * that value every time the `sps` group changes (upstream `addTokenWatcher`), and writes the
 * serialized pools back with `updateConfig` (PoolSerializer.store).
 */
import yup from "yup";
import type { BlockRef, ProcessResult } from "../types.mjs";
import { EventLog } from "../types.mjs";
import { ErrorType, ValidationError } from "../util/errors.mjs";
import type { BalanceRepository } from "./balance.mjs";
import type { ConfigLoader } from "./config.mjs";
import type { IAction } from "./context.mjs";

const { object, string, number, date, array } = yup;

export type AutonomousPoolConfiguration = {
  name: string;
  token: string;
  beneficiary: string;
  tokensPerNormalizedDay: number;
  start: Date | string;
  lastPayout?: Date | string;
};

export class AutonomousPoolError extends ValidationError {}

export const autonomous_pool_schema = object({
  name: string().strict().required(),
  token: string().strict().required(),
  beneficiary: string().strict().required(),
  tokensPerNormalizedDay: number().min(0).lessThan(Infinity).required(),
  start: date().required(),
  lastPayout: date().optional(),
});

const array_schema = array().of(autonomous_pool_schema).required();

/** ActionIdentifier: the error's `action` is the action id. */
type Aid = { readonly id: string };

export class AutonomousPoolsWrapper {
  private constructor(
    private readonly pools: Map<string, AutonomousPoolConfiguration>,
  ) {}

  static create(pools: unknown): AutonomousPoolsWrapper | undefined {
    if (array_schema.isValidSync(pools)) {
      const list = pools as AutonomousPoolConfiguration[];
      const names = list.map((pool) => pool.name);
      if (names.length !== new Set(names).size) return undefined;
      const m = new Map<string, AutonomousPoolConfiguration>();
      for (const pool of list) m.set(pool.name, pool);
      return new AutonomousPoolsWrapper(m);
    }
    return undefined;
  }

  anyPools(): boolean {
    return this.pools.size > 0;
  }

  getPool(name: string): AutonomousPoolConfiguration | undefined {
    return this.pools.get(name);
  }

  serialize(): AutonomousPoolConfiguration[] {
    return [...this.pools.values()];
  }

  addPool(pool: AutonomousPoolConfiguration, aid: Aid): void {
    const { name } = pool;
    if (this.pools.has(name)) {
      throw new AutonomousPoolError(
        `Trying to add pool with name ${name} that already is registered`,
        aid.id,
        ErrorType.AutonomousPoolAlreadyRegistered,
      );
    } else if (!autonomous_pool_schema.isValidSync(pool)) {
      throw new AutonomousPoolError(
        `Trying to add pool with name ${name} that does not validate according to schema`,
        aid.id,
        ErrorType.AutonomousPoolInvalid,
      );
    }
    this.pools.set(pool.name, pool);
  }

  updatePool(pool: Partial<AutonomousPoolConfiguration>, aid: Aid): void {
    const { name } = pool;
    if (name === undefined) {
      throw new AutonomousPoolError(
        `Trying to update pool without name`,
        aid.id,
        ErrorType.AutonomousPoolWithoutName,
      );
    } else if (!this.pools.has(name)) {
      throw new AutonomousPoolError(
        `Trying to update pool with name ${pool.name} that has not been registered yet`,
        aid.id,
        ErrorType.AutonomousPoolNotRegistered,
      );
    }
    const existing = this.pools.get(name);
    const updated = { ...existing, ...pool };
    if (!autonomous_pool_schema.isValidSync(updated)) {
      throw new AutonomousPoolError(
        `Trying to update pool with name ${name} that does not validate according to schema.`,
        aid.id,
        ErrorType.AutonomousPoolInvalid,
      );
    }
    this.pools.set(updated.name!, updated as AutonomousPoolConfiguration);
  }

  poolCallback(callback: (pool: AutonomousPoolConfiguration) => void): void {
    for (const pool of this.pools.values()) callback(pool);
  }
}

type Payout = { beneficiary: string; token: string; amount: number };

export function determinePayout(
  pool: AutonomousPoolConfiguration,
  now: Date,
): Payout | undefined {
  const start = new Date(pool.start);
  if (start > now) return undefined;
  const previous = new Date(pool.lastPayout ?? pool.start);
  const mostRecent = start < previous ? previous : start;
  const diff = now.getTime() - mostRecent.getTime();
  if (diff <= 0) return undefined;
  const normalizedTime = 3600 * 24 * 1000;
  return {
    beneficiary: pool.beneficiary,
    token: pool.token,
    amount: (pool.tokensPerNormalizedDay * diff) / normalizedTime,
  };
}

export class PoolManager {
  private static readonly MINTING_ACCOUNT = "$MINTING_ACCOUNT";

  private wrapper?: AutonomousPoolsWrapper;

  constructor(
    private readonly config: ConfigLoader,
    private readonly balances: BalanceRepository,
  ) {
    this.wrapper = AutonomousPoolsWrapper.create(
      config.token?.inflation_pools ?? [],
    );
    config.onChange("sps", () => {
      this.wrapper = AutonomousPoolsWrapper.create(
        this.config.token?.inflation_pools ?? [],
      );
    });
  }

  anyPools(): boolean {
    return this.wrapper?.anyPools() ?? false;
  }

  add(pool: AutonomousPoolConfiguration, aid: Aid): EventLog {
    if (this.wrapper === undefined) {
      throw new AutonomousPoolError(
        `Trying to add an autonomous pool while pool wrapper is not configured correctly.`,
        aid.id,
        ErrorType.AutonomousPoolInvalid,
      );
    }
    this.wrapper.addPool(pool, aid);
    return this.config.store(this.wrapper.serialize());
  }

  update(pool: Partial<AutonomousPoolConfiguration>, aid: Aid): EventLog {
    if (this.wrapper === undefined) {
      throw new AutonomousPoolError(
        `Trying to update an autonomous pool while pool wrapper is not configured correctly.`,
        aid.id,
        ErrorType.AutonomousPoolInvalid,
      );
    }
    this.wrapper.updatePool(pool, aid);
    return this.config.store(this.wrapper.serialize());
  }

  payout(now: Date, aid: IAction): EventLog[] {
    const wrapper = this.wrapper;
    if (wrapper === undefined) {
      throw new AutonomousPoolError(
        `Trying to payout autonomous pools while pool wrapper is not configured correctly.`,
        aid.id,
        ErrorType.AutonomousPoolInvalid,
      );
    }
    const retval: EventLog[] = [];
    const paidPools: Partial<AutonomousPoolConfiguration>[] = [];
    wrapper.poolCallback((pool) => {
      const payout = determinePayout(pool, now);
      if (payout !== undefined) {
        paidPools.push({ name: pool.name, lastPayout: now });
        if (payout.amount > 0) {
          retval.push(
            ...this.balances.updateBalance(
              aid,
              PoolManager.MINTING_ACCOUNT,
              payout.beneficiary,
              payout.token,
              payout.amount,
              `INFLATION_POOL_MINT_${pool.name.toUpperCase()}`,
            ),
          );
        }
      }
    });
    for (const update of paidPools) wrapper.updatePool(update, aid);
    if (paidPools.length > 0)
      retval.push(this.config.store(wrapper.serialize()));
    return retval;
  }
}

/** PoolClaimPayloads: one `claim_pool` op per block while any autonomous pool is registered. */
export class PoolClaimPayloads {
  private static readonly pool_payload_account = "$MINTING";

  constructor(
    private readonly customJsonId: string,
    private readonly poolManager: PoolManager,
  ) {}

  process(block: BlockRef): ProcessResult[] {
    if (!this.poolManager.anyPools()) return [];
    return [
      [
        "custom_json",
        {
          required_auths: [PoolClaimPayloads.pool_payload_account],
          required_posting_auths: [],
          id: this.customJsonId,
          json: { action: "claim_pool", params: { now: block.block_time } },
        },
      ],
    ];
  }

  trx_id(block: BlockRef): string {
    return `claim_${block.block_num}@${block.block_time.getTime()}`;
  }
}
