import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskRegistry } from "../src/registry/task-registry.mjs";
import { WorkbenchBridge } from "../src/bridge/workbench-bridge.mjs";

test("exposes explicit review and child task modes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workrtai-modes-"));
  const registry = new TaskRegistry(path.join(root, "workbench.sqlite"));
  const bridge = new WorkbenchBridge({ registry });
  const parent = bridge.createTask({ task_id: "parent", run_id: "run", type: "integration_task", title: "main", allowed_paths: [], allowed_tools: [], success_criteria: [] });
  const review = bridge.createReviewTask({ title: "review implementation", assigned_cli: "claude", assigned_model: "opus", callback_agent_id: "agent-a" });
  const child = bridge.createChildTask(parent.task_id, { title: "browser verify", assigned_cli: "claude", allowed_paths: ["tests"], allowed_tools: ["browser"], success_criteria: ["screenshot"] });
  assert.equal(review.type, "review_task");
  assert.equal(child.parent_task_id, parent.task_id);
  registry.close();
});

test("moves an unfinished task to blocked on timeout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workrtai-timeout-"));
  const registry = new TaskRegistry(path.join(root, "workbench.sqlite"));
  const bridge = new WorkbenchBridge({ registry });
  const task = bridge.createReviewTask({ title: "slow review", assigned_cli: "claude" });
  await new Promise((resolve) => { bridge.scheduleTimeout(task.task_id, 10); setTimeout(resolve, 30); });
  assert.equal(bridge.getTask(task.task_id).task.status, "blocked");
  registry.close();
});

