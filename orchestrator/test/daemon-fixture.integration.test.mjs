import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import { CliManagerDaemonAdapter } from "../src/adapters/cli-manager-daemon.mjs";

test("connects to an isolated daemon fixture and completes the real lifecycle", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workrtai-fixture-"));
  const discovery = path.join(root, "daemon.json");
  const child = spawn(process.execPath, [path.join(process.cwd(), "orchestrator/test/fixtures/daemon-fixture.mjs"), "--discovery", discovery, "--token", "fixture-token"], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await once(child.stdout, "data");
  const events = [];
  const adapter = new CliManagerDaemonAdapter({ discoveryPath: discovery, expectedProtocolVersion: 1, onEvent: (event) => events.push(event) });
  t.after(() => adapter.disconnect());
  const handshake = await adapter.connect();
  assert.deepEqual(handshake.features, ["attach", "output", "exit", "hook_report"]);
  await adapter.create({ sessionId: "fixture-session", cwd: root, shell: "powershell" });
  await adapter.write("fixture-session", "echo fixture\n");
  await adapter.attach("fixture-session", 0);
  await adapter.close("fixture-session");
  for (let attempt = 0; attempt < 20 && events.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(events.map((event) => event.type), ["output", "exit"]);
  assert.equal(JSON.parse(await readFile(discovery, "utf8")).pid, child.pid);
});
