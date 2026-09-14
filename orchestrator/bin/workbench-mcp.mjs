#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TaskRegistry } from "../src/registry/task-registry.mjs";
import { WorkbenchBridge } from "../src/bridge/workbench-bridge.mjs";
import { WorkbenchMcpServer } from "../src/mcp/workbench-server.mjs";
import { CliManagerDaemonAdapter } from "../src/adapters/cli-manager-daemon.mjs";

const repoRoot = process.env.WORKBENCH_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = process.env.CLI_MANAGER_WORKBENCH_DATA_DIR || path.join(repoRoot, ".workbench");
const registry = new TaskRegistry(path.join(dataRoot, "workbench.sqlite"));
const daemon = new CliManagerDaemonAdapter({
  discoveryPath: process.env.WORKBENCH_DAEMON_DISCOVERY,
  expectedProtocolVersion: process.env.WORKBENCH_DAEMON_PROTOCOL ? Number(process.env.WORKBENCH_DAEMON_PROTOCOL) : undefined,
});
let daemonReady = false;
try { await daemon.connect(); daemonReady = true; } catch (error) { process.stderr.write(`[workrtai] daemon unavailable: ${error.message}\n`); }
const bridge = new WorkbenchBridge({ registry, daemon: daemonReady ? daemon : undefined, snapshotPath: path.join(dataRoot, "tasks.snapshot.json") });
const server = new WorkbenchMcpServer(bridge);
const shutdown = () => { daemon.disconnect(); registry.close(); process.exit(0); };
process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
process.once("exit", () => { try { daemon.disconnect(); registry.close(); } catch {} });
await server.serve(process.stdin, process.stdout);
