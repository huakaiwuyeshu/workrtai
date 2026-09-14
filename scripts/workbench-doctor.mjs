import { existsSync } from "node:fs";
import path from "node:path";
const root = process.env.WORKBENCH_REPO_ROOT || process.cwd();
const data = process.env.CLI_MANAGER_WORKBENCH_DATA_DIR || path.join(root, ".workbench");
const tooling = path.join(root, ".tooling");
const rustupHome = process.env.RUSTUP_HOME || path.join(tooling, "rustup");
const cargoHome = process.env.CARGO_HOME || path.join(tooling, "cargo");
const playwrightHome = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(tooling, "playwright");
const checks = [
  ["node", Number(process.versions.node.split(".")[0]) >= 20, process.versions.node],
  ["repo", existsSync(path.join(root, "orchestrator", "bin", "workbench-mcp.mjs")), root],
  ["data-root", true, data],
  ["tooling-root", existsSync(tooling), tooling],
  ["rustup-home", existsSync(rustupHome), rustupHome],
  ["cargo-home", existsSync(cargoHome), cargoHome],
  ["playwright-browsers", existsSync(playwrightHome), playwrightHome],
  ["daemon-discovery", process.env.WORKBENCH_DAEMON_DISCOVERY ? existsSync(process.env.WORKBENCH_DAEMON_DISCOVERY) : true, process.env.WORKBENCH_DAEMON_DISCOVERY || "optional"],
];
for (const [name, ok, value] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${value}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
