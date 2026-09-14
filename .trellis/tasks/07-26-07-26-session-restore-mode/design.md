# 技术设计

## 边界与职责

- `settingsStore.ts`：持久化会话恢复总开关与恢复方式；现有 `ExitWithRunningTasksBehavior` 四值模型保持不变。
- `syncSettings.ts`：会话恢复方式属于本机环境设置，标记为 `excluded`。
- `App.tsx`：唯一启动恢复编排入口，也是所有真实退出入口的统一运行任务行为分流层；恢复弹窗在此单独启用专用宽度与确认按钮自动聚焦。
- `ConfirmDialog.tsx`：共享确认弹窗只提供默认关闭的可选 `confirmAutoFocus` / `contentClassName` 契约，不改变现有调用点默认行为。
- `terminalStore.restoreSessions`：既有恢复执行器，负责 daemon attach、CLI resume、shell scrollback 和 Workspan/Pane 重建，本任务不修改。
- `ThemeSettingsPage.tsx`：提供恢复方式选择器，并补齐退出任务行为的 minimize 选项。

## 启动恢复状态机

1. `terminalSessionRestoreEnabled=false`：清理当前环境快照，不弹窗、不恢复。
2. 总开关开启但无真实 PTY 快照：清理空/伪快照，静默继续。
3. 有快照且 `sessionRestoreHandled=false`：立即置为 `true`。
4. `mode=ask`：打开一次恢复确认；确认调用 `restoreSessions`，拒绝清快照并关闭无人认领 daemon 会话。
5. `mode=auto`：不弹窗，直接调用 `restoreSessions`。

## 恢复弹窗 UI 与键盘交互

- 提示语缩短为单句，恢复弹窗使用 `w-[calc(100vw-2rem)]` 配合独立最大宽度：桌面宽度下保持单行，窄窗口保留左右安全间距并自然收缩。
- `ConfirmDialog` 使用确认按钮 ref；仅当 `confirmAutoFocus=true` 时，在 Radix `DialogContent.onOpenAutoFocus` 中阻止默认自动聚焦并显式聚焦确认按钮。
- 不使用 DOM 查询或按钮文案匹配。确认按钮获得焦点后沿用原生 Button 键盘语义，Enter 触发既有 `onConfirm`。
- `confirmAutoFocus` 默认为 `false`，`contentClassName` 不传时继续使用原 `max-w-[360px]`，因此其余调用点不受影响。

## 退出任务行为状态机

### 统一守卫

`requestExitGuardedByRunningTasks(source, prechecked?)` 是真实退出请求的统一行为分流点：

- `prechecked` 缺失时调用 `getExitRunningTaskIds(source)`。
- `prechecked` 存在时直接消费该快照，避免同一窗口关闭请求重复查询。
- 无任务：按 `daemonSessionsChecked` 决定清理范围后退出。
- 有任务：读取 `exitTasksBehaviorRef.current`，按 ask/background/minimize/discard 分流。

### 窗口关闭入口

- `closeBehavior=minimize`：保持原有 hide 行为。
- `closeBehavior=exit`：直接进入统一守卫。
- `closeBehavior=ask`：先检测运行任务。
  - 无任务：打开普通 `CloseConfirmDialog`。
  - 有任务：把检测结果传给统一守卫；已保存行为为 ask 才打开 `RunningTasksExitDialog`，其余值直接执行。

托盘退出与 `CloseConfirmDialog` 的“退出”继续直接调用统一守卫。

## “记住选择”时序

新增小型 helper：

```typescript
persistExitTaskBehaviorBeforeAction(remember, behavior): Promise<void>
```

- `remember=false`：立即返回。
- `remember=true`：等待 `updateSetting` 完成。
- 写入失败：`logWarn` 后返回，不抛出阻断动作。

background/minimize/discard 三个回调统一采用：关闭弹窗 → 记录选择日志 → await helper → await 对应动作。

## 兼容与迁移

- 缺失或非法 `terminalSessionRestoreMode` 回退 `ask`。
- `exitWithRunningTasksBehavior` 继续使用现有 ask/background/minimize/discard 四值，不变更持久化结构。
- 不增加数据库 migration、IPC 或依赖。
- 安装版和 dev 版继续由既有会话文件隔离机制处理。

## 风险与回滚

- GitNexus 对 `requestExitGuardedByRunningTasks` 评级 HIGH：3 个直接调用点，涉及窗口关闭、托盘退出和普通关闭确认后的退出，需覆盖完整入口矩阵。
- GitNexus 对共享 `ConfirmDialog` 评级 CRITICAL（19 个直接调用点、21 条流程）；新增 props 必须默认关闭，并验证未传 props 的调用点维持原焦点和宽度。
- 恢复入口涉及启动关键路径与现有 daemon/PTY 恢复执行流，综合按中等风险验证。
- 回滚时仅撤销 `App.tsx` 编排接线、设置 UI/字段和契约文档；不触碰底层 PTY/daemon 清理实现或快照格式。
