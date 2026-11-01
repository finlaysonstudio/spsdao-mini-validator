/**
 * Compact open-addressed hash set / map keyed by 64-bit hashes of strings.
 * Used for very large key sets (hive account names, promise ids, rental ids)
 * where storing the strings themselves would cost hundreds of MB.
 */

function fnv1a32(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // final avalanche (murmur3 fmix32)
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function hash64(s: string): [number, number] {
  const a = fnv1a32(s, 0x811c9dc5);
  const b = fnv1a32(s, 0x9747b28c);
  return [a, b];
}

export class Hash64Map {
  private lo: Uint32Array;
  private hi: Uint32Array;
  private vals: Int32Array;
  private used: Uint8Array;
  private _size = 0;
  private capacity: number;

  constructor(expected = 1024) {
    this.capacity = 1 << Math.ceil(Math.log2(Math.max(16, expected * 2)));
    this.lo = new Uint32Array(this.capacity);
    this.hi = new Uint32Array(this.capacity);
    this.vals = new Int32Array(this.capacity);
    this.used = new Uint8Array(this.capacity);
  }

  get size(): number {
    return this._size;
  }

  private slot(a: number, b: number): number {
    const mask = this.capacity - 1;
    let i = a & mask;
    while (this.used[i]) {
      if (this.lo[i] === a && this.hi[i] === b) return i;
      i = (i + 1) & mask;
    }
    return i;
  }

  private grow(): void {
    const oldLo = this.lo, oldHi = this.hi, oldVals = this.vals, oldUsed = this.used;
    this.capacity *= 2;
    this.lo = new Uint32Array(this.capacity);
    this.hi = new Uint32Array(this.capacity);
    this.vals = new Int32Array(this.capacity);
    this.used = new Uint8Array(this.capacity);
    this._size = 0;
    for (let i = 0; i < oldUsed.length; i++) {
      if (oldUsed[i]) this.setHash(oldLo[i], oldHi[i], oldVals[i]);
    }
  }

  private setHash(a: number, b: number, v: number): void {
    if ((this._size + 1) * 2 > this.capacity) this.grow();
    const i = this.slot(a, b);
    if (!this.used[i]) {
      this.used[i] = 1;
      this.lo[i] = a;
      this.hi[i] = b;
      this._size++;
    }
    this.vals[i] = v;
  }

  set(key: string, v: number): void {
    const [a, b] = hash64(key);
    this.setHash(a, b, v);
  }

  get(key: string): number | undefined {
    const [a, b] = hash64(key);
    const i = this.slot(a, b);
    return this.used[i] ? this.vals[i] : undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

export class Hash64Set {
  private map: Hash64Map;
  constructor(expected = 1024) {
    this.map = new Hash64Map(expected);
  }
  add(key: string): void {
    this.map.set(key, 1);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  get size(): number {
    return this.map.size;
  }
}
