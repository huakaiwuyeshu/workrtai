import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskRegistry } from "../src/registry/task-registry.mjs";

test("persists task graph, artifacts, checkpoints, and idempotent results", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workrtai-registry-"));
  const registry = new TaskRegistry(path.join(root, "workbench.sqlite"));
  const parent = registry.createTask({ task_id: "task-parent", run_id: "run-1", type: "integration_task", title: "integrate", allowed_paths: ["src"], allowed_tools: ["git"], success_criteria: ["tests"] });
  registry.createTask({ task_id: "task-child", run_id: "run-1", parent_task_id: parent.task_id, type: "child_task", title: "verify", allowed_paths: ["src/a"], allowed_tools: ["test"], success_criteria: ["green"] });
  registry.postProgress("task-child", "running tests", 50);
  const result = registry.postResult("task-child", { status: "completed", result_version: 1, summary: "green", artifacts: [{ kind: "report", content: { passed: true } }] });
  const duplicate = registry.postResult("task-child", { status: "completed", result_version: 1, summary: "green" });
  assert.equal(result.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  const task = registry.getTask("task-parent");
  assert.equal(task.children[0].status, "completed");
  assert.equal(registry.getTask("task-child").artifacts.length, 1);
  assert.equal(registry.checkpoint("run-1", { root: parent.task_id }).resumable, true);
  assert.throws(() => registry.transition("task-child", "running"), /invalid_task_transition/);
  registry.close();
});
