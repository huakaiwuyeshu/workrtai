# 修复会话恢复接线、恢复方式与退出任务行为回归

## Goal

1. 接回启动侧被拆断的终端工作区会话恢复接线，并新增“恢复方式”（每次询问 / 自动恢复），保证恢复提醒只在应用启动时触发一次。
2. 修复 `closeBehavior="ask"` 且存在运行任务时绕过 `exitWithRunningTasksBehavior` 的回归，并消除“记住我的选择”在退出动作前未完成持久化的竞态。
3. 优化启动恢复确认弹窗：常规桌面宽度下提示语单行展示，打开时默认聚焦“恢复”，用户可直接按 Enter 确认。

## Background / Root-Cause Statements

### 会话恢复

会话恢复功能（Issue #123，commit `cb75fb66`）曾完整实现：退出前强制落盘 + 10s 节流快照兜底崩溃/强杀，启动时问询式恢复，CLI 会话走原生 resume、shell 会话贴回 scrollback、分屏树（workspan/paneTree）一并还原。

commit `735123d2`（PTY daemon background tasks）在改造退出链路时删掉了启动侧两处接线：

- `App.tsx` `init()` 不再打开恢复弹窗。
- `handleConfirmRestoreSessions` 不再调用 `terminalStore.restoreSessions`。

结果是退出落盘仍正常，但启动侧无人消费快照，`restoreSessions` 与拒绝恢复的 daemon 清理逻辑成为死代码。修复必须落在 `App.tsx` 启动编排层，复用现有恢复执行器，不在 PTY/daemon 底层重写恢复逻辑。

### 恢复弹窗交互

焦点问题位于共享 `ConfirmDialog` 与 Radix Dialog 的自动聚焦边界：Radix 默认聚焦 DOM 顺序中的首个可聚焦元素，而当前取消按钮位于确认按钮之前。修复应由 `ConfirmDialog` 提供默认关闭的显式确认按钮聚焦契约，并仅由恢复弹窗启用；禁止在 `App.tsx` 通过 DOM 查询或按钮文案查找元素。提示语换行属于恢复弹窗自身的表现层问题，仅为该调用点使用简洁文案和响应式宽度。

### 退出任务行为

根因位于 `App.tsx` 的窗口关闭入口：`closeBehavior="exit"`、托盘退出和普通关闭确认后的退出都会调用 `requestExitGuardedByRunningTasks`，只有 `closeBehavior="ask"` 且检测到运行任务时自行直接打开 `RunningTasksExitDialog`，绕过了已保存的 `exitWithRunningTasksBehavior`。

同一弹窗的 background/minimize/discard 三个回调又以 `void updateSetting(...)` 与退出动作并发执行；对可能立即销毁应用的 background/discard 路径，设置写入存在未完成就退出的竞态。修复必须统一真实退出入口的行为分流，并在执行动作前等待“记住选择”持久化完成；写入失败只记录警告，不阻止用户已选择的动作。

## Requirements

### 会话恢复

- 接回 `init()` 与 `handleConfirmRestoreSessions` 的 `restoreSessions` 接线。daemon attach、CLI resume、shell scrollback、Workspan/Pane 树还原继续复用现有实现。
- 新增 `terminalSessionRestoreMode: "ask" | "auto"`，默认 `"ask"`；非法或缺失旧值回退默认值。
- `syncSettings.ts` 将其标记为 `excluded`，与 `terminalSessionRestoreEnabled` 一致，属于本机运行环境偏好。
- `terminalSessionRestoreEnabled && hasRestorable` 时：`ask` 打开一次恢复确认；`auto` 直接调用 `restoreSessions`。
- 使用 `App.tsx` 模块级 `sessionRestoreHandled`，在弹窗或自动恢复前立即置位，防止 StrictMode/初始化重入重复触发。
- 恢复方式选择器放在 `ThemeSettingsPage`，紧随退出任务行为选择器；总开关关闭时禁用但不隐藏。
- zh-CN / en-US 补齐 label、description、disabled hint、ask、auto 文案。
- 恢复确认弹窗采用简洁提示语，并单独增加响应式内容宽度：常规桌面宽度目标为提示语单行展示，窄窗口按视口自然收缩且不得横向溢出。
- `ConfirmDialog` 增加默认关闭的可选确认按钮自动聚焦与内容样式 props；恢复弹窗单独启用，其他调用点的默认焦点、宽度和行为保持不变。
- 恢复确认弹窗打开后焦点落在“恢复”按钮，直接按 Enter 必须触发恢复。

### 退出任务行为回归

- `closeBehavior="ask"` 时先检测运行任务：
  - 无运行任务：仍打开普通 `CloseConfirmDialog`，保持现有行为。
  - 有运行任务：复用 `requestExitGuardedByRunningTasks` 对 `ask/background/minimize/discard` 的统一分流。
- `requestExitGuardedByRunningTasks` 接受可选的已检测 `{ runningIds, daemonSessionsChecked }`，避免窗口关闭入口重复查询 daemon 与任务状态。
- RunningTasksExitDialog 的 background/minimize/discard 三个回调在 `remember=true` 时，必须先 `await updateSetting("exitWithRunningTasksBehavior", ...)`，再执行对应动作。
- 设置保存失败时 `logWarn`，但继续执行用户已选择的 background/minimize/discard 动作。
- `ThemeSettingsPage` 的退出任务行为选项补齐已有合法值 `minimize`。
- 不修改底层 PTY/daemon 清理实现、IPC、数据库结构或依赖。

## Scenario Matrix

### 会话恢复

- 总开关：开 / 关。
- 恢复方式：ask / auto。
- 快照：有 / 无。
- 会话类型：daemon 存活 / CLI resume / 普通 shell scrollback。
- 布局：单 Pane / 多 Pane / Workspan 开关。
- 重入：StrictMode 双调用 / 设置页切换。
- 窗口宽度：常规桌面宽度单行提示 / 窄窗口响应式收缩且无横向溢出。
- 键盘：弹窗打开即聚焦恢复按钮 / 直接 Enter 恢复 / 其他 ConfirmDialog 调用点保持原焦点行为。

### 退出任务行为

- 关闭入口：窗口关闭 / `CloseConfirmDialog` 确认退出 / 托盘退出。
- `closeBehavior`：ask / exit / minimize。
- 任务：无任务 / 前台运行 PTY / 仅 daemon 后台任务 / 已完成任务纳入开关开启。
- 退出任务行为：ask / background / minimize / discard。
- daemon：可用 / 查询失败 / 不可用。
- remember：关闭 / 开启；设置写入成功 / 失败。

## Acceptance Criteria

- [ ] ask 恢复模式仅在启动时弹一次；确认后还原全部标签和布局，拒绝后清快照并关闭无人认领 daemon 会话。
- [ ] auto 恢复模式不弹窗并直接恢复；daemon 优先 attach，CLI 走原生 resume，普通 shell 贴回 scrollback。
- [ ] 恢复总开关关闭时清理当前环境快照，选择器置灰，SQLite `session_meta` 不受影响。
- [ ] 恢复确认弹窗在常规桌面宽度下提示语单行显示，窄窗口自然收缩且无横向溢出。
- [ ] 恢复确认弹窗打开时默认聚焦“恢复”，直接按 Enter 执行恢复；其他 `ConfirmDialog` 调用点保持现有默认焦点、宽度和行为。
- [ ] `closeBehavior="ask"` + 无运行任务仍打开普通关闭确认。
- [ ] `closeBehavior="ask"` + 有运行任务时，ask/background/minimize/discard 均按已保存设置执行，不再无条件弹运行任务对话框。
- [ ] 窗口关闭、普通关闭确认后的退出与托盘退出使用同一运行任务行为语义。
- [ ] 勾选“记住我的选择”后，设置持久化先于 background/minimize/discard 动作；写入失败记录警告但动作继续。
- [ ] 设置页可直接选择并正确显示 minimize。
- [ ] 不修改底层 PTY/daemon 清理、IPC、数据库与依赖。
- [ ] `npx tsc --noEmit`、`node scripts/resumeCliArgs.test.mjs`、`git diff --check` 通过。

## Changelog Target

`V1.3.2`

## Notes

- 复用现有 `restoreSessions`、`sessionSnapshotPersistence`、`ConfirmDialog` 与 `requestExitGuardedByRunningTasks`，不重写底层执行逻辑。
- 恢复总开关（要不要恢复）与恢复方式（怎么恢复）保持职责分离。
- 退出任务回归的调查记录见 `research/exit-task-behavior-regression.md`。
