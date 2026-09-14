# PTY 守护进程手册（Issue #123 Phase 2）

> 版本：V1.2.7 开发分支 `wt/issue123` · 契约：`.trellis/spec/backend/pty-daemon-contracts.md` · Phase 1（托盘常驻）契约：`.trellis/spec/frontend/background-task-continuation-contracts.md`

## 1. 这是什么

CLI-Manager 的 PTY 宿主被抽成独立守护进程 `cli-manager-daemon`（orca 式 client-server 模型）：**UI 进程只是客户端，应用真退出后终端任务继续执行**，重开应用自动 attach 并回放画面。

任务存续现在有三层兜底，自动逐级降级：

| 层级 | 条件 | 体验 |
|---|---|---|
| ① daemon 续跑 | daemon 可用 | 真退出 app，任务不间断；重开 attach 回放，画面连续 |
| ② 托盘常驻 | daemon 不可用 | "转入后台"= 隐藏窗口，进程存活任务续跑（Phase 1） |
| ③ 快照 + resume | app 与 daemon 双双死亡（强杀/崩溃） | 重启后问询恢复，CLI 会话 resume 续对话上下文 |

## 2. 架构

```
┌─ CLI-Manager (Tauri app) ────────────┐      ┌─ cli-manager-daemon ────────────────┐
│ 前端(不变): pty-output-{id} 事件      │      │ Job Object (KILL_ON_JOB_CLOSE)      │
│ commands/terminal.rs ──┐             │      │  ├─ PtyManager + PTY 子进程树        │
│   daemon 可用→转发      ├─ DaemonClient◄════►│  ├─ SessionBuffer(整帧 ring buffer)  │
│   不可用→进程内 PtyManager(降级)      │ NDJSON│  ├─ 主端口: 鉴权/请求/推送            │
│ claude_hook.rs(app 本地 hook 保留)    │ loopback  ├─ hook 端口: 复用 HTTP 解析→广播/缓存│
└──────────────────────────────────────┘ TCP  │  └─ 空闲 watchdog(10min 自灭)        │
                                              └─────────────────────────────────────┘
        发现/鉴权: ~/.cli-manager/daemon.json（dev: daemon.dev.json，独占创建=单实例）
```

### 代码地图

| 位置 | 职责 |
|---|---|
| `src-tauri/src/daemon/protocol.rs` | NDJSON 帧定义/编解码；8 MiB 帧上限；未知 type 前向兼容 |
| `src-tauri/src/daemon/discovery.rs` | daemon.json 读写（独占创建）、pid 存活检测、环境隔离文件名 |
| `src-tauri/src/daemon/server.rs` | TCP 服务、鉴权、会话托管、ring buffer、hook 广播/缓存、自灭 |
| `src-tauri/src/daemon/client.rs` | app 侧：发现/拉起/握手、请求-应答关联、推送 re-emit、`DaemonBridge` |
| `src-tauri/src/daemon/mod.rs` | `setup_process_governance()`（Windows Job Object） |
| `src-tauri/src/bin/cli-manager-daemon.rs` | daemon 入口（cargo 自动发现的第二个二进制） |
| `src-tauri/src/pty/manager.rs` | `PtyEventSink` trait——PTY 与 Tauri 解耦点，两侧共用 |
| `src-tauri/src/pty/tauri_sink.rs` | 主进程 sink：转 Tauri 事件（进程内降级路径） |
| `src-tauri/src/claude_hook.rs` | `spawn_hook_listener()` 复用点：HTTP 解析两侧共享，出口不同 |
| `src/stores/terminalStore.ts` | `restoreSessions` attach-first 分支 |
| `src/App.tsx` | `enterBackgroundTaskMode`：daemon 可用→真退出（closePty=false） |

## 3. 协议参考（NDJSON，`127.0.0.1`，首帧必须 Auth）

**字段命名**：帧内字段 snake_case（`session_id`/`data_base64`）；元数据结构（SessionMeta 等）camelCase。缺必填字段/坏 JSON = 非法帧 → **断连**；未知 `type` → 回 `err` 帧但**保持连接**（前向兼容）；未知字段忽略。

客户端 → daemon：`auth{token,client_version}` `ping` `list` `create{session_id,cwd,env_vars,shell}` `write{session_id,data}` `resize{session_id,cols,rows}` `close{session_id}` `close_all` `attach{session_id}` `detach` `reconcile{active_session_ids}` `status` `shutdown`（仅无存活会话时接受）。除 auth 外均带 `id` 用于应答关联。

daemon → 客户端：应答 `auth_ok{daemon_version,pid}` `auth_err` `pong` `ok` `err{message}` `sessions[SessionMeta]` `statuses` `reconciled{summary}` `attached{replay_base64,meta}`；主动推送 `output{session_id,data_base64}` `exit{session_id,exit_code}` `hook_report{payload}`。

**输出完整性铁律**：输出在 PTY reader 线程经 `safe_emit_boundary` 按 UTF-8+ANSI 安全边界切帧；ring buffer 按**整帧**存储、超限**整帧**从头丢弃；转发层只透传，**任何一层都禁止再分片**——违者前端花屏。

## 4. 生命周期

**app 启动**（`lib.rs` setup 后台线程，不阻塞主链路）：读 daemon.json → pid 存活 → 连接握手：
- 成功 → `DaemonBridge.set()`，之后所有 PTY 命令转发；
- 版本不匹配：无存活会话 → `shutdown` 旧 daemon 后重拉；有 → 沿用旧 daemon 并 warn（不杀任务）；
- pid 已死/握手失败 → 删残留文件 → 拉起新 daemon（Windows `DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP|CREATE_NO_WINDOW`）→ 最多 20×250ms 重试连接；
- 全部失败 → **降级进程内 PTY，应用照常可用**（仅日志，无打扰）。

**app 退出**：
- “退出应用，任务在后台继续执行”（daemon 可用）→ 同步 + 快照落盘 + **跳过** `pty_close_all` + 退出——daemon 与任务续跑；
- “最小化到托盘” → 仅隐藏窗口，app/PTY/hook 全部留在当前进程继续运行；
- “终止任务，退出应用” → `pty_close_all` + 清空终端恢复快照——任务终止，但不删除 Claude/Codex 原始历史；
- daemon 不可用时，“退出应用，任务在后台继续执行”自动降级为“最小化到托盘”。

**app 重启恢复**（`restoreSessions`）：查 `pty_daemon_sessions` → 会话仍 alive → `pty_attach`（订阅+回放，**不重建 PTY、不 resume、不重跑 startupCmd**）；不在 daemon → 原有重建分流（CLI resume / shell 贴回）。

**daemon 自灭**：无客户端连接且无存活会话持续 10 分钟 → 删 daemon.json → exit(0)。有存活会话永不自灭。

## 5. 进程治理（防孤儿）

1. **Job Object 兜底**（Windows）：daemon 启动第一件事把自己挂进 `KILL_ON_JOB_CLOSE` 的 Job；此后 spawn 的全部 PTY 子进程自动进 Job——daemon 无论正常退出还是被任务管理器强杀，系统自动回收整棵子进程树。句柄故意不关闭，与进程同生共死。
2. **单实例**：daemon.json 独占创建（`create_new`）；已有存活实例时新 daemon 启动失败自退。
3. **残留清扫**：app 启动发现 pid 已死 → 删文件重拉；握手不上（僵尸）→ 同样删文件重拉。
4. **自灭 watchdog**：30s 检查一次，事件驱动之外零轮询、空闲不占 CPU。
5. **资源上限**：≤64 会话；单会话 buffer ≤2 MiB；总 buffer ≤128 MiB（超限从最旧 exited 会话整会话丢弃）；单帧 ≤8 MiB（防 DoS）；hook 缓存 ≤200 条。

## 6. 安全

仅监听 `127.0.0.1`；UUID token 存 daemon.json（用户主目录 ACL，不进日志）；首帧 token 错误立即断连；sessionId 白名单（字母数字+连字符，≤64 字符）；hook 端口沿用原 `Bearer token` HTTP 鉴权 + payload 白名单校验（与 app 侧同一份代码）。所有 invoke/帧参数按不可信输入处理。

## 7. hook 上报链路（app 重启不断裂）

原问题：hook 端口随 app 启动随机分配并烘焙进 PTY 子进程环境变量，daemon 化后 PTY 比 app 长寿，app 重启后上报打到死端口 → Tab 永久 running。

现在：daemon 模式下 `pty_create` 注入的 `CLI_MANAGER_NOTIFY_PORT` 指向 **daemon 的 hook 端口**（稳定），token 用 daemon token。daemon 收到上报 → 广播 `hook_report` 帧给全部客户端 → app re-emit `claude-hook-notification`；**无客户端时缓存最近 200 条，客户端连上补发**。收到 `PermissionRequest` 时 daemon 会启动或激活 CLI-Manager，并携带 sessionId；应用连接后 attach 并聚焦对应终端。完成事件不强制弹出应用。进程内降级模式仍用 app 自身 hook bridge。

## 8. 后台任务中心

- 入口位于终端右侧工具栏；启用后固定显示，不再因任务结束自动消失。无后台任务时按钮禁用，有任务时显示呼吸提示。
- 入口复用“设置 → 侧边栏 → 终端工具栏”的显隐和排序配置，不维护第二套配置。
- 状态优先使用 daemon `SessionMeta.taskStatus`：`running`=执行中，`attention`=待处理，`done`=已完成，`failed`=失败。`alive` 仅表示 PTY/shell 进程是否仍存活，不能等同于 CLI 任务是否仍在执行。
- daemon 收到 `UserPromptSubmit` / `Notification` / `PermissionRequest` / `Stop` / `StopFailure` hook 后更新任务状态；如果未收到 hook 但 PTY 退出，则用退出状态兜底标记为已完成或失败。
- 执行中/待处理任务支持“恢复”和“丢弃”；已完成/失败任务支持“恢复”和“删除”。
- 任务完成后仍保留在后台任务中心，只有用户手动恢复、删除或丢弃后才会消失。
- 恢复会 attach ring buffer 并聚焦对应终端，不重建 PTY、不重跑 startupCmd；丢弃/删除会移除 daemon 会话和终端恢复数据，不删除 CLI 原始历史。
- 启动时不再弹后台恢复提示，统一从任务中心或 Hook 定向唤起恢复。

## 9. 环境隔离

| | 安装版 | `tauri dev` |
|---|---|---|
| 发现文件 | `~/.cli-manager/daemon.json` | `~/.cli-manager/daemon.dev.json` |
| daemon 二进制 | 安装目录 | `target/debug/` |
| 判定方式 | 编译期 `cfg!(debug_assertions)`（app 与 daemon 一致） | 同左 |

两套实例互不发现、互不 attach，可并行运行。

## 10. 故障排查

| 症状 | 排查 |
|---|---|
| 重开后没走 attach，弹了 resume 恢复 | daemon 可能未就绪/已死：看 app 日志 `pty daemon connected` / `pty daemon unavailable`；daemon 启动竞态时 attach miss 会自动落到 resume，属预期降级 |
| Tab 状态一直 running | 确认 daemon 模式下 hook 环境变量端口=daemon.json 的 hookPort；hook running 超时回退仍兜底 |
| 怀疑 daemon 僵尸 | `tasklist /FI "IMAGENAME eq cli-manager-daemon.exe"`；杀掉后 app 下次启动会清残留文件重拉 |
| daemon 日志 | 当前为 stderr（detached 下不可见）；文件日志见"已知限制" |
| 手动停 daemon | 关所有会话后等 10 分钟自灭；或删 daemon.json 后 `taskkill /PID <pid>`（Job Object 保证子进程一并回收） |

## 11. 完整验证手册

### 10.1 验证目标

本节验证以下能力：

1. daemon 能被发现、拉起、鉴权并托管 PTY；
2. 应用真退出后任务继续运行，重开后 attach 回放且不重复执行命令；
3. daemon 不可用时安全降级到进程内 PTY/托盘常驻；
4. app、daemon、PTY 子进程的退出和异常回收符合预期，不产生孤儿进程；
5. hook、通知、快照、resume、设置项和多 Shell 行为不回归；
6. dev/安装版、多平台和安装包分发边界正确。

### 10.2 测试环境与准备

至少准备以下环境：

| 环境 | 必测 | 说明 |
|---|---|---|
| Windows 11 + `npm run tauri dev` | 是 | 主开发验收环境 |
| Windows 安装包（MSI 或 NSIS） | 是 | 验证随包 daemon、升级与安装目录 |
| PowerShell、CMD、Pwsh | 是 | Windows Shell 矩阵 |
| WSL | 有条件必测 | 已安装 WSL 时执行 |
| macOS Apple Silicon | 发布前必测 | GitHub Actions 当前目标 |
| Ubuntu 22.04 | 发布前必测 | `.deb` / AppImage 目标 |

测试前：

1. 提交或备份当前工作内容；测试“仍然退出”“强杀 daemon”会主动中断终端任务。
2. 使用无副作用的长任务，例如 PowerShell：

   ```powershell
   1..120 | ForEach-Object { "tick $_ $(Get-Date -Format HH:mm:ss)"; Start-Sleep 1 }
   ```

3. 测试 Claude/Codex 时使用不会修改重要文件的提示词，例如“每秒输出一次数字，共输出 30 次，不要修改文件”。
4. Windows 观察命令：

   ```powershell
   # 查看 app、daemon 及其父进程
   Get-CimInstance Win32_Process |
     Where-Object { $_.Name -in @('cli-manager.exe', 'cli-manager-daemon.exe') } |
     Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine

   # 查看开发版发现文件
   Get-Content "$HOME\.cli-manager\daemon.dev.json"

   # 查看安装版发现文件
   Get-Content "$HOME\.cli-manager\daemon.json"

   # 查看监听地址；端口应只绑定 127.0.0.1
   Get-NetTCPConnection -State Listen |
     Where-Object { $_.OwningProcess -in (Get-Process cli-manager-daemon -ErrorAction SilentlyContinue).Id }
   ```

5. macOS/Linux 观察命令：

   ```bash
   ps -ef | grep '[c]li-manager-daemon'
   cat ~/.cli-manager/daemon.json
   ss -lntp | grep cli-manager-daemon
   ```

6. 每条用例单独记录：环境、构建版本、开始时间、结果、日志和截图。失败时保留 `~/.cli-manager/logs/cli-manager-dev.log` 或安装版日志。

### 10.3 自动化检查

在仓库根目录执行：

```powershell
npx tsc --noEmit
Set-Location src-tauri
cargo check
cargo test
cargo build --bin cli-manager-daemon
```

预期：全部退出码为 `0`。当前已验证 `cargo test` 共 348 项通过；协议编解码、未知字段、未知 type、发现文件、PID 检测、ring buffer 上限、sessionId 校验和 hook 任务状态映射已有单测覆盖。

### 10.4 核心功能用例

#### TC-F-001：首次启动自动拉起 daemon

- **优先级**：P0
- **前置条件**：关闭当前环境的 CLI-Manager；确认对应 `daemon*.json` 不存在，且没有该环境的 daemon 进程。
- **步骤**：
  1. 启动 CLI-Manager。
  2. 等待主界面可操作。
  3. 查看进程和对应发现文件。
  4. 查看应用日志。
- **预期结果**：
  - 主界面正常显示，不因 daemon 启动阻塞或黑屏；
  - 仅有一个当前环境的 `cli-manager-daemon`；
  - 发现文件包含非零 `port`、`hookPort`、非空 `token`、有效 `pid` 和当前版本；
  - 日志出现 `pty daemon connected`；
  - 两个监听端口都只绑定 `127.0.0.1`。

#### TC-F-002：daemon 托管普通终端输入输出

- **优先级**：P0
- **步骤**：
  1. 新建 PowerShell 终端。
  2. 执行 `Write-Output "daemon-smoke"`。
  3. 调整窗口大小数次。
  4. 执行测试长任务，观察至少 10 行输出。
- **预期结果**：
  - 输入、输出、换行、颜色和 resize 正常；
  - 输出无乱码、ANSI 残片或花屏；
  - daemon 进程存活，主 app 内不额外创建同一会话的重复 Shell。

#### TC-F-003：真退出后任务继续，重开自动 attach

- **优先级**：P0
- **前置条件**：设置“关闭按钮行为”为“直接退出”；“退出时有任务运行中”为“询问”。
- **步骤**：
  1. 新建终端，执行 120 秒长任务，记下关闭前最后一个 tick。
  2. 点击窗口关闭按钮。
  3. 在运行中任务弹窗选择“转入后台继续执行”。
  4. 确认 `cli-manager.exe` 已退出、daemon 仍存活。
  5. 等待 10 秒后重新启动 CLI-Manager。
  6. 在恢复提示中选择恢复（若实现直接恢复，则观察自动恢复结果）。
  7. 查看原 Tab 并继续输入命令。
- **预期结果**：
  - app 真退出，不只是隐藏到托盘；
  - daemon 和长任务持续运行，tick 在 app 退出期间继续增长；
  - 重开后沿用原 sessionId，Tab 数量、顺序、标题、项目、Workspan 和选中项正确；
  - 回放包含退出期间的输出；不执行 resume、不重跑 startupCmd、不产生重复任务；
  - 可继续输入，画面无清屏重绘和 ANSI 花屏。

#### TC-F-004：多会话、多 Workspan 同时 attach

- **优先级**：P1
- **步骤**：
  1. 创建 3 个终端，分别执行不同长任务。
  2. 将其组织为多个 Workspan/分屏，切换活动 Tab。
  3. 选择“转入后台继续执行”真退出。
  4. 等待后重开并恢复。
- **预期结果**：
  - 三个任务均持续运行；
  - 会话与布局不串位、不丢失、不重复；
  - 每个会话只收到自己的输出；
  - 活动 Workspan、活动 Pane 和活动 Tab 与退出前一致。

#### TC-F-005：Claude/Codex hook 在后台期间完成并补发

- **优先级**：P0
- **步骤**：
  1. 分别创建 Claude 和 Codex 测试会话，启动可在 20～60 秒完成的任务。
  2. 任务运行中选择“转入后台继续执行”。
  3. 等待任务在 app 退出期间完成。
  4. 重开应用并恢复会话。
- **预期结果**：
  - hook 上报仍发送到 daemon 的 `hookPort`；
  - 重开后补发完成/失败通知，且只补发一次；
  - Tab 状态由 running 正确变为 done/failed；
  - hook 事件绑定原 Tab，不串到其他会话。

#### TC-F-006：后台期间 PermissionRequest/attention

- **优先级**：P1
- **步骤**：
  1. 启动会触发权限确认的 Codex/Claude 操作。
  2. 在触发确认前选择“退出应用，任务在后台继续执行”。
  3. 等待权限请求发生。
- **预期结果**：
  - daemon 自动启动或激活 CLI-Manager；
  - 应用 attach 并聚焦对应 Tab；
  - 用户可继续完成确认，PTY 未被重新创建。

#### TC-F-007：“丢弃会话并退出”终止并清理任务

- **优先级**：P0
- **步骤**：
  1. 启动 Claude/Codex 长任务。
  2. 关闭窗口，在弹窗选择“丢弃会话并退出”。
  3. 确认 app 退出。
  4. 重开应用。
- **预期结果**：
  - `pty_close_all` 被执行，daemon 中没有存活旧会话；
  - 被打断的生成不在后台继续；
  - 终端标签、快照和 daemon 缓存被移除，不再出现恢复提示；
  - Claude/Codex 原始历史转录不被删除。

#### TC-F-008：无运行任务时退出不增加交互

- **优先级**：P0
- **步骤**：关闭或结束全部终端任务，然后分别使用窗口关闭按钮和托盘“退出”。
- **预期结果**：不出现“有任务运行中”弹窗；退出行为与改动前一致。

#### TC-F-009：退出策略与“记住选择”

- **优先级**：P1
- **步骤**：
  1. 将“退出时有任务运行中”依次设置为“询问”“后台继续”“丢弃会话并退出”。
  2. 每档都启动长任务后关闭窗口。
  3. 在“询问”档勾选“记住选择”，分别记住后台和丢弃。
- **预期结果**：
  - “询问”显示弹窗；
  - “后台继续”直接走 daemon 真退出；
  - “丢弃会话并退出”执行 close_all 并清理恢复数据；
  - “记住选择”正确持久化，重启后仍生效；

#### TC-F-010：后台任务中心显示与操作

- **优先级**：P0
- **步骤**：
  1. 启动两个长任务，选择后台继续并退出应用。
  2. 重开应用但暂不恢复这些任务。
  3. 从右侧工具栏打开“后台任务”。
  4. 恢复其中一个任务，丢弃另一个任务。
- **预期结果**：
  - 按钮始终可见；有后台任务时显示计数，无后台任务时显示空态与 `0` 计数；
  - 状态只显示“执行中”或“已完成”；
  - 恢复后任务从列表消失并聚焦对应终端；
  - 丢弃后任务终止且恢复数据删除；
  - “设置 → 侧边栏 → 终端工具栏”可控制该入口显隐，排序不出现重复项。

#### TC-F-011：启动时不再弹后台恢复提示

- **优先级**：P1
- **步骤**：保留可恢复后台任务并启动应用，在 React StrictMode、项目加载和窗口切换过程中观察界面。
- **预期结果**：启动阶段不再弹出恢复提示；后台任务仅通过右侧任务中心或 Hook 定向唤起恢复。
  - zh-CN/en-US 下文案均完整且无硬编码混用。

### 10.5 降级与恢复用例

#### TC-D-001：强制禁用 daemon，降级进程内 PTY

- **优先级**：P0
- **前置条件**：关闭应用。
- **步骤**：

  ```powershell
  $env:CLI_MANAGER_DISABLE_DAEMON='1'
  npm run tauri dev
  ```

  启动后创建终端、执行命令，再测试“转入后台”。测试结束执行 `Remove-Item Env:CLI_MANAGER_DISABLE_DAEMON`。
- **预期结果**：
  - 日志出现 `pty daemon disabled`；
  - 终端功能正常，PTY 由 app 进程托管；
  - “转入后台”退化为隐藏到托盘，app 进程不退出；
  - 从托盘唤回后画面连续。

#### TC-D-002：发现文件 PID 已失效时自动清扫

- **优先级**：P1
- **前置条件**：备份当前发现文件；确保没有重要后台任务。
- **步骤**：
  1. 关闭 app 和 daemon。
  2. 保留或构造一个 PID 已失效的 `daemon.dev.json`/`daemon.json`。
  3. 启动 app。
- **预期结果**：
  - 日志出现 stale daemon info 清理信息；
  - 旧文件被替换，新 PID/端口有效；
  - 主界面和终端功能正常，无错误弹窗。

#### TC-D-003：daemon 不可执行/拉起失败

- **优先级**：P1
- **前置条件**：仅在临时构建目录操作，禁止破坏正式安装。
- **步骤**：临时重命名 daemon 二进制后启动 app，创建终端并执行命令；测试结束恢复文件名。
- **预期结果**：
  - 日志出现 `pty daemon unavailable, falling back in-process`；
  - app 不崩溃、不黑屏，终端可正常使用；
  - 后台策略退化为托盘常驻。

#### TC-D-004：拒绝恢复时清理 daemon 会话

- **优先级**：P0
- **步骤**：
  1. 按 TC-F-003 让任务在 daemon 中继续运行。
  2. 重开应用，在恢复提示选择“不恢复”。
  3. 查看 daemon 会话与 Shell 子进程。
- **预期结果**：
  - 本批 daemon 会话被关闭，不再后台消耗资源；
  - 工作区快照被清理；
  - SQLite 历史会话不受影响；
  - 下次启动不再询问同一批会话。

#### TC-D-005：app 被强杀，daemon 和任务继续

- **优先级**：P0
- **步骤**：
  1. 启动长任务。
  2. 在任务管理器中只结束 `cli-manager.exe`，不要结束 daemon。
  3. 等待 10 秒后重开应用。
- **预期结果**：daemon 和 Shell 不中断；重开可 attach 并看到强杀期间的输出。

### 10.6 进程治理与资源用例

#### TC-P-001：强杀 daemon 不留下 PTY 孤儿

- **优先级**：P0（Windows 必测）
- **步骤**：
  1. 创建 PowerShell/CMD 长任务，记录 daemon PID 和对应 Shell PID。
  2. 在任务管理器中结束 `cli-manager-daemon.exe`。
  3. 观察 Shell、conhost 和子进程树。
- **预期结果**：
  - Job Object 自动回收 daemon 托管的整个 PTY 子进程树；
  - 原 Shell PID 不再存在；
  - 不出现持续占 CPU/内存的孤儿；
  - app 不应崩溃。当前已知限制：已打开 Tab 可能不会立即自动标记为 error，但后续输入应明确失败。

#### TC-P-002：daemon 单实例

- **优先级**：P1
- **步骤**：app 运行时手工再次启动同环境 `cli-manager-daemon` 二进制。
- **预期结果**：第二个 daemon 因发现文件独占创建失败而立即退出；原 daemon 和会话不受影响。

#### TC-P-003：有存活会话时 daemon 不自灭

- **优先级**：P0
- **步骤**：启动长任务并让 app 真退出，等待超过 10 分钟。
- **预期结果**：daemon 和任务仍存活；发现文件仍存在。

#### TC-P-004：无客户端、无存活会话时自动自灭

- **优先级**：P1
- **步骤**：关闭全部终端 Tab，退出 app，记录 daemon PID；等待 10 分钟以上。
- **预期结果**：daemon 自动退出，发现文件删除，无 Shell/conhost 残留，空闲期间 CPU 接近 0。

#### TC-P-005：大输出回放与 2 MiB 上限

- **优先级**：P1
- **步骤**：
  1. 执行会产生超过 2 MiB 输出的命令，期间让 app 真退出。
  2. 输出完成前后重开并 attach。
  3. 检查回放头尾和终端渲染。
- **预期结果**：
  - 只保留尾部约 2 MiB，旧输出按完整安全帧丢弃；
  - 最新输出存在；
  - 中文、Emoji、ANSI 颜色和光标控制序列不被截断，不花屏；
  - daemon 内存不随单会话输出无限增长。

#### TC-P-006：64 会话资源上限

- **优先级**：P2（专项测试）
- **步骤**：使用测试脚本逐步创建会话至上限，再尝试创建第 65 个存活会话。
- **预期结果**：前 64 个受控运行；第 65 个被明确拒绝并返回 `session limit reached`；daemon 不崩溃。

### 10.7 Shell 与平台兼容用例

#### TC-C-001：Windows Shell 矩阵

- **优先级**：P0
- **步骤**：分别使用 PowerShell、CMD、Pwsh 创建会话，执行 `echo`、中文输出、长任务、resize、后台退出和 attach。
- **预期结果**：三种 Shell 的 cwd、环境变量、输入输出、退出码和 attach 行为与 daemon 改造前一致。

#### TC-C-002：WSL 会话

- **优先级**：P0（具备 WSL 时）
- **步骤**：创建 WSL 会话，执行 `pwd`、`echo $TERM`、中文输出和长任务；真退出后重开 attach。
- **预期结果**：cwd 映射正确；hook 环境变量经 WSLENV 进入 Linux；输出与 attach 正常；无额外 `wsl.exe` 孤儿。

#### TC-C-003：macOS/Linux 后台续跑与 SIGHUP 回收

- **优先级**：P0（发布前）
- **步骤**：在目标平台执行 TC-F-003；随后创建长任务并强杀 daemon。
- **预期结果**：app 退出不影响 daemon 进程组；强杀 daemon 后 PTY master 关闭，Shell 收 SIGHUP 退出，无孤儿任务。

### 10.8 环境隔离、升级与打包用例

#### TC-E-001：dev 与安装版隔离

- **优先级**：P0
- **步骤**：
  1. 分别启动安装版和 `npm run tauri dev`。
  2. 两边各创建名称和输出明显不同的长任务。
  3. 分别检查发现文件和 PID。
  4. 分别退出、重开和恢复。
- **预期结果**：
  - dev 使用 `daemon.dev.json`，安装版使用 `daemon.json`；
  - daemon PID、端口、token 和会话互不相同；
  - 两边不互相 attach、close_all、清理或覆盖快照；
  - 两个窗口均正常渲染，不出现共享 WebView/单实例导致的黑屏或错误唤醒。

#### TC-E-002：安装包包含 daemon

- **优先级**：P0
- **步骤**：构建并安装 MSI/NSIS；检查安装目录；启动后执行 TC-F-001。
- **预期结果**：`cli-manager-daemon.exe` 与主程序同目录；用户无需额外下载；安装版能成功拉起 daemon。

#### TC-E-003：Linux `.deb`/AppImage 与 AUR 布局

- **优先级**：P1
- **步骤**：解包或安装发布产物，定位主程序与 daemon；AUR 包检查 `/usr/lib/CLI-Manager/` 和 wrapper。
- **预期结果**：客户端能通过同目录或 PATH 找到 daemon；文件具有执行权限；启动和 attach 正常。

#### TC-E-004：有后台会话时升级版本

- **优先级**：P1
- **步骤**：旧版本启动长任务并真退出 app；安装新版本并启动。
- **预期结果**：
  - 旧 daemon 有存活会话时不会被静默强杀；
  - 新 app 按兼容协议沿用旧 daemon，并记录版本不匹配 warn；
  - 会话清空后再次启动会切换到新 daemon；
  - 任务和用户数据不丢失。

### 10.9 安全与协议专项

以下项目主要由自动化测试覆盖，发布前至少执行一次端到端冒烟：

| 用例 | 操作 | 预期 |
|---|---|---|
| TC-S-001 错误 token | 使用错误 token 发送首帧 | 返回 `auth_err` 并立即断连 |
| TC-S-002 非法 JSON/缺字段 | 发送坏 JSON 或缺必填字段 | 断连，不影响 daemon |
| TC-S-003 未知 type | 发送合法但未知 type | 返回 `err`，连接保持可用 |
| TC-S-004 非法 sessionId | 使用空值、路径穿越或超长 ID | 请求被拒，PTY 不创建 |
| TC-S-005 超长帧 | 发送超过 8 MiB 的单帧 | 客户端被断开，daemon 不崩溃 |
| TC-S-006 本地监听 | 检查主端口与 hookPort | 仅监听 `127.0.0.1`，不监听 `0.0.0.0`/局域网地址 |

### 10.10 回归清单

完成上述用例后，还必须回归：

- 普通新建/关闭/重命名/分屏/resize/切换终端；
- 项目终端、Worktree 终端、外部历史视图和伪会话；
- `workspace-session-restore-contracts.md` 全部恢复场景；
- 无可恢复会话时不弹恢复框；拒绝恢复后不重复询问；
- 会话恢复开关关闭时不读取/恢复快照；
- 快照 10 秒节流和正常退出前最终 flush；
- 系统通知开关、聚焦抑制、后台强制通知；
- zh-CN/en-US 文案、通知和 aria 标签；
- 更新检查失败不阻塞首屏；
- Windows ConPTY 兼容开关开启/关闭两种路径。

### 10.11 验收通过标准

满足以下条件才可标记 Phase 2 完成：

1. 所有 P0 用例通过；
2. P1 用例无阻塞发布的问题，未通过项必须有明确 issue 和降级策略；
3. 自动化命令全部通过；
4. Windows dev + Windows 安装包完成全量核心验收；
5. macOS/Linux 发布构建至少完成 TC-F-001、TC-F-003、TC-C-003、TC-E-002/003；
6. 无任务丢失、重复执行、跨环境串会话、孤儿进程或持续后台高占用；
7. 失败路径能降级，不导致应用黑屏、崩溃或无法创建终端。

### 10.12 验收记录模板

```markdown
| 用例 ID | 环境/版本 | 结果 | 证据 | 备注/Issue |
|---|---|---|---|---|
| TC-F-001 | Windows 11 / tauri dev / V1.2.7 | PASS/FAIL | 日志、截图 | |
| TC-F-003 | Windows 11 / MSI / V1.2.7 | PASS/FAIL | 退出前后 PID、终端截图 | |
```

## 12. 已知限制与后续工作

- **daemon 文件日志未接**：仅 stderr（detached 不可见）。计划：LogDir/`cli-manager-daemon.log` + 轮转。
- **attach 与 xterm 挂载间隙**：回放快照与事件订阅之间的极短窗口内新输出会先于 xterm 挂载到达（毫秒级，正常使用无感）。
- **exited 会话 5 分钟宽限自灭**：契约细则未实现，当前 exited 会话（仅剩 buffer）即视同无会话参与 10 分钟计时。
- **daemon 崩溃时前端不自动标记会话失效**：客户端断连后命令层降级并报错，但已打开的标签不会主动置为 error 态（待办）。
- **多窗口/多 app 实例并发 attach**：协议天然支持多客户端，但前端未针对双实例同 attach 一个会话做去重，暂不建议。

## 13. 打包与分发

**用户无需单独下载 daemon，任何打包命令也无需修改。** Tauri v2 会自动把同一 crate 的所有 cargo bin 目标打进安装包并放在主程序旁（Windows 安装目录 / macOS `Contents/MacOS` / deb·AppImage `usr/bin`），`src/bin/cli-manager-daemon.rs` 作为第二个 bin 自动被 `tauri build` 收录、连版本资源都会被统一 patch——**不要**再配置 `bundle.externalBin`，那会导致同一文件被两个组件安装（MSI ICE30 错误，已实测踩坑）。

- `npm run tauri build`（本地）与 GitHub Actions `release.yml`（tauri-action）**均保持原样**。
- 已验证：`tauri build --debug` 产出的 MSI/NSIS 包含 `cli-manager-daemon.exe` 与主程序同目录。
- **AUR 例外**：`packaging/aur/cli-manager-bin/PKGBUILD.template` 会把主程序从 `/usr/bin` 挪到 `/usr/lib/CLI-Manager/` 并用 wrapper 替换——已同步添加 daemon 的 mv（否则主程序找不到同目录 daemon）。客户端另有 PATH 查找兜底。
- 更新器（tauri-plugin-updater）走完整安装包替换，daemon 随包更新；升级期间旧 daemon 若仍有会话，按版本握手规则沿用直到会话清空。

### 多平台行为差异

| | Windows | macOS / Linux |
|---|---|---|
| 孤儿兜底 | Job Object `KILL_ON_JOB_CLOSE`（强杀 daemon 连带回收子进程树） | daemon 死亡 → PTY master fd 关闭 → 子进程收 SIGHUP 自然退出 |
| daemon 拉起 | `DETACHED_PROCESS\|CREATE_NEW_PROCESS_GROUP\|CREATE_NO_WINDOW` | `process_group(0)`（app 的组信号不波及 daemon） |
| ConPTY 兼容 | daemon 继承 app 已注入 sideload conpty 的 PATH（app 先 `conpty_sideload::initialize` 再拉 daemon） | 不适用 |
| 逃生舱 | 环境变量 `CLI_MANAGER_DISABLE_DAEMON=1` 启动 app → 强制进程内 PTY | 同左 |
