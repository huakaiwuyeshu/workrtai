#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const version = process.argv[2];
if (!version) {
  console.error("Usage: node extract-changelog.js <version>");
  process.exit(1);
}

const changelogPath = path.join(__dirname, "../../CHANGELOG.md");
const content = fs.readFileSync(changelogPath, "utf-8");

const versionPattern = new RegExp(
  `## \\[V?${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\][^]*?(?=\\n## \\[|$)`,
  "i"
);

const match = content.match(versionPattern);
if (!match) {
  console.error(`Version ${version} not found in CHANGELOG.md`);
  process.exit(1);
}

// 移除版本标题行(## [...] - date)，只保留内容
const versionContent = match[0]
  .replace(/^## \[.*?\].*?(\r?\n)+/, "")
  .trim();

console.log(versionContent);
