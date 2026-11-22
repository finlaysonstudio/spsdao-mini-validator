import dhive from "@hiveio/dhive";
import { describe, expect, it } from "vitest";
import { encodePublicKey, expirationAfter, PrivateKey, refBlock, serializeTransaction, signTransaction, transactionDigest, transactionId, type Transaction } from "./signing.mjs";

// dhive is the reference implementation (upstream broadcasts through dhive-sl, a dhive fork).
const WIFS = [
  dhive.PrivateKey.fromSeed("mini-validator-test-1").toString(),
  dhive.PrivateKey.fromSeed("mini-validator-test-2").toString(),
  dhive.PrivateKey.fromLogin("nullfame", "not-a-real-password", "posting").toString(),
];

function tx(i: number): Transaction {
  const json = JSON.stringify({ action: i % 2 ? "check_in_validator" : "validate_block", params: { block_num: 111871137 + i, hash: `${i}`.repeat(64).slice(0, 64), version: "1.5.1-mini.0" } });
  return {
    ref_block_num: (111871137 + i) & 0xffff,
    ref_block_prefix: (0x9e3779b9 * (i + 1)) >>> 0,
    expiration: expirationAfter("2026-11-22T00:44:57", 60 + i),
    operations: [["custom_json", { required_auths: [], required_posting_auths: ["nullfame"], id: "sm_sps", json }]],
    extensions: [],
  };
}

describe("PrivateKey", () => {
  it.each(WIFS)("derives the same public key as dhive", (wif) => {
    expect(PrivateKey.fromWif(wif).publicKey).toBe(dhive.PrivateKey.fromString(wif).createPublic().toString());
  });

  it("rejects a corrupted WIF", () => {
    const wif = WIFS[0];
    const bad = wif.slice(0, -1) + (wif.endsWith("a") ? "b" : "a");
    expect(() => PrivateKey.fromWif(bad)).toThrow(/checksum|WIF/);
  });

  it("never serializes the secret", () => {
    const key = PrivateKey.fromWif(WIFS[0]);
    expect(JSON.stringify({ key })).toBe(JSON.stringify({ key: key.publicKey }));
    expect(String(key)).toBe(key.publicKey);
    expect(JSON.stringify(key)).not.toContain(WIFS[0]);
  });

  it("encodes public keys like dhive", () => {
    const pub = dhive.PrivateKey.fromString(WIFS[1]).createPublic();
    expect(encodePublicKey(Uint8Array.from(pub.key))).toBe(pub.toString());
  });
});

describe("transactions", () => {
  // dhive's trx id is sha256 of its own serialization, so equal ids mean equal bytes
  it.each([0, 1, 2, 3, 4, 5])("serializes like dhive (%i)", (i) => {
    const ours = Buffer.from(serializeTransaction(tx(i)));
    expect(ours.subarray(0, 2).readUInt16LE()).toBe(tx(i).ref_block_num);
    expect(transactionId(tx(i))).toBe(dhive.cryptoUtils.generateTrxId(tx(i)));
  });

  it.each([0, 1, 2, 3])("computes the dhive transaction id (%i)", (i) => {
    expect(transactionId(tx(i))).toBe(dhive.cryptoUtils.generateTrxId(tx(i)));
  });

  it.each([0, 1, 2, 3])("computes the dhive digest (%i)", (i) => {
    expect(Buffer.from(transactionDigest(tx(i))).toString("hex")).toBe(dhive.cryptoUtils.transactionDigest(tx(i)).toString("hex"));
  });

  it("produces signatures byte-identical to dhive", () => {
    for (const wif of WIFS)
      for (let i = 0; i < 40; i++) {
        const ours = signTransaction(tx(i), PrivateKey.fromWif(wif));
        const theirs = dhive.cryptoUtils.signTransaction(tx(i), [dhive.PrivateKey.fromString(wif)]);
        expect(ours.signatures).toEqual(theirs.signatures);
      }
  });

  it("produces signatures that recover the signer", () => {
    const key = PrivateKey.fromWif(WIFS[2]);
    const signed = signTransaction(tx(7), key);
    const sig = dhive.Signature.fromString(signed.signatures[0]);
    expect(sig.recover(transactionDigest(tx(7))).toString()).toBe(key.publicKey);
  });
});

describe("refBlock / expirationAfter", () => {
  it("reads the prefix little-endian from bytes 4..8 of the block id", () => {
    const id = "06aaf0a1" + "78563412" + "00".repeat(12);
    expect(refBlock(0x06aaf0a1, id)).toEqual({ ref_block_num: 0xf0a1, ref_block_prefix: 0x12345678 });
  });

  it("adds seconds in UTC without a zone suffix", () => {
    expect(expirationAfter("2026-11-22T23:59:30", 60)).toBe("2026-11-23T00:00:30");
  });
});
