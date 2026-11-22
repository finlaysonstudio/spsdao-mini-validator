/**
 * JSON-lines logger. One object per line on stdout/stderr so the container
 * logs can be shipped as structured events (Datadog reads `status` as the
 * log level: info / warning / error / ok).
 */
import type { Writable } from "node:stream";

export type LogFields = Record<string, unknown>;

function emit(stream: Writable, status: string, msg: string, fields: LogFields): void {
  stream.write(JSON.stringify({ ts: new Date().toISOString(), status, msg, ...fields }) + "\n");
}

export function log(msg: string, fields: LogFields = {}): void {
  emit(process.stdout, "info", msg, fields);
}

export function warn(msg: string, fields: LogFields = {}): void {
  emit(process.stderr, "warning", msg, fields);
}

export function error(msg: string, fields: LogFields = {}): void {
  emit(process.stderr, "error", msg, fields);
}

/** Emit a line with an explicit status (e.g. "ok" / "error" for health checks). */
export function logStatus(status: string, msg: string, fields: LogFields = {}): void {
  emit(status === "error" || status === "warning" ? process.stderr : process.stdout, status, msg, fields);
}
