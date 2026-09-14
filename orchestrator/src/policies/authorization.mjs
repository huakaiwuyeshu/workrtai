const SAFE_PATH = /^(?![A-Za-z]:)(?![\\/])[^\0]+$/;

export function validateTaskInput(input, parentTask = null) {
  if (!input?.type || !["review_task", "handoff_task", "child_task", "integration_task"].includes(input.type)) throw new Error("invalid_task_type");
  if (!input.title?.trim()) throw new Error("task_title_required");
  for (const item of [...(input.allowed_paths ?? []), ...(input.allowed_tools ?? [])]) {
    if (typeof item !== "string" || !item || item.includes("..") || !SAFE_PATH.test(item)) throw new Error("unsafe_task_scope");
  }
  if (input.type === "child_task" && !parentTask) throw new Error("child_parent_required");
  if (input.type === "child_task" && (!input.allowed_paths?.length || !input.allowed_tools?.length || !input.success_criteria?.length)) throw new Error("child_scope_and_criteria_required");
  return true;
}

export function assertCanDispatch(task, { activeAgents = 0, maxAgents = Infinity } = {}) {
  if (task.status !== "pending") throw new Error(`task_not_dispatchable:${task.status}`);
  if (activeAgents >= maxAgents) throw new Error("max_agents_exceeded");
  return true;
}

