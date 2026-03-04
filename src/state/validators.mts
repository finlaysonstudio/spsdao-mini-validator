import seedrandom from "seedrandom";

export interface Validator {
  account_name: string;
  is_active: boolean;
  post_url: string | null;
  api_url: string | null;
  total_votes: number;
  missed_blocks: number;
  reward_account: string | null;
  last_version: string | null;
  block_num?: number;
}

export class ValidatorStore {
  private validators = new Map<string, Validator>();

  get(account: string): Validator | undefined {
    return this.validators.get(account);
  }

  set(validator: Validator): void {
    this.validators.set(validator.account_name, validator);
  }

  getActive(): Validator[] {
    return Array.from(this.validators.values())
      .filter((v) => v.is_active && v.total_votes > 0)
      .sort((a, b) => {
        if (b.total_votes !== a.total_votes)
          return b.total_votes - a.total_votes;
        return a.account_name.localeCompare(b.account_name);
      });
  }

  /** Select validator for a block using weighted PRNG */
  selectValidator(
    blockId: string,
    prevBlockId: string,
    minValidators: number,
  ): Validator | null {
    const active = this.getActive();
    if (active.length < minValidators) return null;

    const totalVotes = active.reduce((sum, v) => sum + v.total_votes, 0);
    const prng = seedrandom(blockId + prevBlockId);
    const index = prng() * totalVotes;

    let runningTotal = 0;
    for (const validator of active) {
      runningTotal += validator.total_votes;
      if (index < runningTotal) return validator;
    }

    return active[active.length - 1];
  }

  getAll(): Validator[] {
    return Array.from(this.validators.values());
  }

  load(entries: Partial<Validator>[]): void {
    for (const e of entries) {
      if (!e.account_name) continue;
      this.set({
        account_name: e.account_name,
        is_active: e.is_active ?? false,
        post_url: e.post_url ?? null,
        api_url: e.api_url ?? null,
        total_votes: e.total_votes ?? 0,
        missed_blocks: e.missed_blocks ?? 0,
        reward_account: e.reward_account ?? null,
        last_version: e.last_version ?? null,
        block_num: e.block_num,
      });
    }
  }
}
