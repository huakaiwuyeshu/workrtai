# Codex 终端滚动历史受限问题与解决方案

## 问题描述

Codex CLI 在 CLI-Manager 内嵌终端中运行时，无法通过滚动条查看历史输出，即使调整了 `terminalScrollbackRows` 设置（1000-50000 行）也无效。

## 根本原因

Codex CLI 默认使用 **Alternate Screen Buffer**（备用屏幕缓冲区）运行 TUI：

1. **技术机制**：
   - TUI 应用切换到独立的屏幕缓冲区（类似 vim、htop、top）
   - 使用终端控制序列频繁清屏重绘（`\x1b[2J`、`\x1b[H`）
   - Alternate buffer 的内容**不进入 scrollback**（这是所有终端的标准行为）

2. **为什么设置无效**：
   - `scrollback: terminalScrollbackRows` 配置对普通 CLI（如 Claude Code）有效
   - 对 TUI alternate screen 模式无效
   - `scrollOnEraseInDisplay: true` 只能部分缓解，无法完全解决

3. **不是 CLI-Manager 的 bug**：
   - 在 Windows Terminal、iTerm2 等外部终端中运行 Codex，同样无法回滚查看历史
   - 这是 TUI 应用的固有特性

## 解决方案

Codex 提供了 `--no-alt-screen` 参数和配置选项来禁用 alternate screen。

### 方案 A：项目级配置（推荐）

在 CLI-Manager 中配置 Codex 项目：

```
CLI 工具：codex
启动命令：codex --no-alt-screen
```

**优点**：
- 每个项目独立配置
- 不影响命令行手动运行 Codex 的行为

**步骤**：
1. 右键侧边栏中的 Codex 项目 → "编辑项目"
2. 在"启动命令"字段填入：`codex --no-alt-screen`
3. 保存后重新打开终端

### 方案 B：全局配置

编辑 Codex 配置文件：`~/.codex/config.toml`

```toml
[tui]
alternate_screen = "never"
```

**优点**：
- 所有 Codex 会话统一生效
- 不用每个项目单独配置

**缺点**：
- 影响全局行为，包括命令行手动运行

### 方案 C：自动检测模式

Codex 默认支持 Zellij 检测，自动禁用 alternate screen：

```toml
[tui]
alternate_screen = "auto"  # 默认值
```

在 CLI-Manager 中可以通过环境变量伪装：

```json
{
  "ZELLIJ": "1"
}
```

然后启动命令用：`codex --no-alt-screen -c tui.raw_output_mode=true`

## 权衡说明

| 模式 | Scrollback | TUI 布局 | 兼容性 |
|------|-----------|---------|--------|
| **默认（alternate screen）** | ❌ 不可滚动 | ✅ 完整 TUI | ✅ 所有终端 |
| **--no-alt-screen** | ✅ 可滚动 | ⚠️ 略有差异 | ⚠️ 部分终端（Eclipse）仍有问题 |

## 实现细节

### CLI-Manager 数据流

```
projects 表
├─ cli_tool: "codex"
└─ startup_cmd: "codex --no-alt-screen"
      ↓
terminalStore.createSession(projectId, ...)
      ↓
pty_create(cwd, shell) → 创建 PTY
      ↓
pty_write(sessionId, startupCmd + "\r") → 自动执行启动命令
      ↓
XTermTerminal 组件
└─ scrollback: terminalScrollbackRows (1000-50000)
```

### 关键代码位置

| 文件 | 职责 |
|------|------|
| `src/components/ConfigModal.tsx:230` | 项目配置 UI - 启动命令输入框 |
| `src/stores/terminalStore.ts:278-342` | 终端会话创建 - startupCmd 自动执行 |
| `src/components/XTermTerminal.tsx:360` | XTerm 初始化 - scrollback 参数设置 |
| `src/components/XTermTerminal.tsx:447-455` | Codex 检测逻辑 - 识别 Codex 会话 |

### 相关配置

- XTerm 配置：`scrollback: terminalScrollbackRows`（在 `XTermTerminal.tsx:360`）
- XTerm 选项：`scrollOnEraseInDisplay: true`（在 `XTermTerminal.tsx:361`）
- 设置范围：`TERMINAL_SCROLLBACK_ROWS_MIN = 1000`，`TERMINAL_SCROLLBACK_ROWS_MAX = 50000`
- 默认值：`TERMINAL_SCROLLBACK_ROWS_DEFAULT = 5000`

## 待验证问题

**需要用户实测验证**：

1. **TUI 布局差异**：`--no-alt-screen` 模式下 Codex TUI 的视觉表现是否正常
2. **历史完整性**：长输出（如生成 100 行代码）是否完整进入 scrollback
3. **多会话场景**：同时开多个 Codex 终端时的性能和稳定性
4. **Windows 兼容性**：CLI-Manager 在 Windows + ConPTY 环境下的具体表现
5. **交互功能**：TUI 交互是否正常（Ctrl+C、Ctrl+T、审批弹窗等）
6. **行数限制**：设置的 scrollback 行数限制是否生效

## 相关资源

### 官方文档
- [Codex CLI 命令行参数文档](https://developers.openai.com/codex/cli/reference)
- [Codex TUI Alternate Screen 说明](https://github.com/openai/codex/blob/main/docs/tui-alternate-screen.md)

### 相关 Issue 和 PR
- [PR #8555: 添加 tui.alternate_screen 配置和 --no-alt-screen 参数](https://github.com/openai/codex/pull/8555)
- [Issue #2558: Zellij 中 Codex 输出截断问题](https://github.com/openai/codex/issues/2558)
- [Issue #25412: Eclipse IDE 终端中 Codex 无法回滚](https://github.com/openai/codex/issues/25412)

### 技术背景
- xterm.js alternate screen 行为
- ConPTY scrollback 处理机制
- Terminal multiplexer（tmux/Zellij）与 alternate screen 的交互

## 后续工作

如果用户测试验证方案有效，可以考虑：

1. **优化设置 UI 提示**：
   - 在 `ThemeSettingsPage.tsx:282` 的提示文案中补充解决方案
   - 添加"如何配置 Codex 项目"的指引链接

2. **智能检测与建议**：
   - 检测到 Codex 项目时，自动提示用户配置 `--no-alt-screen`
   - 在项目配置弹窗中针对 Codex 显示推荐启动命令

3. **文档补充**：
   - 在 `CLAUDE.md` 或 README 中补充 Codex 最佳实践
   - 添加常见问题（FAQ）章节

---

**文档创建时间**: 2026-06-12  
**状态**: 待用户测试验证  
**相关 Issue**: 无（用户反馈）
