import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TERMINAL = new Set(["completed", "blocked", "failed", "cancelled"]);
const TRANSITIONS = {
  pending: new Set(["running", "cancelled"]),
  running: new Set(["review", "completed", "blocked", "failed", "cancelled"]),
  review: new Set(["running", "completed", "blocked", "failed", "cancelled"]),
};

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const json = (value) => JSON.stringify(value ?? null);
const parse = (value) => (value == null ? null : JSON.parse(value));

export class TaskRegistry {
  constructor(databasePath = path.resolve(".workbench", "workbench.sqlite")) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, parent_task_id TEXT REFERENCES tasks(task_id),
        type TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, assigned_cli TEXT,
        assigned_model TEXT, allowed_paths_json TEXT NOT NULL, allowed_tools_json TEXT NOT NULL,
        success_criteria_json TEXT NOT NULL, callback_agent_id TEXT, version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_events (
        event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(task_id), event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL, expected_version INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_artifacts (
        artifact_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(task_id), kind TEXT NOT NULL,
        path TEXT, sha256 TEXT, content_json TEXT, description TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, last_event_id TEXT NOT NULL,
        state_json TEXT NOT NULL, resumable INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
    `);
  }

  close() { this.db.close(); }

  createTask(input) {
    const taskId = input.task_id ?? id("task");
    const runId = input.run_id ?? id("run");
    const created = now();
    this.db.prepare(`INSERT INTO tasks
      (task_id,run_id,parent_task_id,type,title,status,assigned_cli,assigned_model,allowed_paths_json,allowed_tools_json,success_criteria_json,callback_agent_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId, runId, input.parent_task_id ?? null, input.type, input.title, "pending", input.assigned_cli ?? null, input.assigned_model ?? null, json(input.allowed_paths ?? []), json(input.allowed_tools ?? []), json(input.success_criteria ?? []), input.callback_agent_id ?? null, created, created);
    this.#event(taskId, "task.created", { task: taskId, status: "pending" }, 0, `create:${taskId}`);
    return this.getTask(taskId).task;
  }

  transition(taskId, status, payload = {}, idempotencyKey = `${taskId}:status:${status}:${payload.result_version ?? ""}`) {
    const current = this.#row(taskId);
    if (current.status === status) return this.getTask(taskId).task;
    if (!TRANSITIONS[current.status]?.has(status)) throw new Error(`invalid_task_transition:${current.status}->${status}`);
    const eventType = `task.${status}`;
    this.#event(taskId, eventType, { ...payload, status }, current.version, idempotencyKey);
    return this.getTask(taskId).task;
  }

  postProgress(taskId, message, percent, artifactIds = []) {
    const current = this.#row(taskId);
    if (current.status === "pending") this.transition(taskId, "running", {}, `${taskId}:auto-running`);
    const row = this.#row(taskId);
    const event = this.#event(taskId, "task.progress", { message, percent, artifact_ids: artifactIds }, row.version, `${taskId}:progress:${crypto.createHash("sha256").update(`${message}:${percent ?? ""}`).digest("hex").slice(0, 12)}`);
    return { event_id: event.event_id, status: "running" };
  }

  postResult(taskId, result) {
    if (!result?.status || !TERMINAL.has(result.status)) throw new Error("invalid_result_status");
    const key = `${taskId}:result:${result.result_version ?? 1}`;
    const current = this.#row(taskId);
    const existing = this.db.prepare("SELECT event_id FROM task_events WHERE idempotency_key = ?").get(key);
    if (existing) return { event_id: existing.event_id, status: result.status, duplicate: true };
    const event = this.#event(taskId, `task.${result.status}`, result, current.version, key);
    for (const artifact of result.artifacts ?? []) this.addArtifact(taskId, artifact);
    return { event_id: event.event_id, status: result.status, duplicate: false };
  }

  addArtifact(taskId, artifact) {
    const artifactId = artifact.artifact_id ?? id("artifact");
    this.db.prepare(`INSERT OR IGNORE INTO task_artifacts (artifact_id,task_id,kind,path,sha256,content_json,description,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(artifactId, taskId, artifact.kind, artifact.path ?? null, artifact.sha256 ?? null, json(artifact.content), artifact.description ?? null, now());
    return artifactId;
  }

  checkpoint(runId, state, lastEventId = this.#lastEvent(runId)) {
    const checkpointId = id("checkpoint");
    this.db.prepare("INSERT INTO checkpoints (checkpoint_id,run_id,last_event_id,state_json,created_at) VALUES (?,?,?,?,?)").run(checkpointId, runId, lastEventId ?? "", json(state), now());
    return { checkpoint_id: checkpointId, resumable: true };
  }

  getTask(taskId) {
    const row = this.#row(taskId);
    const task = { ...row, allowed_paths: parse(row.allowed_paths_json), allowed_tools: parse(row.allowed_tools_json), success_criteria: parse(row.success_criteria_json) };
    delete task.allowed_paths_json; delete task.allowed_tools_json; delete task.success_criteria_json;
    const children = this.db.prepare("SELECT task_id FROM tasks WHERE parent_task_id = ? ORDER BY created_at").all(taskId).map((child) => this.getTask(child.task_id).task);
    const events = this.db.prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at,event_id").all(taskId).map((event) => ({ ...event, payload: parse(event.payload_json) }));
    const artifacts = this.db.prepare("SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY created_at").all(taskId).map((artifact) => ({ ...artifact, content: parse(artifact.content_json) }));
    return { task, children, events, artifacts };
  }

  #row(taskId) {
    const row = this.db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
    if (!row) throw new Error(`task_not_found:${taskId}`);
    return row;
  }

  #event(taskId, eventType, payload, expectedVersion, key) {
    const existing = this.db.prepare("SELECT event_id FROM task_events WHERE idempotency_key = ?").get(key);
    if (existing) return existing;
    const eventId = id("event");
    const timestamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO task_events (event_id,task_id,event_type,payload_json,expected_version,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?)").run(eventId, taskId, eventType, json(payload), expectedVersion, key, timestamp);
      const nextStatus = payload.status;
      this.db.prepare("UPDATE tasks SET version = version + 1, status = COALESCE(?, status), updated_at = ? WHERE task_id = ? AND version = ?").run(nextStatus ?? null, timestamp, taskId, expectedVersion);
      this.db.exec("COMMIT");
      return { event_id: eventId };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  #lastEvent(runId) {
    return this.db.prepare("SELECT e.event_id FROM task_events e JOIN tasks t ON t.task_id=e.task_id WHERE t.run_id=? ORDER BY e.created_at DESC LIMIT 1").get(runId)?.event_id ?? "";
  }
}

