# workrtai 开发计划

本计划以 `workrtai` 为唯一开发仓库，目标是交付独立运行的 Agent Workbench。原有 CLI-Manager 安装、进程、daemon 和数据目录不参与运行。

## 已完成基线

- 基于 CLI-Manager `1.3.10` 建立独立源码基线。
- 应用标识改为 `com.cli-manager.workbench`。
- 数据根改为 `%USERPROFILE%\\.cli-manager-workbench`，daemon discovery/bootstrap 与通知标识同步隔离。
- 保留 `upstream=https://github.com/dark-hxx/CLI-Manager.git`，后续只在 `workrtai` 修改和提交。

## 开发阶段

| 阶段 | 交付物 | 依赖 | 验收标准 |
| --- | --- | --- | --- |
| P0 | 独立发行版基线 | 无 | 新旧应用可并行运行；数据、daemon、窗口标识无交叉 |
| P1 | CLI-Manager daemon adapter | P0 | 完成 auth/list/status/create/write/attach/output/exit/close；协议不兼容进入 blocked；可重连回放 |
| P2 | Workbench Bridge + Task Registry | P1 | SQLite 事件账本、任务状态机、幂等写入、checkpoint、artifact 索引 |
| P3 | 人工接力模式 | P2 | `handoff` 可重新指定模型，review artifact 后通过 `ask_agent` 追问；支持 C/D 接力 |
| P4 | 主 Agent / 子 Agent 模式 | P2、P1 | child task 绑定 pane、完成/阻塞/失败回调和幂等通知 |
| P5 | Pattern Runtime | P2 | 步骤依赖 DAG、Agent/轮次上限、approval、checkpoint、可恢复运行 |
| P6 | CLI-Manager Workspan 集成 | P1、P2 | Tauri pane registry 支持 create/list/focus/remove，子 Session 可挂入 pane tree |
| P7 | WorkbenchPanel | P5、P6 | 主窗口面板展示 pane/Agent 状态，支持刷新、focus/restore 入口 |
| P8 | GUI 执行器 | P4、P7 | BrowserExecutor 支持 Playwright 工厂，截图/日志/验证 artifact 自动回写 Registry |
| P9 | 稳定性与发布 | P1-P8 | Registry WAL、幂等事件、重启 checkpoint、独立标识与发布文档 |

## 当前迭代：P1 daemon adapter（第一批已完成）

本迭代只增加独立 sidecar 适配器和 fake-daemon 协议测试，不启动真实 daemon，不改变既有 CLI-Manager。实现范围：

1. 读取 Workbench 专属 discovery 文件。
2. 回环 TCP 连接，首帧 auth。
3. 白名单请求和主动事件解析。
4. 协议版本/features 校验。
5. 断线、超时、错误和重连后的输出回放接口。

第一批已完成：adapter 已覆盖完整白名单生命周期、主动 `output/exit/hook_report` 事件、协议版本阻断、Session ID/写入参数校验和显式 reconnect；fake-daemon 测试共 3 项通过。第二批已完成：独立 daemon fixture 进程完成真实 TCP/NDJSON 生命周期集成测试，仍不连接现有 CLI-Manager daemon。

P2 已开始：`TaskRegistry` 已实现 SQLite 初始化、任务父子图、状态转移、幂等 `postResult`、artifact、task_agents 和 checkpoint；`WorkbenchBridge` 已实现任务创建、daemon 派发、Agent 绑定、权限校验、质量门和一次性回调通知；本地 stdio Workbench MCP 已暴露任务生命周期工具。P5 的 Pattern Runtime 基础已开始，支持 approval、create、dispatch、wait、evaluate、synthesize 步骤及 Agent/轮次上限。Concord notifier 已加入 presence 检查、固定幂等键和不可达不改派规则；Bridge 还提供显式 review_task/child_task、超时阻塞和质量门入口。

完成 P1 后再进入 P2；在 P1 验收前，Bridge 不得创建真实 child Session。

## 交付纪律

- 每个阶段独立提交，提交信息包含阶段编号。
- 代码变更同步更新 `CHANGELOG.md` 和 `docs/功能清单.md`。
- 先运行定向测试，再运行 `npm run check:architecture`；Rust 环境可用后补 `cargo check` / `cargo test`。
- 所有任务、事件和 artifact 均可从本地文件或 SQLite 恢复；Concord 只负责 live 通信，不承载编排真相。


P8 已开始：BrowserExecutor 已支持 Playwright 风格的 goto/click/fill/press、验证、截图和日志 artifact；真实浏览器通过注入 browserFactory，缺少浏览器依赖时不伪造完成。

当前实现还提供 WorkbenchPanel（主窗口右下角）和 Workspan pane Tauri commands。Rust `cargo check/test` 与真实 Playwright/Concord 验收需在对应工具安装后执行。
