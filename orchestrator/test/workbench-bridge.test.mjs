import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskRegistry } from "../src/registry/task-registry.mjs";
import { WorkbenchBridge } from "../src/bridge/workbench-bridge.mjs";

test("bridge dispatches child task and notifies callback exactly once", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workrtai-bridge-"));
  const registry = new TaskRegistry(path.join(root, "workbench.sqlite"));
  const calls = [];
  const daemon = { create: async (input) => ({ session_id: input.sessionId }) };
  const bridge = new WorkbenchBridge({ registry, daemon, notify: async (...args) => calls.push(args) });
  const parent = bridge.createTask({ task_id: "parent", run_id: "run", type: "integration_task", title: "parent", allowed_paths: [], allowed_tools: [], success_criteria: [] });
  const child = bridge.createTask({ task_id: "child", run_id: "run", parent_task_id: parent.task_id, type: "child_task", title: "child", assigned_cli: "claude", callback_agent_id: "agent-parent", allowed_paths: ["src"], allowed_tools: ["test"], success_criteria: ["green"] });
  const dispatched = await bridge.dispatchTask(child.task_id);
  assert.equal(dispatched.status, "running");
  await bridge.postResult(child.task_id, { status: "completed", result_version: 1, summary: "green" });
  await bridge.postResult(child.task_id, { status: "completed", result_version: 1, summary: "green" });
  assert.equal(calls.length, 1);
  assert.equal(bridge.getTask(child.task_id).task.status, "completed");
  registry.close();
});

