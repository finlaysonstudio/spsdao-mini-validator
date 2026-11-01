/** Mirrors validator/src/utilities/accounts.ts and dhive-sl validateAccountName. */
export function isSystemAccount(value: string): boolean {
  return /^\$[A-Z_]*$/.test(value);
}

export function validateAccountName(value: string): boolean {
  if (!value) return false;
  const len = value.length;
  if (len < 3) return false;
  if (len > 16) return false;
  const segments = value.split(".");
  for (const segment of segments) {
    if (!/^[a-z]/.test(segment)) return false;
    if (!/^[a-z0-9-]*$/.test(segment)) return false;
    if (/--/.test(segment)) return false;
    if (!/[a-z0-9]$/.test(segment)) return false;
    if (segment.length < 3) return false;
  }
  return true;
}

export function isHiveAccount(value: string): boolean {
  return validateAccountName(value);
}

export function isLiteAccount(value: string): boolean {
  return value.includes("_") && isHiveAccount(value.replace("_", ""));
}
