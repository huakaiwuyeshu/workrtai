import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliManagerDaemonAdapter, DaemonProtocolMismatchError } from "../src/adapters/cli-manager-daemon.mjs";

async function fakeDaemon() {
  const requests = [];
  const server = createServer((socket) => {
    let first = true;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const frame = JSON.parse(buffer.slice(0, end));
        requests.push(frame);
        buffer = buffer.slice(end + 1);
        if (first) {
          first = false;
          socket.write(JSON.stringify({ type: "auth_ok", protocol_version: 1, features: ["attach"], daemon_version: "test", pid: 1 }) + "\n");
        } else {
          socket.write(JSON.stringify({ type: frame.type === "list" ? "sessions" : "ok", id: frame.id }) + "\n");
          if (frame.type === "attach") socket.write(JSON.stringify({ type: "output", session_id: frame.session_id, data_base64: "dGVzdA==" }) + "\n");
          if (frame.type === "close") {
            socket.write(JSON.stringify({ type: "exit", session_id: frame.session_id, exit_code: 0 }) + "\n");
            socket.write(JSON.stringify({ type: "hook_report", payload: { event: "stop" } }) + "\n");
          }
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, port, requests };
}

test("authenticates, sends the full allowlist, forwards events, and reconnects", async (t) => {
  const daemon = await fakeDaemon();
  t.after(() => daemon.server.close());
  const dir = await mkdtemp(path.join(tmpdir(), "workrtai-daemon-"));
  const discovery = path.join(dir, "daemon.json");
  await writeFile(discovery, JSON.stringify({ port: daemon.port, token: "test-token" }));
  const events = [];
  const adapter = new CliManagerDaemonAdapter({ discoveryPath: discovery, expectedProtocolVersion: 1, onEvent: (event) => events.push(event) });
  assert.deepEqual((await adapter.connect()).features, ["attach"]);
  assert.equal((await adapter.list()).type, "sessions");
  assert.equal((await adapter.status()).type, "ok");
  await adapter.create({ sessionId: "child-1" });
  await adapter.write("child-1", "echo test\n");
  await adapter.attach("child-1", 0);
  await adapter.close("child-1");
  assert.deepEqual(events.map((event) => event.type), ["output", "exit", "hook_report"]);
  assert.deepEqual(daemon.requests.map((frame) => frame.type), ["auth", "list", "status", "create", "write", "attach", "close"]);
  await adapter.reconnect();
  assert.equal((await adapter.list()).type, "sessions");
  adapter.disconnect();
});

test("blocks incompatible daemon protocol", async (t) => {
  const daemon = await fakeDaemon();
  t.after(() => daemon.server.close());
  const dir = await mkdtemp(path.join(tmpdir(), "workrtai-daemon-"));
  const discovery = path.join(dir, "daemon.json");
  await writeFile(discovery, JSON.stringify({ port: daemon.port, token: "test-token" }));
  const adapter = new CliManagerDaemonAdapter({ discoveryPath: discovery, expectedProtocolVersion: 2 });
  t.after(() => adapter.disconnect());
  await assert.rejects(adapter.connect(), DaemonProtocolMismatchError);
});

test("rejects invalid session ids and non-string writes", async () => {
  const adapter = new CliManagerDaemonAdapter();
  await assert.rejects(adapter.create({ sessionId: "contains spaces" }), /invalid_daemon_session_id/);
  await assert.rejects(adapter.write("valid-id", 42), /daemon_write_data_must_be_string/);
});
