import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StatusFile } from "./status_file.mjs";

describe("StatusFile", () => {
  const dirs: string[] = [];
  const fresh = (): string => {
    const d = mkdtempSync(join(tmpdir(), "status-file-"));
    dirs.push(d);
    return join(d, "status.json");
  };
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("writes start time, info, block, head, behind and rate", () => {
    const path = fresh();
    const s = new StatusFile(path, { startedAt: 2000, info: { upstream_version: "1.5.1" } });
    s.setInfo({ role: "leader" });
    expect(s.update({ block_num: 100, head_block: 160, rate: 12.345 }, 5000)).toBe(true);
    expect(read(path)).toEqual({
      started_at: new Date(2000).toISOString(),
      started_unix: 2,
      upstream_version: "1.5.1",
      role: "leader",
      block_num: 100,
      head_block: 160,
      behind: 60,
      rate: 12.35,
      updated_at: new Date(5000).toISOString(),
    });
  });

  it("writes null progress at start", () => {
    const path = fresh();
    expect(new StatusFile(path, { startedAt: 1000 }).start(1000)).toBe(true);
    expect(read(path)).toMatchObject({ started_unix: 1, block_num: null, head_block: null, behind: null, rate: null });
  });

  it("throttles block writes to once per interval", () => {
    const path = fresh();
    const s = new StatusFile(path, { everyMs: 1000 });
    expect(s.update({ block_num: 1, head_block: 2, rate: 0 }, 10_000)).toBe(true);
    expect(s.update({ block_num: 2, head_block: 2, rate: 0 }, 10_500)).toBe(false);
    expect(read(path).block_num).toBe(1);
    expect(s.update({ block_num: 3, head_block: 3, rate: 0 }, 11_000)).toBe(true);
    expect(read(path).block_num).toBe(3);
  });

  it("never reports a negative lag", () => {
    const path = fresh();
    new StatusFile(path).update({ block_num: 10, head_block: 0, rate: 0 }, 1000);
    expect(read(path).behind).toBe(0);
  });

  it("does nothing without a path", () => {
    const s = new StatusFile("");
    expect(s.start(1000)).toBe(false);
    expect(s.update({ block_num: 1, head_block: 1, rate: 0 }, 1000)).toBe(false);
  });
});
