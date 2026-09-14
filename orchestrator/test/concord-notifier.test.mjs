import assert from "node:assert/strict";
import test from "node:test";
import { ConcordNotifier } from "../src/adapters/concord-notifier.mjs";

test("checks presence and sends deterministic prompt keys", async () => {
  const calls = [];
  const notifier = new ConcordNotifier({ inspectWork: async () => ({ agents: [{ agent_id: "agent-b", promptable: true }] }), updateWork: async (payload) => { calls.push(payload); return { delivered: true }; }, cli: "codex" });
  await notifier.prompt({ fromAgentId: "agent-a", toAgentId: "agent-b", content: "Review task" });
  await notifier.prompt({ fromAgentId: "agent-a", toAgentId: "agent-b", content: "Review task" });
  assert.equal(calls[0].idempotency_key, calls[1].idempotency_key);
  assert.equal(calls[0].operation, "prompt");
});

test("does not reroute when target is absent", async () => {
  const notifier = new ConcordNotifier({ inspectWork: async () => ({ agents: [] }), updateWork: async () => assert.fail("must not send") });
  await assert.rejects(notifier.prompt({ fromAgentId: "agent-a", toAgentId: "agent-b", content: "Review task" }), /concord_agent_unavailable/);
});

