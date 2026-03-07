/** 3-decimal precision rounding */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function balanceKey(player: string, token: string): string {
  return `${player}:${token}`;
}

/** In-memory balance store: Map<"player:token", number> */
export class BalanceStore {
  private balances = new Map<string, number>();

  get(player: string, token: string): number {
    return this.balances.get(balanceKey(player, token)) ?? 0;
  }

  set(player: string, token: string, amount: number): void {
    this.balances.set(balanceKey(player, token), round3(amount));
  }

  add(player: string, token: string, amount: number): void {
    this.set(player, token, this.get(player, token) + amount);
  }

  subtract(player: string, token: string, amount: number): boolean {
    const current = this.get(player, token);
    if (round3(current - amount) < 0) return false;
    this.set(player, token, current - amount);
    return true;
  }

  /** Get all balances for a player */
  getAll(player: string): Map<string, number> {
    const result = new Map<string, number>();
    for (const [key, value] of this.balances) {
      if (key.startsWith(`${player}:`)) {
        const token = key.slice(player.length + 1);
        result.set(token, value);
      }
    }
    return result;
  }

  /** Get all holders of a specific token */
  getHolders(token: string): Map<string, number> {
    const result = new Map<string, number>();
    const suffix = `:${token}`;
    for (const [key, value] of this.balances) {
      if (key.endsWith(suffix) && value > 0) {
        const player = key.slice(0, key.length - suffix.length);
        result.set(player, value);
      }
    }
    return result;
  }

  /** Total supply of a token across all players */
  totalSupply(token: string): number {
    let total = 0;
    const suffix = `:${token}`;
    for (const [key, value] of this.balances) {
      if (key.endsWith(suffix)) {
        total += value;
      }
    }
    return round3(total);
  }

  load(entries: { player: string; token: string; balance: number }[]): void {
    for (const e of entries) {
      this.set(e.player, e.token, e.balance);
    }
  }
}
