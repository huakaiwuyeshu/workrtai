# 诊断报告：输入光标偶现跳到尾行问题

**诊断时间**：2026-06-12  
**问题描述**：在 Claude Code/Codex 环境中输入时，光标有概率出现在终端尾行而非输入框位置  
**诊断文件**：`src/components/XTermTerminal.tsx`

---

## 问题根因

### 时序窗口导致的竞态条件

**位置**：`XTermTerminal.tsx:790-801` `onCompositionStart` 函数

```typescript
const onCompositionStart = () => {
  isComposingRef.current = true;
  compositionAnchorCell = resolveCompositionAnchorCell();  // 步骤1：冻结锚点
  releaseHelperTextareaAnchorPin();                        // 步骤2：清空样式 ⚠️ 危险窗口
  captureCompositionScroll();
  scheduleCompositionScrollRestore();
  scheduleCompositionAnchorFix();                          // 步骤3：调度修复
};
```

**问题执行流程**：

1. **步骤1**：冻结锚点 `compositionAnchorCell = { x: buffer.cursorX, y: buffer.cursorY }`
2. **步骤2**：调用 `releaseHelperTextareaAnchorPin()` 清空 `textarea.style.left/top` 为 `""`
3. **[时序窗口]**：xterm.js 检测到样式变化，用当前 `buffer.cursorX/Y` 重新定位 textarea
4. **步骤3**：`scheduleCompositionAnchorFix()` 调度修复（虽然立即执行，但已晚于 xterm 的响应）

**关键代码**：

```typescript
// XTermTerminal.tsx:763-774
const releaseHelperTextareaAnchorPin = () => {
  if (helperTextareaAnchorRafId !== null) {
    cancelAnimationFrame(helperTextareaAnchorRafId);
    helperTextareaAnchorRafId = null;
  }
  if (!textarea) return;
  textarea.style.left = "";    // ⚠️ 清空导致 xterm 重新定位
  textarea.style.top = "";
  textarea.style.width = "";
  textarea.style.height = "";
  textarea.style.lineHeight = "";
};
```

---

## 触发条件

1. **环境**：Claude Code/Codex 的 `/compact` 模式频繁移动硬件光标到进度条（终端尾行）
2. **时机**：用户按下第一个拼音键触发 `compositionstart` 时，光标恰好在尾行
3. **竞态**：`releaseHelperTextareaAnchorPin()` 清空样式后，xterm 抢先用尾行位置定位 textarea
4. **表现**：用户看到输入框/候选框短暂出现在尾行，或输入位置错误

---

## 证据链

### 证据1：历史记忆确认
**文件**：`C:\Users\Administrator\.claude\projects\D--work-pythonProject-CLI-Manager\memory\ime-anchor-freeze-on-composition.md`

```
06-09 到 06-11 共六次修复都失败，因为都在猜「真实输入位置」的启发式。

正解（方案 B）：composition 期间用户输入的拼音不发给 PTY，TUI 不会重绘，
真实输入位置全程不变。所以在 compositionstart 那一刻读一次 buffer.cursorX/Y 
冻结进 compositionAnchorCell，整个 composition 周期复用这个冻结值。
```

**结论**：冻结锚点的设计是正确的，但 `releaseHelperTextareaAnchorPin()` 创造了时序窗口。

### 证据2：scheduleCompositionAnchorFix 的调度机制
**位置**：`XTermTerminal.tsx:722-738`

```typescript
const scheduleCompositionAnchorFix = () => {
  applyCompositionAnchorFix();  // 立即执行一次
  compositionAnchorRafId = requestAnimationFrame(() => {
    applyCompositionAnchorFix();  // RAF 再执行
  });
  compositionAnchorTimeoutId = window.setTimeout(() => {
    applyCompositionAnchorFix();  // setTimeout 再执行
  }, 0);
};
```

**问题**：虽然立即执行了 `applyCompositionAnchorFix()`，但在 JS 事件循环中仍晚于 xterm 对样式变化的响应。

### 证据3：applyCompositionAnchorFix 依赖冻结锚点
**位置**：`XTermTerminal.tsx:697-720`

```typescript
const applyCompositionAnchorFix = () => {
  if (!isComposingRef.current) return;
  const compositionView = terminalContainer.querySelector(".composition-view") as HTMLElement | null;
  if (!textarea && !compositionView) return;
  const anchor = compositionAnchorCell ?? resolveCompositionAnchorCell();  // 优先使用冻结锚点
  const cell = estimateCellSize();
  const left = `${Math.max(0, anchor.x * cell.width)}px`;
  const top = `${Math.max(0, anchor.y * cell.height)}px`;
  // ... 设置 textarea 和 compositionView 位置
};
```

**结论**：修复逻辑正确，但时序窗口让 xterm 有机会在修复前用错误位置定位 textarea。

---

## 修复方案

### 方案：移除时序窗口

**修改文件**：`src/components/XTermTerminal.tsx:790-801`

**当前代码**：
```typescript
const onCompositionStart = () => {
  isComposingRef.current = true;
  compositionAnchorCell = resolveCompositionAnchorCell();
  releaseHelperTextareaAnchorPin();  // ❌ 移除此行
  captureCompositionScroll();
  scheduleCompositionScrollRestore();
  scheduleCompositionAnchorFix();
};
```

**修复后**：
```typescript
const onCompositionStart = () => {
  isComposingRef.current = true;
  compositionAnchorCell = resolveCompositionAnchorCell();
  // 移除 releaseHelperTextareaAnchorPin()，直接用冻结锚点设置位置
  captureCompositionScroll();
  scheduleCompositionScrollRestore();
  scheduleCompositionAnchorFix();  // 这会立即用冻结锚点设置 textarea 位置
};
```

### 为什么这样修复是安全的

1. **冻结锚点已在第2行设置**：`compositionAnchorCell = resolveCompositionAnchorCell()`
2. **applyCompositionAnchorFix 会读取冻结锚点**：`const anchor = compositionAnchorCell ?? ...`
3. **不需要"清空→重新设置"**：直接用冻结锚点设置位置，无时序窗口
4. **原有防御保持不变**：
   - 滚动锁定：`captureCompositionScroll()` + `scheduleCompositionScrollRestore()`
   - 多次修复：`scheduleCompositionAnchorFix()` 包含立即执行 + RAF + setTimeout
   - compositionend 恢复：`scheduleHelperTextareaAnchorPin()` 重新隐藏 textarea

### releaseHelperTextareaAnchorPin 的原始用途

查看代码，`releaseHelperTextareaAnchorPin()` 的作用是：
1. 取消待执行的 RAF（`helperTextareaAnchorRafId`）
2. 清空 textarea 样式，让 xterm 接管定位

**但在 compositionstart 时不需要这样做**，因为：
- 我们已经有了冻结的正确位置（`compositionAnchorCell`）
- `applyCompositionAnchorFix()` 会立即用冻结位置设置样式
- 不需要让 xterm"接管"然后再"抢回来"，这正是时序窗口的来源

---

## 影响范围

**修改行数**：1 行（移除 `XTermTerminal.tsx:797`）

**影响功能**：
- ✅ IME composition 锚点冻结逻辑不变
- ✅ 滚动锁定与恢复逻辑不变
- ✅ compositionend 恢复逻辑不变
- ✅ 移除时序窗口，消除竞态条件

**风险评估**：**低**
- 修改是减法（移除危险代码），不是加法
- 冻结锚点机制已验证有效（06-09 到 06-11 的最终方案）
- 不影响其他 composition 生命周期逻辑

---

## 验证方法

1. 启动 CLI-Manager
2. 打开 Claude Code 或 Codex 终端会话
3. 触发 `/compact` 模式（流式输出、进度条更新）
4. 在进度条刷新时输入中文拼音
5. 观察 IME 候选框位置是否始终跟随输入位置，不跳到尾行

---

## 参考

- 历史修复记忆：`.claude/projects/.../memory/ime-anchor-freeze-on-composition.md`
- 相关代码：
  - `src/components/XTermTerminal.tsx:687-695` `resolveCompositionAnchorCell`
  - `src/components/XTermTerminal.tsx:697-720` `applyCompositionAnchorFix`
  - `src/components/XTermTerminal.tsx:722-738` `scheduleCompositionAnchorFix`
  - `src/components/XTermTerminal.tsx:763-774` `releaseHelperTextareaAnchorPin`
  - `src/components/XTermTerminal.tsx:790-812` composition 事件处理
