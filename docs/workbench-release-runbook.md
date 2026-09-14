# Workbench 发布与恢复手册

## 独立运行

Workbench 使用 `com.cli-manager.workbench`、`%USERPROFILE%\\.cli-manager-workbench` 和 `data-workbench`。发布前运行 `npm run test:workbench-isolation`，确认旧 CLI-Manager 的进程、discovery 和数据目录未被读取。

## 验收顺序

1. `npm run test:daemon-adapter`、`npm run test:daemon-fixture` 验证 NDJSON daemon 生命周期。
2. `npm run test:task-registry`、`npm run test:workbench-bridge`、`npm run test:workbench-mcp` 验证任务账本、handoff、回调和 MCP。
3. `npm run test:pattern-runtime`、`npm run test:browser-executor` 验证 DAG、轮次限制和浏览器 artifact。
4. 工具链可用时执行 `cargo check --manifest-path src-tauri/Cargo.toml` 和 `npm run build`。

## 重启恢复

Bridge 重启后调用 MCP `recover_tasks`：运行中的任务会与 daemon session 对账；仍存活的 session 标记为 recovered，失联任务列入 unavailable 并交由人工决定重试或阻塞。Task Registry 使用 SQLite WAL，事件、artifact、任务关系和 checkpoint 可从磁盘恢复。

## 回滚

停止 Workbench daemon 后，将安装目录回退到上一版本；不要删除 `%USERPROFILE%\\.cli-manager-workbench`，以便保留 checkpoint 和审计事件。原 CLI-Manager 的 `%USERPROFILE%\\.cli-manager` 数据无需迁移。
