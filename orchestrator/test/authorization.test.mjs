import assert from "node:assert/strict";
import test from "node:test";
import { validateTaskInput } from "../src/policies/authorization.mjs";

test("requires scoped permissions and criteria for child tasks", () => {
  const parent = { task_id: "parent" };
  assert.throws(() => validateTaskInput({ type: "child_task", title: "child" }, parent), /child_scope_and_criteria_required/);
  assert.throws(() => validateTaskInput({ type: "child_task", title: "child", allowed_paths: ["../secret"], allowed_tools: ["test"], success_criteria: ["green"] }, parent), /unsafe_task_scope/);
  assert.doesNotThrow(() => validateTaskInput({ type: "child_task", title: "child", allowed_paths: ["src"], allowed_tools: ["test"], success_criteria: ["green"] }, parent));
});

