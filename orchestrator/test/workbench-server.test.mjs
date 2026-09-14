import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskRegistry } from "../src/registry/task-registry.mjs";
import { WorkbenchBridge } from "../src/bridge/workbench-bridge.mjs";
import { WorkbenchMcpServer } from "../src/mcp/workbench-server.mjs";

test("exposes task lifecycle through tools/list and tools/call", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workrtai-mcp-"));
  const registry = new TaskRegistry(path.join(root, "workbench.sqlite"));
  const server = new WorkbenchMcpServer(new WorkbenchBridge({ registry }));
  const listed = await server.handle({ method: "tools/list" });
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["create_task", "dispatch_task", "post_progress", "post_result", "get_task", "checkpoint", "evaluate_gate"]);
  const created = await server.handle({ id: 1, method: "tools/call", params: { name: "create_task", arguments: { task_id: "review", run_id: "run", type: "review_task", title: "review", allowed_paths: [], allowed_tools: [], success_criteria: [] } } });
  assert.equal(created.structuredContent.task_id, "review");
  const fetched = await server.handle({ id: 2, method: "tools/call", params: { name: "get_task", arguments: { task_id: "review" } } });
  assert.equal(fetched.structuredContent.task.status, "pending");
  registry.close();
});
