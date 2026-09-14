import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";

const ALLOWED_REQUESTS = new Set(["list", "status", "create", "write", "attach", "close"]);
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function defaultDiscoveryPath() {
  const dataRoot = process.env.CLI_MANAGER_WORKBENCH_DATA_DIR || path.join(homedir(), ".cli-manager-workbench");
  const fileName = process.env.NODE_ENV === "development" ? "daemon.dev.json" : "daemon.json";
  return path.join(dataRoot, fileName);
}

export class DaemonProtocolMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = "DaemonProtocolMismatchError";
  }
}

export class CliManagerDaemonAdapter {
  constructor({ discoveryPath = defaultDiscoveryPath(), clientVersion = "workrtai-dev", expectedProtocolVersion, timeoutMs = 10_000, onEvent } = {}) {
    this.discoveryPath = discoveryPath;
    this.clientVersion = clientVersion;
    this.expectedProtocolVersion = expectedProtocolVersion;
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent;
    this.socket = undefined;
    this.readline = undefined;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    const discovery = JSON.parse(await readFile(this.discoveryPath, "utf8"));
    if (!Number.isInteger(discovery.port) || discovery.port <= 0 || typeof discovery.token !== "string" || discovery.token.length === 0) {
      throw new Error("invalid_workbench_daemon_discovery");
    }
    const socket = createConnection({ host: "127.0.0.1", port: discovery.port });
    this.socket = socket;
    this.readline = createInterface({ input: socket });
    this.readline.on("line", (line) => this.#handleFrame(line));
    socket.once("error", (error) => this.#rejectPending(error));
    socket.once("close", () => this.#rejectPending(new Error("daemon_connection_closed")));
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const auth = await this.#requestRaw({ type: "auth", token: discovery.token, client_version: this.clientVersion }, true);
    if (auth.type !== "auth_ok") throw new Error(auth.message || "daemon_auth_failed");
    if (this.expectedProtocolVersion !== undefined && auth.protocol_version !== this.expectedProtocolVersion) {
      throw new DaemonProtocolMismatchError(`expected protocol ${this.expectedProtocolVersion}, received ${auth.protocol_version ?? "missing"}`);
    }
    return { protocolVersion: auth.protocol_version, features: auth.features ?? [], daemonVersion: auth.daemon_version, pid: auth.pid };
  }

  async list() { return this.#request("list"); }
  async status() { return this.#request("status"); }
  async create({ sessionId, cwd, envVars, shell } = {}) {
    this.#assertSessionId(sessionId);
    return this.#request("create", { session_id: sessionId, cwd, env_vars: envVars, shell });
  }
  async write(sessionId, data) {
    this.#assertSessionId(sessionId);
    if (typeof data !== "string") throw new TypeError("daemon_write_data_must_be_string");
    return this.#request("write", { session_id: sessionId, data });
  }
  async attach(sessionId, afterSequence) {
    this.#assertSessionId(sessionId);
    return this.#request("attach", { session_id: sessionId, after_sequence: afterSequence });
  }
  async close(sessionId) {
    this.#assertSessionId(sessionId);
    return this.#request("close", { session_id: sessionId });
  }

  disconnect() {
    this.readline?.close();
    this.socket?.end();
    this.socket = undefined;
  }

  async reconnect() {
    this.disconnect();
    return this.connect();
  }

  #request(type, payload = {}) {
    if (!ALLOWED_REQUESTS.has(type)) throw new Error(`daemon_request_not_allowed:${type}`);
    return this.#requestRaw({ type, ...payload });
  }

  #requestRaw(frame, auth = false) {
    if (!this.socket) return Promise.reject(new Error("daemon_not_connected"));
    const id = auth ? undefined : this.nextId++;
    const outbound = id === undefined ? frame : { ...frame, id };
    this.socket.write(`${JSON.stringify(outbound)}\n`);
    return new Promise((resolve, reject) => {
      if (id === undefined) {
        this.pending.set(0, { resolve, reject });
      } else {
        this.pending.set(id, { resolve, reject });
      }
      setTimeout(() => {
        const pending = this.pending.get(id ?? 0);
        if (pending) { this.pending.delete(id ?? 0); pending.reject(new Error("daemon_request_timeout")); }
      }, this.timeoutMs).unref?.();
    });
  }

  #handleFrame(line) {
    let frame;
    try { frame = JSON.parse(line); } catch { this.#rejectPending(new Error("daemon_invalid_json")); return; }
    if (frame.type === "output" || frame.type === "exit" || frame.type === "hook_report") {
      this.onEvent?.(frame);
      return;
    }
    const key = frame.id ?? 0;
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    if (frame.type === "err" || frame.type === "auth_err") pending.reject(new Error(frame.message || "daemon_request_failed"));
    else pending.resolve(frame);
  }

  #rejectPending(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  #assertSessionId(sessionId) {
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) throw new Error("invalid_daemon_session_id");
  }
}

