import type { ValidationError } from "./errors.mjs";

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: ValidationError };

export function Ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
export const OkVoid = (): Result<void> => ({ ok: true, value: undefined });
export function Err<T = void>(error: ValidationError): Result<T> {
  return { ok: false, error };
}
