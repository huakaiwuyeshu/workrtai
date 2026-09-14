import { TaskRegistry } from "../registry/task-registry.mjs";
import { assertCanDispatch, validateTaskInput } from "../policies/authorization.mjs";

export class WorkbenchBridge {
  constructor({ registry = new TaskRegistry(), daemon, notify } = {}) {
    this.registry = registry;
    this.daemon = daemon;
    this.notify = notify;
  }

  createTask(input) {
    const parent = input.parent_task_id ? this.registry.getTask(input.parent_task_id).task : null;
    validateTaskInput(input, parent);
    return this.registry.createTask(input);
  }

  createReviewTask({ title, assigned_cli, assigned_model, callback_agent_id, success_criteria = ["review_report"] }) {
    return this.createTask({ type: "review_task", title, assigned_cli, assigned_model, callback_agent_id, allowed_paths: [], allowed_tools: ["read", "inspect"], success_criteria });
  }

  createChildTask(parentTaskId, input) {
    return this.createTask({ ...input, type: "child_task", parent_task_id: parentTaskId });
  }

  async handoff(taskId, { assigned_cli, assigned_model, callback_agent_id } = {}) {
    const current = this.registry.getTask(taskId).task;
    if (!["review_task", "child_task"].includes(current.type)) throw new Error("handoff_task_type_required");
    this.registry.updateAssignment(taskId, { assigned_cli, assigned_model, callback_agent_id });
    return this.dispatchTask(taskId);
  }

  async ask(taskId, message) {
    const agent = this.registry.getTask(taskId).agents[0];
    if (!agent || !this.daemon) throw new Error("task_agent_unavailable");
    await this.daemon.write(agent.session_ref, `${message}\n`);
    return { task_id: taskId, session_ref: agent.session_ref, delivered: true };
  }

  async dispatchTask(taskId) {
    const task = this.registry.getTask(taskId).task;
    if (!this.daemon) throw new Error("daemon_adapter_required");
    assertCanDispatch(task);
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

  scheduleTimeout(taskId, timeoutMs, reason = "child_task_timeout") {
    const timer = setTimeout(() => {
      try { this.registry.transition(taskId, "blocked", { reason }, `${taskId}:timeout`); } catch { /* task may already be terminal */ }
    }, timeoutMs);
    return () => clearTimeout(timer);
  }

  getTask(taskId) { return this.registry.getTask(taskId); }
  listTasks(filter) { return this.registry.listTasks(filter); }
  async recoverRunningTasks() {
    const tasks = this.registry.listTasks({ status: "running" });
    if (!this.daemon?.list) return { recovered: [], unavailable: tasks.map((task) => task.task_id) };
    const sessions = await this.daemon.list();
    const active = new Set(sessions.map((session) => session.session_id ?? session.sessionId));
    const recovered = [], unavailable = [];
    for (const task of tasks) {
      const ref = this.registry.getTask(task.task_id).agents[0]?.session_ref;
      if (ref && active.has(ref)) recovered.push(task.task_id); else unavailable.push(task.task_id);
    }
    return { recovered, unavailable };
  }
  checkpoint(runId, state) { return this.registry.checkpoint(runId, state); }
  evaluateGate(taskId, gateId) {
    const record = this.registry.getTask(taskId);
    const completed = record.task.status === "completed";
    const evidence = record.events.filter((event) => event.event_type === "task.completed").flatMap((event) => event.payload?.evidence ?? []);
    return { gate_id: gateId, passed: completed && evidence.length > 0, missing: completed ? [] : ["task.completed"], evidence };
  }
}
