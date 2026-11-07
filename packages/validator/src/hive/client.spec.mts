import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../config.mjs";
import { getBlock } from "./client.mjs";

const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
const tooMany = () => new Response("rate limited", { status: 429 });

describe("rpcCall retry", () => {
  const saved = { nodes: config.rpcNodes, deadline: config.rpcRetryDeadlineMs };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.assign(config, { rpcNodes: saved.nodes, rpcRetryDeadlineMs: saved.deadline });
  });

  it("backs off and keeps retrying when every node answers 429", async () => {
    vi.useFakeTimers();
    Object.assign(config, { rpcNodes: ["https://a", "https://b"], rpcRetryDeadlineMs: 600_000 });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++calls <= 6 ? tooMany() : ok({ block: { block_id: "x" } }))));
    const p = getBlock(1);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ block_id: "x" });
    expect(calls).toBe(7); // three full passes failed, the fourth succeeded
  });

  it("gives up after the retry deadline", async () => {
    vi.useFakeTimers();
    Object.assign(config, { rpcNodes: ["https://a"], rpcRetryDeadlineMs: 5_000 });
    vi.stubGlobal("fetch", vi.fn(async () => tooMany()));
    const p = getBlock(1);
    const assertion = expect(p).rejects.toThrow("HTTP 429 from https://a");
    await vi.runAllTimersAsync();
    await assertion;
  });
});
