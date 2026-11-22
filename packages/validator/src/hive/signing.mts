/**
 * Hive transaction signing for the validator's custom_json duties.
 *
 * Only what the validator broadcasts is implemented: a transaction holding custom_json
 * operations, serialized as Hive's fc::raw does, signed with secp256k1 the way dhive
 * (and upstream's dhive-sl) signs: RFC6979 with sha256(digest || attempt) as extra entropy,
 * repeated until the signature is canonical. Signatures are therefore byte-identical to
 * dhive's for the same key and transaction (see signing.spec.mts).
 */
import { hmac } from "@noble/hashes/hmac.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as secp from "@noble/secp256k1";
import { base58 } from "@scure/base";

secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key: Uint8Array, msg: Uint8Array) => hmac(sha256, key, msg);

export const HIVE_CHAIN_ID = "beeab0de00000000000000000000000000000000000000000000000000000000";
export const KEY_PREFIX = "STM";
const CUSTOM_JSON_OP_ID = 18;

export type CustomJsonOperation = {
  required_auths: string[];
  required_posting_auths: string[];
  id: string;
  json: string;
};

export type Transaction = {
  ref_block_num: number;
  ref_block_prefix: number;
  /** UTC, `YYYY-MM-DDTHH:MM:SS` (Hive time_point_sec, no zone suffix) */
  expiration: string;
  operations: ["custom_json", CustomJsonOperation][];
  extensions: [];
};

export type SignedTransaction = Transaction & { signatures: string[] };

/** The secret half of a posting key; never logged or serialized. */
export class PrivateKey {
  readonly #secret: Uint8Array;
  readonly publicKey: string;

  private constructor(secret: Uint8Array) {
    this.#secret = secret;
    this.publicKey = encodePublicKey(secp.getPublicKey(secret, true));
  }

  /** Decode a WIF (`5...`): base58(0x80 || key || first 4 bytes of sha256d). */
  static fromWif(wif: string): PrivateKey {
    let raw: Uint8Array;
    try {
      raw = base58.decode(wif.trim());
    } catch {
      throw new Error("validator key is not valid base58 WIF");
    }
    if (raw.length !== 37 || raw[0] !== 0x80) throw new Error("validator key is not a WIF private key");
    const payload = raw.subarray(0, 33);
    const checksum = sha256(sha256(payload)).subarray(0, 4);
    if (!checksum.every((b, i) => b === raw[33 + i])) throw new Error("validator key WIF checksum is invalid");
    return new PrivateKey(Uint8Array.from(raw.subarray(1, 33)));
  }

  /** dhive PrivateKey.sign: 65-byte compact signature, recovery byte (27 + 4 + recid) first. */
  sign(digest: Uint8Array): Uint8Array {
    for (let attempt = 1; attempt < 256; attempt++) {
      const extraEntropy = sha256(concat(digest, Uint8Array.of(attempt)));
      const sig = secp.sign(digest, this.#secret, { prehash: false, format: "recovered", extraEntropy });
      // noble "recovered" is recid || r || s
      const rs = sig.subarray(1);
      if (!isCanonical(rs)) continue;
      const out = new Uint8Array(65);
      out[0] = 31 + sig[0];
      out.set(rs, 1);
      return out;
    }
    throw new Error("could not produce a canonical signature");
  }

  toJSON(): string {
    return this.publicKey;
  }

  toString(): string {
    return this.publicKey;
  }
}

/** dhive isCanonicalSignature on the 64-byte r || s. */
function isCanonical(rs: Uint8Array): boolean {
  return !(rs[0] & 0x80) && !(rs[0] === 0 && !(rs[1] & 0x80)) && !(rs[32] & 0x80) && !(rs[32] === 0 && !(rs[33] & 0x80));
}

/** `STM` + base58(compressed key || first 4 bytes of ripemd160(key)). */
export function encodePublicKey(compressed: Uint8Array): string {
  return KEY_PREFIX + base58.encode(concat(compressed, ripemd160(compressed).subarray(0, 4)));
}

// ---------------------------------------------------------------------------
// fc::raw serialization
// ---------------------------------------------------------------------------
class Writer {
  private readonly parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v);
    this.u8(v >>> 8);
  }
  u32(v: number) {
    for (let i = 0; i < 4; i++) this.u8(v >>> (8 * i));
  }
  varint(v: number) {
    let n = v >>> 0;
    while (n >= 0x80) {
      this.u8((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.u8(n);
  }
  bytes(b: Uint8Array) {
    for (const x of b) this.u8(x);
  }
  string(s: string) {
    const b = new TextEncoder().encode(s);
    this.varint(b.length);
    this.bytes(b);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

export function serializeTransaction(tx: Transaction): Uint8Array {
  const w = new Writer();
  w.u16(tx.ref_block_num);
  w.u32(tx.ref_block_prefix);
  w.u32(Math.floor(Date.parse(tx.expiration + "Z") / 1000));
  w.varint(tx.operations.length);
  for (const [name, op] of tx.operations) {
    if (name !== "custom_json") throw new Error(`cannot serialize operation ${name}`);
    w.varint(CUSTOM_JSON_OP_ID);
    w.varint(op.required_auths.length);
    for (const a of op.required_auths) w.string(a);
    w.varint(op.required_posting_auths.length);
    for (const a of op.required_posting_auths) w.string(a);
    w.string(op.id);
    w.string(op.json);
  }
  w.varint(0); // extensions
  return w.done();
}

/** Hive transaction id: first 20 bytes of sha256(serialized transaction), hex. */
export function transactionId(tx: Transaction): string {
  return toHex(sha256(serializeTransaction(tx)).subarray(0, 20));
}

export function transactionDigest(tx: Transaction, chainId = HIVE_CHAIN_ID): Uint8Array {
  return sha256(concat(fromHex(chainId), serializeTransaction(tx)));
}

export function signTransaction(tx: Transaction, key: PrivateKey, chainId = HIVE_CHAIN_ID): SignedTransaction {
  return { ...tx, signatures: [toHex(key.sign(transactionDigest(tx, chainId)))] };
}

/** Reference block fields from the head block id, as dhive does. */
export function refBlock(headBlockNumber: number, headBlockId: string): { ref_block_num: number; ref_block_prefix: number } {
  const id = fromHex(headBlockId);
  return { ref_block_num: headBlockNumber & 0xffff, ref_block_prefix: (id[4] | (id[5] << 8) | (id[6] << 16) | (id[7] << 24)) >>> 0 };
}

/** `time` (UTC, no zone) plus `seconds`, in time_point_sec form. */
export function expirationAfter(time: string, seconds: number): string {
  return new Date(Date.parse(time.endsWith("Z") ? time : time + "Z") + seconds * 1000).toISOString().slice(0, 19);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function fromHex(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "hex"));
}
