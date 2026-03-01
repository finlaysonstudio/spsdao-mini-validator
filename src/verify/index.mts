export interface VerifyResult {
  blockNum: number;
  computed: string;
  expected: string;
  match: boolean;
}

export function verifyHash(
  blockNum: number,
  computedHash: string,
  knownHashes: Map<number, string>,
): VerifyResult | null {
  const expected = knownHashes.get(blockNum);
  if (!expected) return null;

  return {
    blockNum,
    computed: computedHash,
    expected,
    match: computedHash === expected,
  };
}

export function logVerifyResult(result: VerifyResult): void {
  if (result.match) {
    console.log(
      `  HASH OK: block ${result.blockNum} — ${result.computed.slice(0, 16)}...`,
    );
  } else {
    console.error(`  HASH MISMATCH: block ${result.blockNum}`);
    console.error(`    Computed: ${result.computed}`);
    console.error(`    Expected: ${result.expected}`);
  }
}
