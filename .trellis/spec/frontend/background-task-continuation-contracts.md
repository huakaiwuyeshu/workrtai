# Background Task Continuation Contracts

> Issue #123 增强：退出时若有任务运行中，允许转入 daemon 后台继续、最小化到托盘、终止任务退出或每次询问。与 `workspace-session-restore-contracts.md`（进程退出后的快照/resume 恢复）互补：**daemon 后台 = UI 退出后任务真续跑；托盘最小化 = 应用进程继续存活；快照恢复 = daemon/进程均不可恢复时的兜底**。

## Scenario: Continue Running Tasks After Window Close

### 1. Scope / Trigger

- Trigger: 改动 `App.tsx` 退出/关闭拦截（`onCloseRequested`、`runExitCleanup`、close dialog）、托盘菜单、任务运行判定、后台任务完成通知时。
- 跨层：`terminalStore.tabStatuses`(hook+shell 双源) → `App.tsx` 关闭拦截 → 窗口 hide（托盘常驻）→ hook 事件 `Stop/StopFailure` → 系统通知 → 托盘/通知点击 show window。

### 2. Signatures

- 运行任务判定：`terminalStore` 新增 selector `getRunningTaskSessionIds(): string[]` — 返回合并后 TabNotificationState 为 `running` 的**真实 PTY** 会话 id（伪会话 kind 排除）。
- 设置项：`settingsStore.exitWithRunningTasksBehavior: "ask" | "background" | "minimize" | "discard"`，默认 `"ask"`。
- 统一退出守卫：`requestExitGuardedByRunningTasks(source, prechecked?)`。所有真实退出入口必须经此函数消费设置；窗口关闭入口已取得任务快照时可传入 `{ runningIds, daemonSessionsChecked }` 避免重复查询。
- 退出确认弹窗：`RunningTasksExitDialog` 提供后台继续 / 最小化到托盘 / 终止任务并退出 / 取消，并支持“记住选择”。
- 转入后台入口：`enterBackgroundTaskMode(): Promise<void>`。daemon 可用时 UI 真退出且 PTY 留在 daemon；daemon 不可用时降级为窗口 hide。
- 最小化入口：`minimizeToTray(): Promise<void>` — `appWindow.hide()` + 标记内存后台模式。
- 后台完成通知：复用 `claude-hook-notification` 监听链路；后台模式下 `Stop`/`StopFailure`/`Notification(attention)` 事件必须走系统通知（`send_notification_via_windows` 已有命令），点击/托盘左键 → show + focus。

### 3. Contracts

- **★核心：所有真实退出入口统一消费设置。** `closeBehavior="exit"`、`CloseConfirmDialog` 确认退出、托盘“退出”，以及 `closeBehavior="ask"` 且已发现运行任务的窗口关闭请求，都必须复用 `requestExitGuardedByRunningTasks`；禁止入口自行复制一套只会弹窗的分流。
- `closeBehavior="ask"` 的兼容红线：无运行任务时仍打开普通 `CloseConfirmDialog`；有运行任务时才把已检测快照交给统一守卫。不得为统一入口而改变无任务关闭交互。
- 有运行任务时按 `exitWithRunningTasksBehavior` 分流：
  - `ask` → 打开 `RunningTasksExitDialog`。
  - `background` → daemon 可用时保留 PTY 并退出 UI；不可用时降级到托盘常驻。
  - `minimize` → hide 到托盘，应用与 PTY 均继续运行。
  - `discard` → 完整退出清理并清除工作区恢复快照，不删除 Claude/Codex 原始历史。
- 无运行任务时走现有完整退出清理；daemon 查询失败时不得把“未知”当作“无后台任务”，只清理可确认的前台 PTY。
- 托盘“退出”菜单（`tray-quit-requested`）同样必须经过统一守卫。
- `RunningTasksExitDialog` 勾选“记住选择”时，必须先 `await updateSetting("exitWithRunningTasksBehavior", choice)` 完成持久化，再执行 background/minimize/discard。写入失败应 `logWarn`，但不得阻止用户已选择的动作。
- 默认运行判定只信 `running`：`attention`/`done`/`failed`/`none` 不算运行中；shell 源 `command_started` 产生的 `running` 同样计入（普通长命令也是任务）。仅当 `backgroundIncludeFinishedTasks=true` 时，才按本文 Extension 规则额外纳入 Hook 明确标记的 done/failed CLI 会话。hook running 超时回退机制继续生效，避免僵尸 running 永久阻止退出。
- 后台模式期间：
  - `Stop`(done)/`StopFailure`(failed) → 系统通知必发（不受"窗口聚焦不弹通知"类抑制逻辑影响）；`PermissionRequest`/`Notification` attention 类同样必发——任务卡在等确认而用户不知道是最差体验。
  - 全部 running 任务终结（done/failed/超时回退）后**不自动退出、不自动弹窗**，仅通知；进程留在托盘等用户处理（自动退出易与用户正在重开窗口竞态）。
- 重开窗口（托盘左键/通知点击）→ `show()+setFocus()+unminimize()`，清 `isInBackgroundMode`。终端画面天然连续（PTY 未断），**不得**触发 restoreSessions 或 resume。
- 与恢复弹窗互斥：托盘常驻路径全程不产生"下次启动询问恢复"状态——只有真正走了退出链路才落最终快照。
- 设置 UI：`exitWithRunningTasksBehavior` 在常规终端设置（紧邻 `closeBehavior`）完整暴露 ask/background/minimize/discard 四个值；弹窗“记住选择”写同一设置。

### 4. Validation & Error Matrix

- `closeBehavior="ask"` + 无 running → 打开普通关闭确认，不弹运行任务弹窗。
- 任意真实退出入口 + 有 running → 按 ask/background/minimize/discard 设置分流。
- 已取得运行任务快照的窗口关闭请求 → 统一守卫不得再次查询 daemon。
- `hide()` 失败 → logWarn 后保持窗口可见，禁止误走退出链路。
- remember 设置写入失败 → logWarn 后继续用户动作；成功时必须保证写入完成早于动作。
- 系统通知发送失败 → logWarn，托盘图标仍在，不 crash。
- 后台模式中收到第二次 `tray-quit-requested` 且仍有 running → 仍按设置分流；ask 时窗口需先 show 再弹窗。
- 伪会话/已 exited 会话产生的状态残留 → 不得计入 running 判定。

### 5. Good/Base/Bad Cases

- Good: claude 任务跑一半点关闭 → 弹窗选"转入后台" → 窗口消失、任务继续 → 完成后 Windows 通知 → 点通知窗口回来，输出连续无重绘。
- Base: 无任务时点关闭（closeBehavior=exit）→ 直接退出，无新增弹窗。
- Base: 后台模式下任务请求权限（PermissionRequest）→ 系统通知提醒用户回来确认。
- Base: 设置 `background` 后关闭 → 不弹窗直接进后台。
- Bad: 转入后台却调了 `pty_close_all` → 任务被杀，"后台继续"变谎言。
- Bad: 托盘"退出"绕过 running 判定直接杀 → 用户以为在后台跑，实际任务没了。
- Bad: 重开窗口触发 resume → PTY 活着却重跑 resume，产生重复会话。

### 6. Tests Required（验收标准）

- `npx tsc --noEmit` 通过。
- 手动验收（安装版 + `tauri dev` 各过一遍核心项）：
  1. claude/codex 任务运行中，分别验证 ask/background/minimize/discard 四种设置；窗口关闭、普通关闭确认后的退出与托盘退出行为一致。
  2. `closeBehavior=ask` 且无运行任务时仍打开普通关闭确认；有运行任务且设置为非 ask 时不再无条件打开运行任务弹窗。
  3. background 在 daemon 可用时真退出 UI 并保留任务；daemon 不可用时降级托盘常驻。minimize 始终只隐藏窗口。
  4. discard 完整退出并清除工作区恢复快照；Claude/Codex 原始历史不受影响。
  5. 后台模式下托盘点“退出”且任务仍在运行时，继续按设置分流，不静默杀任务。
  6. 三个动作分别勾选“记住选择”，立即退出/隐藏后重启确认设置保持；模拟写入失败时动作仍执行且有警告日志。
  7. 普通 shell 长命令（如 `ping -t`）视为 running，同样参与分流。
- 回归红线：`workspace-session-restore-contracts.md` 全部手动用例不回归。

### 7. Wrong vs Correct

#### Wrong

```typescript
// 把"转入后台"接到了退出清理上 —— PTY 被杀，后台继续是假的
const handleBackground = async () => {
  await runExitCleanup("background"); // ❌
};
```

#### Correct

```typescript
const handleBackground = async () => {
  setRunningTasksDialogOpen(false);
  await getCurrentWindow().hide(); // 进程/PTY/hook server 全部存活
  setBackgroundMode(true);         // 仅内存标记，用于通知策略切换
};
```

## Extension: Finished CLI Tasks on Exit (Issue #142)

- `settingsStore.backgroundIncludeFinishedTasks` is a persisted, syncable boolean and defaults to `false`.
- With the setting disabled, exit-task selection must remain identical to `getRunningTaskSessionIds()`: a real PTY whose process status and merged tab status are both `running`.
- With the setting enabled, foreground selection may additionally include only sessions whose **hook source** status is `done` or `failed`.
- The merged tab notification is not sufficient for finished-task detection because ordinary shell `command_finished` events also produce `done` or `failed`.
- `attention` is not a finished-task state and must not change the default exit decision.
- Finished daemon records may be included only while the same setting is enabled.
- Regression coverage must include running PTY, non-PTY, attention, hook done/failed, and shell-only done/failed cases.
