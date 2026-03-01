export interface Delegation {
  delegator: string;
  delegatee: string;
  token: string;
  amount: number;
  last_delegation_tx?: string;
  last_undelegation_date?: Date;
}

function delegationKey(
  delegator: string,
  delegatee: string,
  token: string,
): string {
  return `${delegator}:${delegatee}:${token}`;
}

export class DelegationStore {
  private delegations = new Map<string, Delegation>();

  get(delegator: string, delegatee: string, token: string): Delegation | null {
    return (
      this.delegations.get(delegationKey(delegator, delegatee, token)) ?? null
    );
  }

  set(delegation: Delegation): void {
    const key = delegationKey(
      delegation.delegator,
      delegation.delegatee,
      delegation.token,
    );
    this.delegations.set(key, delegation);
  }

  remove(delegator: string, delegatee: string, token: string): void {
    this.delegations.delete(delegationKey(delegator, delegatee, token));
  }

  getByDelegator(delegator: string): Delegation[] {
    return Array.from(this.delegations.values()).filter(
      (d) => d.delegator === delegator,
    );
  }

  getByDelegatee(delegatee: string): Delegation[] {
    return Array.from(this.delegations.values()).filter(
      (d) => d.delegatee === delegatee,
    );
  }

  getAll(): Delegation[] {
    return Array.from(this.delegations.values());
  }

  load(
    entries: {
      delegator?: string;
      delegatee?: string;
      token?: string;
      amount?: number;
      last_delegation_tx?: string;
      last_undelegation_date?: string | Date;
    }[],
  ): void {
    for (const e of entries) {
      if (!e.delegator || !e.delegatee || !e.token) continue;
      this.set({
        delegator: e.delegator,
        delegatee: e.delegatee,
        token: e.token,
        amount: e.amount ?? 0,
        last_delegation_tx: e.last_delegation_tx,
        last_undelegation_date: e.last_undelegation_date
          ? new Date(e.last_undelegation_date)
          : undefined,
      });
    }
  }
}
