import { describe, it, expect } from "vitest";
import { generateTransitions } from "./transitions.mjs";
import {
  createStateStore,
  FIXTURE_BLOCK_NUM,
  FIXTURE_BLOCK_TIME,
} from "../__fixtures__/helpers.mjs";

describe("generateTransitions", () => {
  it("returns empty for non-transition block numbers", () => {
    const state = createStateStore();
    const results = generateTransitions(
      state,
      FIXTURE_BLOCK_NUM,
      FIXTURE_BLOCK_TIME,
    );
    expect(results).toEqual([]);
  });
});
