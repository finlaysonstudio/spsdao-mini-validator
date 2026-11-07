// Not ported: upstream 1.5.1 has no test for transition_cancel_delegation_promises.
// Written in the same style against cancel_delegation_promises.ts.
import { beforeEach, expect, test } from "vitest";
import { Fixture, emoji_payload, garbage_payload } from "../../__tests__/fixture.mjs";
import type { PromiseRow } from "../../state/index.mjs";

const fixture = new Fixture();
const transitionPoints = fixture.transitionPoints;

const promise = (type: string, ext_id: string, status: PromiseRow["status"]): PromiseRow => ({
  ext_id,
  type,
  status,
  params: {},
  controllers: ["sl-delegation"],
  fulfill_timeout_seconds: 3600,
  fulfilled_by: status === "fulfilled" ? "bob" : null,
  fulfilled_at: status === "fulfilled" ? new Date("2025-01-01T00:00:00Z") : null,
  fulfilled_expiration: status === "fulfilled" ? new Date("2025-01-02T00:00:00Z") : null,
  created_date: new Date("2025-01-01T00:00:00Z"),
  updated_date: new Date("2025-01-01T00:00:00Z"),
});

beforeEach(() => {
  fixture.restore();
  fixture.state.promises.setLive(promise("delegation", "b-open", "open"));
  fixture.state.promises.setLive(promise("delegation", "a-open", "open"));
  fixture.state.promises.setLive(promise("delegation", "c-fulfilled", "fulfilled"));
  fixture.state.promises.setLive(promise("other", "d-open", "open"));
  fixture.load();
});

test("Garbage data for transition_cancel_delegation_promises does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_cancel_delegation_promises", "steemmonsters", garbage_payload)).not.toThrow();
});

test("Lots of emoji for transition_cancel_delegation_promises does not crash.", () => {
  expect(() => fixture.opsHelper.processVirtualOp("transition_cancel_delegation_promises", "steemmonsters", emoji_payload)).not.toThrow();
});

test("transition_cancel_delegation_promises cancels only open delegation promises, in ext_id order", () => {
  const [action] = fixture.opsHelper.processVirtualOp(
    "transition_cancel_delegation_promises",
    "$TRANSITIONS",
    { block_num: transitionPoints.transition_points.delegation_offer_block },
    { block_num: transitionPoints.transition_points.delegation_offer_block },
  );
  const updated = (action as unknown as { result: { object_type: string; event_type: string; data: { ext_id: string; status: string } }[] }).result
    .filter((e) => e.object_type === "promise" && e.event_type === "update")
    .map((e) => [e.data.ext_id, e.data.status]);
  expect(updated).toEqual([
    ["a-open", "cancelled"],
    ["b-open", "cancelled"],
  ]);
  expect(fixture.state.promises.getClosed("delegation", "a-open")?.status).toBe("cancelled");
  expect(fixture.state.promises.getLive("delegation", "c-fulfilled")?.status).toBe("fulfilled");
  expect(fixture.state.promises.getLive("other", "d-open")?.status).toBe("open");
});
