import type { StateStore } from "../state/index.mjs";
import { EventLog } from "../types.mjs";
import { isSystemAccount } from "../util/accounts.mjs";

export class HiveAccountRepository {
  constructor(private readonly state: StateStore) {}

  upsert(name: string): void {
    this.state.hiveAccounts.add(name);
  }

  /** updateItemWithReturning({ authority }) — throws if the account row is missing. */
  setAuthority(account: string, authority: Record<string, string[]>): EventLog {
    if (!this.state.hiveAccounts.has(account)) {
      throw new Error(`set_authority on unknown hive account ${account}`);
    }
    this.state.hiveAccounts.setAuthority(account, authority);
    return new EventLog("update", "hive_accounts", { name: account, authority });
  }

  checkAuthority(actor: string, auth: string, account: string): boolean {
    if (actor === account) return true;
    const authority = this.state.hiveAccounts.getAuthority(account);
    if (authority === undefined) return false;
    const accounts = authority[auth];
    return !!(accounts && accounts.includes(actor));
  }

  onlyHiveAccounts(names: string[]): boolean {
    const set = new Set(names);
    let count = 0;
    for (const n of set) if (this.state.hiveAccounts.has(n)) count++;
    return count === set.size;
  }

  onlySystemAccounts(names: string[]): boolean {
    const set = new Set(names);
    const count = [...set].filter(isSystemAccount).length;
    return count === set.size;
  }

  onlyHiveOrSystemAccounts(names: string[]): boolean {
    const sys: string[] = [];
    const hive: string[] = [];
    for (const x of names) (x.startsWith("$") ? sys : hive).push(x);
    return this.onlySystemAccounts(sys) && this.onlyHiveAccounts(hive);
  }
}
