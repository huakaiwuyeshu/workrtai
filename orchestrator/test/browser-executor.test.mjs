import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BrowserExecutor } from "../src/executors/browser-executor.mjs";

test("executes browser actions and returns screenshot artifacts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workrtai-browser-")); const calls = [];
  const executor = new BrowserExecutor({ artifactRoot: root, browserFactory: async () => ({ newPage: async () => ({ goto: async (url) => calls.push(["goto", url]), click: async (selector) => calls.push(["click", selector]), fill: async () => {}, press: async () => {}, screenshot: async ({ path: output }) => calls.push(["screenshot", output]) }), close: async () => calls.push(["close"]) }) });
  const result = await executor.run({ taskId: "task", url: "https://example.test", actions: [{ type: "click", selector: "#run" }], verify: async () => true });
  assert.equal(result.status, "completed"); assert.equal(result.evidence[0].kind, "screenshot"); assert.deepEqual(calls.map(([name]) => name), ["goto", "click", "screenshot", "close"]);
});

