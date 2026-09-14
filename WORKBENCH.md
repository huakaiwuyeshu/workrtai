# CLI-Manager Workbench

这是基于 CLI-Manager 的独立 Workbench 发行版。它与本机已有 CLI-Manager 使用不同的应用标识和数据根，可以同时运行。

## 隔离保证

- 应用标识：`com.cli-manager.workbench`
- 默认数据目录：`%USERPROFILE%\\.cli-manager-workbench`
- Windows bootstrap：`%LOCALAPPDATA%\\com.cli-manager.workbench\\data-root.json`
- 便携模式数据目录：程序目录下 `data-workbench`
- Workbench daemon discovery、sessions、projects、数据库和日志均位于上述 Workbench 数据根

不要把 Workbench 的数据目录手工改成 `%USERPROFILE%\\.cli-manager`，也不要复用已有 CLI-Manager 的 `daemon.json`。两套应用应各自启动自己的 daemon。

## 本地开发

一键启动：双击仓库根目录的 `启动 Workbench.cmd`。脚本会设置独立数据根、检查 Node/Cargo/MSVC、按需安装依赖、构建前端、启动 MCP 和 Tauri Workbench；退出桌面应用时会自动回收 MCP 进程。

```powershell
Set-Location $PSScriptRoot
npm install
npm run build
npm run tauri:build:local
```

开发模式：

```powershell
$env:CLI_MANAGER_DISTRIBUTION = "standalone"
npm run tauri dev
```

构建产物、配置和 daemon 均使用 Workbench 标识；不会修改已有 CLI-Manager 的配置文件。

## Workbench 集成边界

当前 fork 先完成运行隔离，后续按 `docs/implementation-plan.md` 实现：

1. `orchestrator` sidecar 和 daemon adapter；
2. Workbench SQLite、Task Registry、Pattern Runtime；
3. Tauri Workbench commands 和 Workspan pane 绑定；
4. WorkbenchPanel（任务 DAG、artifact、质量门和人工接管）。

PTY、daemon 帧语义和已有终端功能保持上游行为；Workbench 编排逻辑不写入终端传输层。

