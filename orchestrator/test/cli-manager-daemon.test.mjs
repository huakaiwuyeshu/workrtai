import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliManagerDaemonAdapter, DaemonProtocolMismatchError } from "../src/adapters/cli-manager-daemon.mjs";

async function fakeDaemon() {
  const server = createServer((socket) => {
    let first = true;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const frame = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (first) {
          first = false;
          socket.write(JSON.stringify({ type: "auth_ok", protocol_version: 1, features: ["attach"], daemon_version: "test", pid: 1 }) + "\n");
        } else {
          socket.write(JSON.stringify({ type: frame.type === "list" ? "sessions" : "ok", id: frame.id }) + "\n");
          if (frame.type === "attach") socket.write(JSON.stringify({ type: "output", session_id: frame.session_id, data_base64: "dGVzdA==" }) + "\n");
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, port };
}

test("authenticates, sends allowlisted requests, and forwards events", async (t) => {
  const daemon = await fakeDaemon();
  t.after(() => daemon.server.close());
  const dir = await mkdtemp(path.join(tmpdir(), "workrtai-daemon-"));
  const discovery = path.join(dir, "daemon.json");
  await writeFile(discovery, JSON.stringify({ port: daemon.port, token: "test-token" }));
  const events = [];
  const adapter = new CliManagerDaemonAdapter({ discoveryPath: discovery, expectedProtocolVersion: 1, onEvent: (event) => events.push(event) });
  assert.deepEqual((await adapter.connect()).features, ["attach"]);
  assert.equal((await adapter.list()).type, "sessions");
  await adapter.create({ sessionId: "child-1" });
  await adapter.attach("child-1", 0);
  assert.equal(events[0].type, "output");
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
