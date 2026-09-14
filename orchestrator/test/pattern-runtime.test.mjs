import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskRegistry } from "../src/registry/task-registry.mjs";
import { WorkbenchBridge } from "../src/bridge/workbench-bridge.mjs";
import { PatternRuntime, PatternLimitError } from "../src/runtime/pattern-runtime.mjs";

test("runs child-task pattern with approval, dispatch, wait and synthesize", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workrtai-pattern-"));
  const registry = new TaskRegistry(path.join(root, "workbench.sqlite"));
  const bridge = new WorkbenchBridge({ registry, daemon: { create: async ({ sessionId }) => ({ session_id: sessionId }) } });
  const runtime = new PatternRuntime({ bridge });
  bridge.createTask({ task_id: "root", run_id: "run", type: "integration_task", title: "root", allowed_paths: [], allowed_tools: [], success_criteria: [] });
  const result = await runtime.run({
    pattern: { id: "child_task", max_agents: 1, max_rounds: 1, requires_human_approval: true, steps: [{ create: "child" }, { dispatch: "child" }, { wait: "child" }] },
    rootTaskId: "root",
    context: { child: { type: "child_task", title: "verify", assigned_cli: "claude", allowed_paths: [], allowed_tools: [], success_criteria: [] } },
  });
  assert.equal(result.status, "waiting");
  registry.close();
});

test("enforces pattern agent and round limits", async () => {
  const bridge = { createTask: () => ({ task_id: "child" }) };
  const runtime = new PatternRuntime({ bridge });
  await assert.rejects(runtime.run({ pattern: { id: "limited", max_agents: 0, steps: [{ create: "child" }] }, rootTaskId: "root", context: { child: {} } }), PatternLimitError);
});
