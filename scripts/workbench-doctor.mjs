import { existsSync } from "node:fs";
import path from "node:path";
const root = process.env.WORKBENCH_REPO_ROOT || process.cwd();
const data = process.env.CLI_MANAGER_WORKBENCH_DATA_DIR || path.join(root, ".workbench");
const checks = [
  ["node", Number(process.versions.node.split(".")[0]) >= 20, process.versions.node],
  ["repo", existsSync(path.join(root, "orchestrator", "bin", "workbench-mcp.mjs")), root],
  ["data-root", true, data],
  ["daemon-discovery", process.env.WORKBENCH_DAEMON_DISCOVERY ? existsSync(process.env.WORKBENCH_DAEMON_DISCOVERY) : true, process.env.WORKBENCH_DAEMON_DISCOVERY || "optional"],
];
for (const [name, ok, value] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${value}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
