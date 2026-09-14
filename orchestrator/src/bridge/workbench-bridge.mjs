import { TaskRegistry } from "../registry/task-registry.mjs";

export class WorkbenchBridge {
  constructor({ registry = new TaskRegistry(), daemon, notify } = {}) {
    this.registry = registry;
    this.daemon = daemon;
    this.notify = notify;
  }

  createTask(input) {
    return this.registry.createTask(input);
  }

  async dispatchTask(taskId) {
    const task = this.registry.getTask(taskId).task;
    if (!this.daemon) throw new Error("daemon_adapter_required");
    const sessionId = `${taskId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 52)}-agent`;
    const session = await this.daemon.create({ sessionId, cwd: process.cwd(), shell: task.assigned_cli });
    this.registry.bindAgent(taskId, { session_ref: sessionId, cli_manager_session_id: sessionId, role: task.parent_task_id ? "child" : "main" });
    this.registry.transition(taskId, "running", { session_ref: sessionId }, `${taskId}:dispatch`);
    return { task_id: taskId, status: "running", session_ref: sessionId, cli_manager_session_id: sessionId };
  }

  postProgress(taskId, input) {
    return this.registry.postProgress(taskId, input.message, input.percent, input.artifact_ids);
  }

  async postResult(taskId, result) {
    const outcome = this.registry.postResult(taskId, result);
    const task = this.registry.getTask(taskId).task;
    if (!outcome.duplicate && task.callback_agent_id) await this.notify?.(task.callback_agent_id, { type: `task.${outcome.status}`, task_id: taskId, summary: result.summary, evidence: result.evidence ?? [] });
    return outcome;
  }

  getTask(taskId) { return this.registry.getTask(taskId); }
  checkpoint(runId, state) { return this.registry.checkpoint(runId, state); }
}

