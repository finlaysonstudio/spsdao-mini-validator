export class HiveAccountStore {
  private accounts = new Set<string>();

  has(account: string): boolean {
    return this.accounts.has(account);
  }

  add(account: string): void {
    this.accounts.add(account);
  }

  getAll(): string[] {
    return Array.from(this.accounts);
  }

  load(accounts: string[]): void {
    for (const a of accounts) {
      this.accounts.add(a);
    }
  }
}
