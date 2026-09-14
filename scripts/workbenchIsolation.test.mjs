import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
const appPaths = read("src-tauri/src/infrastructure/storage/app_paths.rs");
const notifications = read("src-tauri/src/features/notifications/system.rs");
const devScript = read("scripts/tauri-cli.mjs");

assert.equal(tauri.identifier, "com.cli-manager.workbench");
assert.equal(tauri.productName, "CLI-Manager Workbench");
assert.match(appPaths, /APP_HOME_DIR_NAME: &str = "\.cli-manager-workbench"/);
assert.match(appPaths, /PORTABLE_DATA_DIR_NAME: &str = "data-workbench"/);
assert.match(appPaths, /WINDOWS_APP_IDENTIFIER: &str = "com\.cli-manager\.workbench"/);
assert.doesNotMatch(appPaths, /APP_HOME_DIR_NAME: &str = "\.cli-manager";/);
assert.doesNotMatch(appPaths, /WINDOWS_APP_IDENTIFIER: &str = "com\.cli-manager\.app"/);
assert.match(notifications, /com\.cli-manager\.workbench/);
assert.doesNotMatch(notifications, /com\.cli-manager\.app/);
assert.match(devScript, /com\.cli-manager\.workbench/);

console.log("Workbench isolation checks passed");
