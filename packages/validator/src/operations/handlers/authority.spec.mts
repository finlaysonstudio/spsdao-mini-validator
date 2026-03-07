import { describe, it, expect } from "vitest";
import { handleSetAuthority, handleConfigUpdate } from "./authority.mjs";
import {
  createStateStore,
  createActionContext,
  createParsedAction,
} from "../../__fixtures__/helpers.mjs";

describe("handleSetAuthority", () => {
  it("sets config entries for authorities", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "set_authority" });
    const action = createParsedAction({
      name: "set_authority",
      players: ["alice"],
      params: {
        account_name: "alice",
        authorities: { admin: "true", operator: "bob" },
      },
    });

    const result = handleSetAuthority(action, ctx);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].object_type).toBe("config");
    expect(result.events[0].data.account_name).toBe("alice");

    expect(state.config.getString("authority", "alice.admin", "")).toBe("true");
    expect(state.config.getString("authority", "alice.operator", "")).toBe(
      "bob",
    );
  });

  it("returns error 1 for missing account_name", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "set_authority",
      players: ["alice"],
      params: {},
    });

    const result = handleSetAuthority(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });
});

describe("handleConfigUpdate", () => {
  it("sets config entry", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state, actionType: "config_update" });
    const action = createParsedAction({
      name: "config_update",
      players: ["admin"],
      params: {
        group_name: "validator",
        name: "min_validators",
        value: "5",
      },
    });

    const result = handleConfigUpdate(action, ctx);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data.group_name).toBe("validator");
    expect(result.events[0].data.name).toBe("min_validators");
    expect(result.events[0].data.value).toBe("5");

    expect(
      state.config.getNumber("validator", "min_validators", 0),
    ).toBe(5);
  });

  it("returns error 1 for missing params", () => {
    const state = createStateStore();
    const ctx = createActionContext({ state });
    const action = createParsedAction({
      name: "config_update",
      players: ["admin"],
      params: { group_name: "validator" },
    });

    const result = handleConfigUpdate(action, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(1);
  });
});
