# 终端内 Claude/Codex 回答 Markdown 预览

**版本**：0.1（方案设计）
**日期**：2026-08-02
**状态**：Planning
**CHANGELOG**：`[TEMP]`

## 1. 目标

在内置终端中为 Claude Code / Codex CLI 增加一个“Markdown 预览”入口。用户点击终端右上角按钮后，当前终端在本地内容区内分屏，右侧展示最近一轮已经完成的 AI 最终回答，并复用会话历史“原文”的 Markdown 渲染效果。

本需求不改变终端的原始显示，不从 PTY ANSI 画面中猜测 Markdown，也不新增独立的全局侧栏或 PTY 会话。

## 2. 当前问题

- Claude/Codex 的回答在 xterm 中包含 ANSI、光标移动、TUI 重绘和工具进度，直接把 PTY 文本转换成 Markdown 不可靠。
- 会话历史已经能够将 Claude/Codex 源文件解析为结构化消息，并将 `message.content` 作为“原文”渲染。
- 当前缺少一个从当前终端直接打开这份已解析回答的入口。

## 3. 产品决策

1. **渲染时机**：一轮回答结束后才渲染；回答进行中不解析 Markdown。
2. **内容来源**：优先使用当前绑定会话的历史 `assistant` 消息 `content`，不解析 xterm 输出。
3. **展示内容**：默认展示本轮最后一条有文本内容的 `assistant` 消息；工具调用中间产生的临时消息不单独展示。
4. **展示位置**：当前内部终端内部右侧分屏；不是应用级终端分屏，不创建新 session。
5. **打开方式**：用户点击右上角按钮后打开，不自动弹出；关闭后终端恢复全宽。
6. **渲染实现**：复用历史会话的 `SessionTranscriptContent` / `HistoryMarkdownContent` / `MarkdownContent` 链路。
7. **支持范围**：第一阶段仅针对已识别且有会话绑定能力的 Claude/Codex 内置终端。

## 4. 用户故事

### Story 1：查看本轮回答的 Markdown 预览

**作为**使用 Claude/Codex 的开发者，
**我希望**在回答完成后点击终端右上角的预览按钮，
**以便**在不离开当前终端的情况下阅读排版后的标题、列表、代码块和表格。

### Story 2：保持终端可用

**作为**需要继续操作终端的开发者，
**我希望**预览只是当前终端内容区的临时分屏，
**以便**不丢失终端滚动位置、输入状态、ANSI 输出和 PTY 生命周期。

### Story 3：避免显示错误会话内容

**作为**同时运行多个项目、Worktree 或分屏终端的开发者，
**我希望**预览严格绑定当前 CLI session，
**以便**不会把同项目其他终端的回答显示到当前终端。

## 5. 功能需求

### FR-1：预览入口

- Claude/Codex 内置终端右上角显示 Markdown 预览按钮。
- 普通 Shell、未识别的 CLI、历史 session 不显示该入口。
- 没有可用的已完成 assistant 内容时，按钮不可用或显示明确空态，不触发猜测式解析。
- 按钮提供中英文 tooltip、`aria-label` 和 `aria-pressed` 状态。

### FR-2：内部终端分屏

- 点击按钮后，当前终端内容区域切换为“左侧 xterm + 右侧 Markdown 预览”。
- 默认比例约为 1:1，分隔线可拖动；具体最小宽度按现有终端布局约束执行。
- 再次点击按钮或关闭预览后，xterm 恢复全宽。
- 分屏不改变应用级 pane、tab、Workspan 或 PTY session 结构。
- 分屏和恢复过程中保留 xterm 实例、滚动位置和输入内容，并在尺寸变化后重新 fit。

### FR-3：回答完成判定

- 使用现有 Claude/Codex Hook 或会话生命周期事件判定一轮回答完成。
- 不使用命令提示符、ANSI 文本或固定 CLI 文案作为完成判定。
- 回答失败、取消、等待审批或仍在运行时，不提交新的 Markdown 预览内容。
- 新一轮回答开始后，预览可以暂时保留上一轮已完成内容；新回答完成后再替换。

### FR-4：历史原文获取

- 以当前终端的 `source`、`cliSessionId`、项目/Worktree 作用域和历史源路径作为绑定条件。
- 回答完成后刷新或读取当前会话历史，选择本轮新增的最终 assistant 文本。
- 历史文件写入与 Hook 完成事件存在时间差时，允许有限次数的短暂重试。
- 查询不到严格匹配的 session 时，禁止回退到同项目最近会话。
- 历史内容中的 XML、工作流状态、图片标记、长列表等特殊块继续沿用历史原文的处理规则。

### FR-5：Markdown 渲染

- 第一阶段支持现有渲染器已覆盖的 GFM 能力：标题、段落、粗体、斜体、删除线、列表、任务列表、引用、表格、链接、行内代码和 fenced code block。
- 代码块继续使用现有 terminal 风格和语言高亮能力，并保留横向滚动与复制能力。
- 默认不执行原始 HTML，不加载未经允许的外部图片，不放宽链接安全策略。
- Markdown 解析异常时回退为安全的纯文本展示，不影响 xterm。

### FR-6：状态与生命周期

- 预览内容、来源、session ID、对应消息索引、加载状态和错误状态按 terminal session 隔离。
- 关闭 tab、关闭 session、切换到其他会话或恢复会话时清理或重新绑定预览状态。
- 隐藏预览时不持续解析、不轮询历史；完成事件到达后仅更新缓存内容。
- 重新打开应用或恢复终端后，可以从当前会话历史重新获得最近一轮预览，不额外持久化 Markdown HTML。

### FR-7：国际化和可访问性

- 新增按钮、tooltip、空态、加载态、失败提示和 aria 文案同步支持 `zh-CN` 与 `en-US`。
- 预览开关可使用键盘聚焦、Enter/Space 操作，并反映打开状态。
- 分隔线提供可访问名称；预览区使用合适的滚动容器和标题层级。

## 6. 非功能需求

- 回答流式输出期间不得增加 Markdown 解析开销，也不得阻塞 xterm 写入。
- 单次完成事件只允许提交一次最终内容；重复 Hook 或重复刷新不能造成重复消息。
- 预览加载失败、历史索引滞后或历史文件暂不可读时，终端仍保持可用。
- 当前 session 绑定必须通过现有 session ID 门控，覆盖多 Tab、分屏、多个同项目终端和 Worktree。

## 7. MVP 范围

### 包含

- Claude/Codex 内置终端识别。
- 右上角 Markdown 预览按钮。
- 当前终端内部右侧分屏与关闭恢复。
- 回答完成后读取历史原文并展示最后一条 assistant 回答。
- 复用现有 Markdown 渲染器和 terminal 样式。
- 历史写入延迟、session 不匹配、失败回答和无 Hook 的安全兜底。

### 不包含

- 回答流式 Markdown 渲染。
- 从 PTY ANSI 输出中进行通用 Markdown 识别。
- 将预览内容写回历史文件。
- Mermaid、数学公式、原始 HTML、外部图片增强。
- 普通 Shell、第三方未结构化 CLI 的通用预览。
- 新增独立全局预览侧栏或新的终端 session。

## 8. 验收标准

- [ ] Claude/Codex 回答完成后，当前终端右上角按钮可打开内部右侧 Markdown 预览。
- [ ] 预览显示的是当前 `cliSessionId` 本轮最终 assistant 内容，而不是同项目其他会话内容。
- [ ] 回答进行中不出现 Markdown 半成品渲染；回答失败或取消不会覆盖上一轮成功预览。
- [ ] 预览与历史会话“原文”使用同一套 Markdown 表现和特殊块处理规则。
- [ ] 关闭预览后 xterm 恢复全宽，输入、滚动、PTY 和当前 tab 状态不丢失。
- [ ] 多 Tab、多 pane、同项目多 session、Worktree、WSL 和 SSH 场景不会串显或误绑定。
- [ ] 历史文件延迟写入时能够短暂重试；超过重试窗口后显示可理解的空态/失败状态，不显示错误内容。
- [ ] 无 Hook、无 session ID、历史不可用时不解析 PTY，不影响终端正常使用。
- [ ] 新增界面文案在中英文下均可用，按钮支持键盘和 aria 状态。
- [ ] TypeScript、Rust、相关前端和后端测试通过；已有无关测试失败需单独记录。

## 9. 交付阶段

### Phase 1：数据链路和绑定

- 明确 turn 完成事件与当前 terminal session 的绑定。
- 增加“最新历史原文”读取/刷新能力，绕过或显式刷新可能滞后的 v2 catalog。
- 覆盖本地 Claude/Codex、WSL、Worktree 和多 session 测试。

### Phase 2：终端内预览 UI

- 增加 toolbar 按钮、内部 split 容器、关闭恢复和 xterm fit。
- 复用历史 Markdown 组件并补齐 terminal preview 样式。
- 完成中英文文案、键盘操作和空态。

### Phase 3：可靠性和回归

- 增加历史写入延迟、重复事件、失败/取消、恢复会话、SSH/远端能力边界测试。
- 验证预览不会影响现有终端性能、滚动、输入、恢复和应用级分屏。

## 10. 成功指标

- 支持范围内，完成事件后的预览内容与历史原文最终 assistant 消息一致率达到 100%。
- 多 session 场景不存在跨会话内容串显。
- 预览开关不会导致 xterm session 重建或输入/滚动状态丢失。
- 回答流式阶段的终端输出性能与未开启预览时保持一致。

## 11. 相关现有能力

- `src/components/history/SessionTranscriptContent.tsx`
- `src/components/history/HistoryMarkdownContent.tsx`
- `src/components/ui/MarkdownContent.tsx`
- `src/hooks/useTerminalDisplay.ts`
- `src/stores/historyStore.ts`
- `src/stores/terminalStore.ts`
- `src-tauri/src/commands/history.rs`
