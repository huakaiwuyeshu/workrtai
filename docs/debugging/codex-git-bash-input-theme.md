# Codex + Git Bash 浅色主题输入区固定深色排查记录

日期：2026-06-27

## 问题现象

- CLI-Manager 终端设置为浅色背景后，只有 `Codex + Git Bash` 的 Codex 输入区仍固定显示深色。
- PowerShell + Codex、普通终端浅色背景不表现为同一问题。
- 早期尝试清理 xterm buffer 背景或 inverse 标记无效。

## 当前诊断（未完全闭环）

根因大概率不在 CSS，也不在 xterm 输入框自身。

Codex CLI 启动时会主动查询终端默认前景/背景色，并在 100ms 内等待 OSC 10/11 回复。`Git Bash + Windows ConPTY + CLI-Manager 前端异步回写` 这条链路不稳定，Codex 没拿到浅色背景后会退回 Windows 控制台默认色。该默认色通常是黑底，于是 Codex 自动选择深色 `catppuccin-mocha`，输入区也持续按深色主题绘制。

注意：截至 2026-06-27，命令级 theme 覆盖尝试仍未解决用户现象，所以上述仍是主要诊断假设，不可再标记为已闭环结论。

## 关键证据

- 当前 Codex 版本：`codex-cli 0.142.2`。
- npm shim 路径：
  - PowerShell：`D:\ProgramFiles\nodejs\codex.ps1`
  - Git Bash：`D:\ProgramFiles\nodejs\codex`
  - 最终都会启动 Windows 原生 `codex.exe`。
- Codex 源码定位：
  - `codex-rs/tui/src/terminal_probe.rs`
    - `DEFAULT_TIMEOUT = 100ms`
    - Windows 分支写入 `OSC 10/11` 查询，等待回复，失败后读取 console default colors。
  - `codex-rs/tui/src/terminal_palette.rs`
    - `default_bg()` 依赖 startup probe 缓存。
  - `codex-rs/tui/src/render/highlight.rs`
    - `default_bg()` 是浅色才选 `catppuccin-latte`。
    - 其他情况默认选 `catppuccin-mocha`。
- CLI-Manager 原实现：
  - `src/components/XTermTerminal.tsx` 只能在收到 PTY 输出后解析 OSC 查询，再用 `pty_write` 回写。
  - 这条路径依赖前端 listener、IPC、xterm 输出调度全部在 Codex 100ms 窗口内完成，不能作为可靠主题检测机制。

## 失败假设

| 假设 | 结果 | 原因 |
|---|---|---|
| xterm buffer 残留深色背景 | 否 | 清理 cell `bg` / inverse 后用户反馈仍固定深色 |
| CSS 输入框背景没跟随主题 | 否 | 只有 Codex + Git Bash 触发，不是通用 UI/CSS 问题 |
| Git Bash 初始输出 250ms 延迟是主因 | 非首要 | CLI-Manager 写启动命令前已有 500ms 延迟，Codex 查询发生在真正启动后 |
| 继续增强 OSC 回复即可 | 不稳 | Codex 只等 100ms，前端异步回写存在天然竞态 |
| `-c tui.theme=catppuccin-latte` | 否 | 用户反馈未修复；Codex 0.142.2 可见配置键更像顶层 `theme`，未知 `-c` 键可能静默忽略 |
| `-c theme=catppuccin-latte` | 否 | 该参数可被 `codex doctor` 接受，但实际 `Codex + Git Bash` 输入区仍固定深色，说明问题不只是启动参数名错误 |

## 已尝试修复（均未完全解决）

### 尝试 1：命令级 Codex theme 覆盖

采用 Codex 官方配置覆盖参数，绕过不可靠的自动背景检测。

2026-06-27 续查发现：上一版注入 `tui.theme` 仍未解决，原因是 Codex 0.142.2 的可见配置键为顶层 `theme`；未知 `-c` 键不会报错，旧参数可能被静默忽略。随后改为注入 `theme`，但用户反馈仍未修复，所以此方向也不能作为最终修复。

当满足以下条件时，CLI-Manager 写入 PTY 的启动命令会临时追加：

```bash
-c theme=catppuccin-latte
```

触发条件：

- 当前 shell 是 `gitbash`。
- 当前 CLI-Manager 终端背景是浅色。
- 启动命令是 direct `codex` 命令。
- 用户没有显式传入 `-c theme=...` / `--config theme=...`（也兼容旧判断 `tui.theme=...`）。

改动点：

- `src/lib/projectStartupCommand.ts`
  - 新增 `withCodexLightTuiTheme()`。
  - 保留已有 `--no-alt-screen` 归一化。
  - 已有 `theme` / `tui.theme` 配置时不重复追加。
- `src/stores/terminalStore.ts`
  - 新增 `prepareStartupCommandForPty()`。
  - 只在真正写入 PTY 前临时替换启动命令。
  - session 持久化仍保存用户原始命令，避免污染项目配置和历史会话。
- `src/components/XTermTerminal.tsx`
  - 移除上一轮无效的 inverse 标记清理补丁。

## 覆盖范围

会覆盖：

- 从侧边栏/命令面板打开 Codex 项目。
- 分屏打开 Codex 项目。
- 恢复已保存的 Codex 终端 session。
- 历史会话 resume 生成的 Codex 启动命令，只要 shell 是 Git Bash 且终端背景为浅色。

不会覆盖：

- 用户在普通 Git Bash prompt 中手动输入 `codex`。
- 外部终端启动。
- 深色终端主题。
- 用户已经显式指定 `theme` / `tui.theme` 的命令。

## 验证记录

- 已通过：

```bash
npx tsc --noEmit
codex -c theme=catppuccin-latte doctor --summary
```

- 说明：`doctor` 只能证明新配置覆盖参数可被 Codex 启动接受；2026-06-27 用户人工验收反馈：实际 TUI 视觉仍未修复。

- 未完成：

```bash
npm run build
```

第一次运行 124 秒超时，无明确错误输出。第二次运行被用户中断，因此不能声明 build 已通过。

## 手动验证清单

下次继续验证时按这个顺序：

1. 设置 CLI-Manager 终端为浅色主题。
2. 使用 Git Bash 打开 Codex 项目。
3. 确认 Codex 输入区不再固定深色。
4. 切回深色终端主题，再打开 `Codex + Git Bash`，确认不强制浅色。
5. 使用 PowerShell 打开 Codex，确认行为不受影响。
6. 使用显式命令 `codex -c theme="catppuccin-mocha"`，确认不会被重复追加 latte。
7. 从历史会话执行 `codex resume --no-alt-screen <sessionId>`，确认浅色 Git Bash 下同样生效。

## 下次排查注意事项

- 不要先改 CSS。这个问题是 Codex TUI 主题选择错误，不是页面样式没更新。
- 不要继续扩大 ANSI/xterm buffer 后处理。Codex 已选错主题时，前端清 cell 背景只能治标，且容易破坏真实 TUI 样式。
- 不要依赖 OSC 10/11 自动回复作为唯一修复。Codex 100ms 超时太短，CLI-Manager 的前端异步链路天然有竞态。
- 不要写用户的 `~/.codex/config.toml`。启动命令级 `-c` 覆盖已经尝试但未解决，不应升级成写用户全局配置。
- 不要杀不明 Node 进程。当前开发环境里同时存在大量 Codex/Node 进程，无法仅凭进程名判断是否属于构建。

## 后续可选优化

- 如果未来需要覆盖用户手动输入 `codex`，应设计明确的 Git Bash shell integration 或输入命令重写机制；这属于更高风险行为，不应混入当前修复。
- 下一轮优先验证：CLI-Manager 实际写入 PTY 的命令是否真的包含 `-c theme=catppuccin-latte`；如果包含但无效，应回到 Codex TUI 渲染/终端探测结果本身继续取证，而不是继续改参数名。
- 如果 Codex 后续提供环境变量级 theme 覆盖，可考虑改为环境变量注入，避免改写命令字符串。
