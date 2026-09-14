# Research: 退出任务行为设置回归

- **Query**: 持久化已确认的调查结论：`closeBehavior="ask"` 且存在运行任务时，窗口关闭入口绕过统一退出守卫，导致 `exitWithRunningTasksBehavior` 不被消费；设置 UI 缺少 `minimize`；弹窗“记住选择”可能存在退出前持久化竞态。记录触点、回归提交、复现矩阵、建议修复和风险。
- **Scope**: internal
- **Date**: 2026-07-26

## Findings

### Root Cause

根因位于 `src/App.tsx` 的窗口关闭监听分支：

- `closeBehavior === "exit"` 时，入口调用统一守卫 `requestExitGuardedByRunningTasks("window close")`，守卫会读取 `exitTasksBehaviorRef.current`，并按 `background` / `minimize` / `discard` / `ask` 分流（`src/App.tsx:1354-1389`, `src/App.tsx:1473-1476`）。
- `closeBehavior === "ask"` 时，入口没有调用该守卫，而是再次调用 `getExitRunningTaskIds("window close")`；只要发现运行任务，就直接打开 `RunningTasksExitDialog`（`src/App.tsx:1478-1491`）。
- 因此，在 `closeBehavior="ask"` 且有运行任务的状态组合下，已经保存的 `exitWithRunningTasksBehavior="background" | "minimize" | "discard"` 不会被该入口读取。设置写入可以成功，但下一次从窗口关闭按钮进入时仍会弹出运行任务对话框。

当前代码中的关键分叉：

```typescript
if (behavior === "exit") {
  event.preventDefault();
  await requestExitGuardedByRunningTasks("window close");
  return;
}
event.preventDefault();
const { runningIds, daemonSessionsChecked } = await getExitRunningTaskIds("window close");
// runningIds 非空时直接 setRunningTasksDialogOpen(true)
```

这不是设置加载或联合类型迁移失败：

- `ExitWithRunningTasksBehavior` 已包含 `"ask" | "background" | "minimize" | "discard"`（`src/stores/settingsStore.ts:68-70`）。
- 设置加载迁移也接受全部四个值（`src/stores/settingsStore.ts:1268-1274`）。
- 真正缺失的是 `closeBehavior="ask"` 窗口关闭入口对统一守卫及其中已保存行为的消费。

### Regression Commit

回归由提交 `735123d28f20d3d2a90b0b6dbc1c90dc7b98fa27`（`feat: add PTY daemon background tasks`，2026-07-13）引入，父提交为 `cc69ca591ebd78dfbae8dcd77da57e727c705979`。

该提交在 `src/App.tsx` 中把原先 `closeBehavior="ask"` 的无条件 `setCloseDialogOpen(true)` 改为：

1. 查询运行任务；
2. 有运行任务时直接设置 `runningTasksCount` 并打开 `RunningTasksExitDialog`；
3. 无运行任务时才打开 `CloseConfirmDialog`。

同一提交已经扩展统一守卫，使其支持 daemon 任务以及 `background` / `minimize` / `discard` 分流，但新增的 `closeBehavior="ask"` 特殊分支没有复用该守卫，形成入口行为不一致。

### Files Found

| File Path | Description |
|---|---|
| `src/App.tsx` | 退出守卫、窗口关闭监听、托盘退出监听、运行任务弹窗回调及“记住选择”写入。核心触点为 `1351-1431`、`1444-1520`。 |
| `src/components/RunningTasksExitDialog.tsx` | 运行任务对话框。实际提供 `background`、`discard`、`minimize` 三个动作和“记住选择”（`12-45`, `71-115`）。 |
| `src/components/settings/pages/ThemeSettingsPage.tsx` | 设置 UI。`exitWithRunningTasksOptions` 当前只有 `ask`、`background`、`discard`，遗漏合法值 `minimize`（`393-397`）；Select 使用该数组（`830-840`）。 |
| `src/stores/settingsStore.ts` | 设置联合类型、加载迁移及异步 `update` 实现。`update` 先 `await getStore()`、再 `await s.set(...)`、最后更新 Zustand 内存态（`1539-1546`）。Store 以 `{ autoSave: 0 }` 加载（`1087-1091`）。 |
| `src/lib/i18n.ts` | `settings.options.exitTasks.minimize` 的中英文文案已经存在（`2057-2060`, `4802-4805`），UI 缺项不是文案缺失。 |
| `.trellis/spec/frontend/background-task-continuation-contracts.md` | 退出运行任务功能契约。规定真实退出入口应先判定运行任务并按设置分流，设置 UI 应暴露行为选项，“记住选择”应写入设置。 |
| `.trellis/spec/backend/app-startup-contracts.md` | 关闭行为契约，记录 `closeBehavior` 三种值及真实退出入口约束（`194-204`）。 |
| `node_modules/@tauri-apps/plugin-store/dist-js/index.d.ts` | 项目安装的 plugin-store 2.4.2 类型定义；`autoSave` 为修改后的防抖自动保存选项，默认 100ms，数字表示防抖时长（`13-16`）。 |
| `node_modules/@tauri-apps/plugin-store/dist-js/index.js` | `Store.set` 本身是异步 IPC 调用，等待 `plugin:store|set` 返回（`162-168`）。 |

### Code Patterns

#### 1. 统一守卫只被部分入口使用

会消费 `exitWithRunningTasksBehavior` 的入口：

- 托盘退出：`requestExitGuardedByRunningTasks("tray quit")`（`src/App.tsx:1444-1453`）。
- `closeBehavior="exit"` 的窗口关闭：`requestExitGuardedByRunningTasks("window close")`（`src/App.tsx:1473-1476`）。
- `CloseConfirmDialog` 中确认退出：`requestExitGuardedByRunningTasks("close dialog")`（`src/App.tsx:1510-1520`）。

不会消费该设置的入口：

- `closeBehavior="ask"` 且发现运行任务的窗口关闭分支，直接打开 `RunningTasksExitDialog`（`src/App.tsx:1478-1491`）。

#### 2. 设置模型与设置 UI 不一致

设置模型允许四值：

```typescript
export type ExitWithRunningTasksBehavior =
  "ask" | "background" | "minimize" | "discard";
```

运行任务弹窗也允许选择 `minimize`（`src/components/RunningTasksExitDialog.tsx:12`, `41-44`, `94-104`），且 i18n 文案已存在；但设置页面选项数组只有三项：

```typescript
[
  { value: "ask", ... },
  { value: "background", ... },
  { value: "discard", ... },
]
```

结果是：通过弹窗“记住选择”写入的 `minimize` 能被 store 加载和业务守卫消费，但用户无法在设置页面直接选择它；当当前值已经是 `minimize` 时，Select 的数据源也没有对应选项。

#### 3. “记住选择”与立即动作并发

三个运行任务弹窗回调均采用同一模式（`src/App.tsx:1391-1431`）：

```typescript
if (remember) {
  void updateSetting("exitWithRunningTasksBehavior", nextBehavior);
}
void executeAction();
```

`updateSetting` 是异步函数，内部至少跨越 `await getStore()` 和 `await s.set(...)` 两个异步边界（`src/stores/settingsStore.ts:1539-1546`）；`Store.set` 又通过异步 Tauri IPC 执行（`node_modules/@tauri-apps/plugin-store/dist-js/index.js:162-168`）。当前回调没有等待设置写入完成，就立即执行隐藏窗口、转后台或清理并退出。

因此：

- 对仅隐藏到托盘的 `minimize`，进程仍存活，风险较低，但写入完成时序仍不确定。
- 对 daemon 可用时可能真正退出应用的 `background`，以及会执行退出清理的 `discard`，进程可能在未等待设置 Promise 完成前销毁。
- 是否在当前 Tauri/plugin-store 运行时稳定丢失写入，静态代码无法最终证明，必须在实施阶段做真实进程退出复现；但异步调用未被等待这一竞态窗口确定存在。

### Reproduction Matrix

| `closeBehavior` | 运行任务 | `exitWithRunningTasksBehavior` | 入口 | 当前结果 | 期望观察点 |
|---|---:|---|---|---|---|
| `ask` | 否 | 任意 | 点击窗口关闭 | 打开 `CloseConfirmDialog` | 原行为，不涉及运行任务设置。 |
| `ask` | 是 | `ask` | 点击窗口关闭 | 打开 `RunningTasksExitDialog` | 符合“每次询问”。 |
| `ask` | 是 | `background` | 点击窗口关闭 | **仍打开 `RunningTasksExitDialog`** | 回归：已保存行为未被消费。 |
| `ask` | 是 | `minimize` | 点击窗口关闭 | **仍打开 `RunningTasksExitDialog`** | 回归；且设置页无法直接选择该值。 |
| `ask` | 是 | `discard` | 点击窗口关闭 | **仍打开 `RunningTasksExitDialog`** | 回归：已保存行为未被消费。 |
| `exit` | 是 | `background` | 点击窗口关闭 | 进入 `enterBackgroundTaskMode()` | 统一守卫正常消费设置。 |
| `exit` | 是 | `minimize` | 点击窗口关闭 | 隐藏到托盘 | 统一守卫正常消费设置。 |
| `exit` | 是 | `discard` | 点击窗口关闭 | 丢弃会话并退出 | 统一守卫正常消费设置。 |
| 任意 | 是 | 非 `ask` | 托盘“退出” | 按已保存行为分流 | 统一守卫正常消费设置。 |
| `ask` | 是 | 弹窗选择任一动作并勾选“记住” | 点击窗口关闭后确认 | 动作立即执行，设置异步写入未等待 | 重启后检查设置文件和值；分别覆盖 daemon 开/关。 |

补充验证维度：

- daemon 可用 / daemon 查询失败 / daemon 不可用；
- 前台 running PTY / 仅 daemon 后台任务 / 同时存在；
- `background` 动作最终隐藏窗口还是销毁应用；
- `discard` 退出后立即重启，核对 `exitWithRunningTasksBehavior` 是否保持；
- 从弹窗记住 `minimize` 后打开设置页，核对 Select 是否能显示当前值；
- 托盘退出、窗口关闭、CloseConfirmDialog 确认退出三个入口的行为一致性。

### Suggested Repair

1. **统一入口语义**：`closeBehavior="ask"` 仍负责决定是否先展示普通关闭确认；但一旦进入“真实退出且存在运行任务”的决策链，应复用 `requestExitGuardedByRunningTasks` 中对 `exitWithRunningTasksBehavior` 的分流，避免窗口关闭入口自行复制一套只会弹窗的逻辑。
2. **补齐设置 UI**：在 `ThemeSettingsPage` 的 `exitWithRunningTasksOptions` 中加入已有合法枚举 `minimize`，直接复用已存在的 `settings.options.exitTasks.minimize` 文案。
3. **串行化“记住选择”与动作**：将三个运行任务弹窗回调改为异步流程；勾选“记住”时先 `await updateSetting(...)`，写入完成后再执行 `enterBackgroundTaskMode()`、`minimizeToTray()` 或退出清理。写入失败时的产品行为需实施时明确，但不能继续把写入 Promise 无条件丢弃。
4. **保持单一分流源**：修复后以 `requestExitGuardedByRunningTasks` 为运行任务行为设置的唯一消费点或唯一共享分流函数，避免托盘、窗口关闭和关闭确认继续漂移。

### Risks

- **交互顺序风险**：不能简单把所有 `closeBehavior="ask"` 请求直接交给运行任务守卫，否则无运行任务时可能绕过原有 `CloseConfirmDialog`，改变“关闭时询问”的含义。
- **递归弹窗风险**：若先展示 `CloseConfirmDialog`，用户选择“退出”后再进入运行任务守卫，可能形成两阶段确认；需按既定产品语义验证这是预期流程，还是在首次关闭时直接展示运行任务决策。
- **daemon 分支风险**：`background` 在 daemon 可用时会进入退出清理并销毁应用，不只是隐藏窗口；设置持久化必须在该动作前完成。
- **失败处理风险**：等待 `updateSetting` 后，若 IPC/Store 写入失败，需要决定是否阻止动作、提示用户后继续，或继续动作但明确“未记住”；不得让对话框无反馈卡住。
- **重复查询风险**：如果 `closeBehavior="ask"` 分支先查一次运行任务、随后守卫再查一次，daemon/任务状态可能在两次查询间变化。修复时应避免无必要的双重快照或明确以第二次结果为准。
- **契约陈旧风险**：`.trellis/spec/frontend/background-task-continuation-contracts.md` 仍描述旧的三值 `"ask" | "background" | "exit"` 和 Phase 1 托盘常驻语义，而当前代码已是 `"ask" | "background" | "minimize" | "discard"` 并包含 daemon Phase 2 行为。该文档可用于确认“所有真实退出入口统一分流”的原始约束，但不能作为当前枚举的完整来源。

### Related Specs

- `.trellis/spec/frontend/background-task-continuation-contracts.md` — 运行任务退出分流、托盘入口、设置 UI 和“记住选择”的原始契约；枚举内容已部分陈旧。
- `.trellis/spec/backend/app-startup-contracts.md` — `closeBehavior` 与真实退出路径约束。
- `.trellis/spec/guides/fix-triage-guide.md` — 本问题依赖 `closeBehavior`、是否存在运行任务、daemon 状态及入口类型，属于状态依赖型行为回归；复现需覆盖状态矩阵。

## Caveats / Not Found

- 未修改任何产品代码、spec 或配置文件；仅创建本 research 文件。
- 未运行桌面应用进行动态复现。本报告中的入口绕过和 UI 缺项由源码与提交差异直接确认；“记住选择”实际是否丢盘仍需实施阶段通过真实退出/重启验证。
- `git blame` 因本地仓库缺失一个被引用对象并尝试远端获取失败，未能生成逐行 blame；回归提交通过 `git show 735123d2`、其父提交及提交差异确认。
- 未发现现有自动化前端测试覆盖该退出矩阵；项目说明中前端仅有 TypeScript 静态校验，核心行为需要 Tauri 手动验收。
