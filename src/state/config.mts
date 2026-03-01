function configKey(group: string, name: string): string {
  return `${group}.${name}`;
}

export class ConfigStore {
  private entries = new Map<string, string>();

  get(group: string, name: string): string | undefined {
    return this.entries.get(configKey(group, name));
  }

  getNumber(group: string, name: string, fallback: number): number {
    const v = this.get(group, name);
    if (v === undefined) return fallback;
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  set(group: string, name: string, value: string): void {
    this.entries.set(configKey(group, name), value);
  }

  getAll(): { group_name: string; name: string; value: string }[] {
    return Array.from(this.entries.entries()).map(([key, value]) => {
      const dotIndex = key.indexOf(".");
      return {
        group_name: key.slice(0, dotIndex),
        name: key.slice(dotIndex + 1),
        value,
      };
    });
  }

  load(entries: { group_name: string; name: string; value: string }[]): void {
    for (const e of entries) {
      this.set(e.group_name, e.name, e.value);
    }
  }
}
