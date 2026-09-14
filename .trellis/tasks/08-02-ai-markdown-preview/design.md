# 技术方案：终端内 Claude/Codex 回答 Markdown 预览

## 1. 设计原则

### 1.1 xterm 与 Markdown DOM 双通道

PTY 输出继续完整写入 xterm；Markdown 预览不参与 xterm 的写入和 ANSI 状态机。

```text
PTY / Hook / History
       ├── PTY 输出 ──> xterm（实时、可交互）
       └── turn_end ──> 历史原文读取 ──> assistant content ──> Markdown DOM
```

这样可以避免 ANSI 清理、光标重绘、alternate screen、进度条和 TUI 输出污染 Markdown。

### 1.2 预览只消费“已完成消息”

预览缓存的最小语义对象建议为：

```ts
type TerminalMarkdownPreview = {
  sessionId: string;
  source: "claude" | "codex";
  cliSessionId: string;
  messageIndex: number | null;
  content: string;
  status: "empty" | "loading" | "ready" | "stale" | "error";
  error?: string;
  opened: boolean;
};
```

该状态必须以内部 terminal session ID 为主键，不能只用项目 ID、tab 标题或当前路径。

## 2. 数据流程

### 2.1 回答开始

在已有 user prompt 提交 / Hook 绑定路径中记录本轮基线：

- 当前 `cliSessionId`。
- 当前 source（Claude 或 Codex）。
- 当前历史文件定位信息和 project/worktree 作用域。
- 最后一次已展示 assistant `messageIndex`，或本轮开始时的 assistant 消息索引。

基线只用于区分本轮新增消息，不能用于跨 session 回退匹配。

### 2.2 回答结束

收到已有的完成事件后执行一次刷新读取：

1. 使用 session ID 解析或确认当前历史文件。
2. 触发当前历史源的轻量刷新/重新解析。
3. 获取当前会话的结构化 `HistorySessionDetail`。
4. 过滤本轮基线之后的 `assistant` 消息。
5. 从末尾选择最后一条有文本内容的 assistant 消息。
6. 写入该 session 的预览缓存。

工具调用可能导致同一轮存在多个 assistant 记录，因此不能固定取“最后一条消息”；应先过滤角色和文本内容，再取本轮最终 assistant 文本。

### 2.3 历史索引一致性

当前 `history_get_session` 会优先读取 v2 catalog；实时回答刚写入时 catalog 可能落后于源 JSONL。因此不能简单假设一次现有调用就能拿到最新内容。

建议二选一：

1. 为 `history_get_session` 增加可选的 fresh/latest 参数，实时预览请求时绕过 v2 catalog，直接走受保护的单文件源解析；或
2. 复用现有 `history_refresh_index(..., wait=false)` 做后台刷新，再通过当前 session 的文件变更/索引完成状态读取 detail，并在前端只针对当前 session 做有限重试。

实现时优先选择不会触发全量同步阻塞终端的方案。实时预览需要“最新内容优先”，普通历史页仍可使用 catalog 快路径；禁止为每次完成事件同步解析全部历史文件。

### 2.4 重试策略

完成事件与历史文件落盘可能存在短暂时间差。建议在前端或专用 store action 中执行有限重试，例如：

- 首次读取：完成事件后立即执行。
- 后续读取：约 100ms、300ms、700ms、1500ms 间隔。
- 只接受 `messageIndex` 超过本轮基线且存在文本的结果。
- 超过窗口后保留旧预览，状态变为 `error` 或 `stale`，不显示其他 session 的内容。

## 3. UI 方案

### 3.1 终端工具栏

- 在当前内部终端右上角增加 `Markdown preview` 按钮。
- 只对 Claude/Codex session 显示。
- 有已完成内容时可用；正在运行、无绑定或读取失败时保留按钮但禁用，并显示原因 tooltip，避免用户误以为普通 Shell 也支持。
- 使用现有终端 toolbar button 样式和 i18n 体系。

### 3.2 内部内容分屏

不要复用应用级 pane tree 创建新 pane，而是在当前 `XTermTerminal` 内容容器内增加局部分屏。布局实现必须保持 xterm 组件身份稳定，不能因为打开预览而让已有 xterm 换 React 父路径并重新挂载：

```text
┌─────────────────────────────────────────┐
│ terminal toolbar                 [MD]   │
├───────────────────┬─────────────────────┤
│ xterm             │ Markdown preview     │
│                   │ latest assistant    │
└───────────────────┴─────────────────────┘
```

- 初始比例约 50/50。
- 分隔线可拖动，保留最小终端宽度。
- 关闭后销毁预览 DOM，不销毁 xterm 实例。
- 打开、关闭和拖动完成后调用现有 fit/resize 机制。
- 预览内容区独立滚动，代码块和表格保留横向滚动。
- 可采用与现有终端分屏一致的稳定 wrapper / flat geometry 思路；拖动过程中使用 `requestAnimationFrame` 更新 DOM 几何，松手后再提交比例状态，避免每一帧重渲染 xterm。

### 3.3 渲染组件

优先直接使用 `SessionTranscriptContent`，从而复用：

- Markdown 区块解析。
- XML / workflow-state / image 标记处理。
- 长区块折叠。
- `HistoryMarkdownContent` 对 terminal variant 的主题适配。

如果单条 assistant 消息不需要历史页的区块标题，可以提取共享的 transcript section renderer，但不要另起一套 Markdown 解析规则。

## 4. 状态机

```text
hidden + empty
      │ turn_end + fresh history
      ▼
hidden + ready ── click ──> open + ready
      │                           │
      │ new turn                  │ close
      ▼                           ▼
hidden + stale              hidden + ready
      │ turn_end
      ▼
hidden + ready（替换为最新回答）
```

异常分支：

- 历史尚未落盘：`loading`，执行有限重试。
- 找不到严格绑定 session：`empty/error`，不回退到项目最近会话。
- 本轮失败或取消：不替换上一轮 `ready` 内容。
- session 关闭：删除该 session 的预览缓存。

## 5. 场景与边界

| 场景 | 设计要求 |
|---|---|
| PowerShell / CMD / Pwsh | 通过已识别的 Claude/Codex 启动命令和 Hook 绑定工作；不解析 Shell 文本 |
| WSL / Git Bash | 使用对应历史根和 CLI session ID；路径映射不能改变 session 绑定 |
| 多 Tab / 多 pane | 预览状态按 terminal session ID 隔离，不能按项目复用 |
| 同项目多个 Claude/Codex | 只接受 source + cliSessionId + 文件作用域完全匹配的结果 |
| Worktree | 使用当前 Worktree 的历史绑定和 cwd/project key，不显示主项目其他会话 |
| SSH 远程终端 | 仅在远程历史 Agent 能提供新鲜 detail 时启用；否则安全禁用，不读取本地同名路径 |
| Hook 未安装 | 终端继续正常工作；预览按钮不可用，不使用 prompt/ANSI 猜测完成 |
| 回答被取消/失败 | 保留上一次成功预览，并显示当前终端状态 |
| 应用失焦/终端隐藏 | 不因 UI 不可见而丢失完成事件；不持续轮询，打开时读取缓存 |
| 恢复终端 | 重新按 session ID 读取最新历史，预览不持久化 HTML |
| 历史内容含超长代码/特殊 XML | 沿用历史原文组件的折叠、限制和安全展示逻辑 |

## 6. 安全与性能

- 不启用原始 HTML 渲染，不执行 Markdown 中的脚本或事件属性。
- 链接继续使用现有安全 URL 过滤和打开策略。
- 外部图片默认不作为 MVP 能力，避免历史内容触发网络请求。
- Markdown 解析只在 turn_end 后执行，且应复用 memo / lazy render。
- 不把完整 PTY 输出复制到 React state；仅保存最终 assistant `content`。
- 预览错误必须隔离在 React 组件内，不能阻塞 PTY 订阅和 xterm 写入。

## 7. 验证计划

### 单元 / 集成

- Claude 单轮：assistant Markdown 内容与历史原文一致。
- Codex 单轮：`response_item` / `event_msg` 混合记录仍选择最终 assistant 文本。
- 工具调用多阶段：不展示中间 assistant/tool 记录，只展示最终回答。
- 历史文件延迟写入：重试能拿到新消息，超时不串会话。
- 重复完成事件：只更新一次，不追加重复内容。

### 7.1 规范参考

- 共享 Markdown 渲染：`.trellis/spec/frontend/component-guidelines.md` 的 `MarkdownContent` 约定。
- 历史转录渲染层：同文件的 `SessionTranscriptContent` 约定。
- 稳定终端身份与分屏几何：同文件的终端 split layout / resize 约定。
- 历史 catalog 刷新与远端 detail：`.trellis/spec/backend/history-index-contracts.md`。
- Hook 重试、去重和安全 Tab 绑定：`.trellis/spec/backend/cli-hook-contracts.md`。

### UI 回归

- 打开/关闭预览不重建 xterm。
- 终端滚动、输入、IME、ANSI/TUI 重绘不受影响。
- 内部预览分屏不改变应用级 pane tree。
- 窗口缩放、应用分屏、Workspan、低内存 WebGL 恢复后尺寸正确。
- 中英文文案、键盘焦点、aria pressed 和分隔线操作正确。

### 交付检查

- `npx tsc --noEmit`
- 前端构建检查
- Rust `cargo check`
- 相关 Rust / 前端测试
- GitNexus 对修改函数执行 impact；提交前执行 `detect_changes()`
