export class PatternLimitError extends Error {
  constructor(message) { super(message); this.name = "PatternLimitError"; }
}

export class PatternRuntime {
  constructor({ bridge, approve = async () => true } = {}) {
    this.bridge = bridge;
    this.approve = approve;
  }

  async run({ pattern, rootTaskId, context = {} }) {
    if (!pattern?.id || !Array.isArray(pattern.steps)) throw new Error("invalid_pattern");
    if (pattern.requires_human_approval && !(await this.approve({ patternId: pattern.id, rootTaskId }))) return { status: "blocked", reason: "human_approval_required" };
    const run = { pattern_id: pattern.id, root_task_id: rootTaskId, rounds: 0, agents: 0, outputs: [] };
    for (const step of pattern.steps) {
      if (step.create) {
        if (++run.agents > (pattern.max_agents ?? Infinity)) throw new PatternLimitError("max_agents_exceeded");
        const task = this.bridge.createTask({ ...context[step.create], parent_task_id: step.create === "child" ? rootTaskId : undefined });
        run.outputs.push({ step: "create", task_id: task.task_id });
        context[step.create] = { ...context[step.create], task_id: task.task_id };
      } else if (step.dispatch) {
        run.outputs.push(await this.bridge.dispatchTask(context[step.dispatch].task_id));
      } else if (step.wait) {
        run.rounds += 1;
        if (run.rounds > (pattern.max_rounds ?? Infinity)) throw new PatternLimitError("max_rounds_exceeded");
        const task = this.bridge.getTask(context[step.wait].task_id).task;
        if (!["completed", "blocked", "failed"].includes(task.status)) return { status: "waiting", run, task_id: task.task_id };
        run.outputs.push({ step: "wait", task_id: task.task_id, status: task.status });
      } else if (step.evaluate) {
        const taskId = context[step.evaluate].task_id;
        const task = this.bridge.getTask(taskId).task;
        if (task.status !== "completed") return { status: task.status, run, task_id: taskId };
      } else if (step.synthesize) {
        run.outputs.push({ step: "synthesize", task_id: rootTaskId });
      } else throw new Error("unknown_pattern_step");
    }
    return { status: "completed", run };
  }
}

