# Codex Windows 滚动条问题排查时间线

> 时间统一按北京时间（UTC+8）整理。资料来源为 Claude/Codex 会话日志与最终修复会话记录。

## 一句话结论

Codex 在 CLI-Manager 内置 xterm.js 里“部分机器无滚动条/无法回滚”的根因，不是单纯的 `--no-alt-screen`、CSS、xterm `scrollback` 配置或 Shell 差异，而是 **Windows ConPTY/OpenConsole 版本差异影响了 Codex TUI 重绘序列如何传递给 xterm.js**。

最终修复不是继续在前端拦截 ANSI 序列，而是随包侧载新版 Windows Terminal 的 `conpty.dll` 与 `OpenConsole.exe`，让 `portable-pty` 优先使用新版 ConPTY；如果随包资源不存在，则自动回退系统默认 ConPTY。

## 涉及日志

| 日志 | 用途 | 备注 |
|---|---|---|
| `C:\Users\Administrator\.codex\sessions\2026\06\28\rollout-2026-06-28T22-47-26-019f0eb3-18b6-79a1-909f-bce8f3b983c6.jsonl` | 早期诊断与失败修复尝试 | 用户给出的 `.claude\projects\...\019f0eb3...jsonl` 路径不存在，实际在 Codex sessions 下 |
| `C:\Users\Administrator\.claude\projects\D--work-pythonProject-CLI-Manager\6bbfd392-3cc5-4aab-bc44-c6002643e494.jsonl` | 7 月 2 日主排查链路 | 从版本差异假设修正到 ConPTY/ANSI 序列方向 |
| `C:\Users\Administrator\.claude\projects\D--work-pythonProject-CLI-Manager\448ff5f0-ae26-4c13-b3df-4e7104418dd4.jsonl` | 性能排查与 ED3 残留回滚 | 确认前端 ED3/scrollback 方案残留被回滚 |
| `C:\Users\Administrator\.codex\sessions\2026\07\08\rollout-2026-07-08T11-02-51-019f3fad-9f43-77f3-ad8f-c0aefc7e8fb7.jsonl` | 最终解决方案实现 | 侧载新版 ConPTY/OpenConsole 并提交 |

## 问题现象

| 现象 | 说明 |
|---|---|
| 部分用户运行 Codex 时没有外层滚动条 | Codex 输出看似一直在当前屏幕刷新，无法滚回历史 |
| 另一些用户滚动正常 | 软件配置、Codex 配置看起来大致相同 |
| 手动运行 `codex --no-alt-screen` 仍不稳定 | 说明问题不是“参数没有注入”这么简单 |
| Shell 对照不能解释问题 | Git Bash 与 PowerShell 都复现过无 scrollback 增长 |

## 时间线

### 2026-06-28：第一轮排查，确认不是 CSS/scrollback 配置

| 时间 | 节点 | 结论 |
|---|---|---|
| 2026-06-29 00:18 | 给 `XTermTerminal.tsx` 增加滚动诊断日志 | 记录 xterm buffer、`baseY`、`normalBaseY`、fit/resize、控制序列统计 |
| 2026-06-29 00:21 | 用户要求 dev 日志单独写到 `cli-manager-dev.log` | 避免开发版和安装版日志混在一起 |
| 2026-06-29 00:25 | Rust 端日志文件名调整完成 | debug/dev 写 `cli-manager-dev.log`，release 写 `cli-manager.log` |
| 2026-06-29 00:35 | 第一次读取 dev 日志 | 日志生效，但只有低价值控制序列，无法判断 scrollback |
| 2026-06-29 00:36 | 调整诊断策略 | dev 构建默认记录滚动诊断，高价值 chunk 不再被节流吞掉 |
| 2026-06-29 00:42 | 分析 Git Bash 日志 | PTY 输出进入 xterm，但 `baseY=0`、`normalBaseY=0`，没有形成 scrollback |
| 2026-06-29 00:49 | 分析 PowerShell 日志 | PowerShell 与 Git Bash 一样，排除 Shell 差异 |

关键证据：

| 指标 | 观察 |
|---|---|
| `altScreenEnter=0` | `--no-alt-screen` 生效，Codex 没有进入 alternate screen |
| 输出字符数约 15 万到 16 万 | PTY 输出没有丢 |
| LF/CR/擦行/光标定位大量出现 | Codex 在做 TUI 重绘 |
| `maxBaseY=0`、`maxNormalBaseY=0` | xterm 没有任何行真正滚出 viewport |

当时的结论：

Codex 即使带了 `--no-alt-screen`，在 CLI-Manager 当前 xterm/ConPTY 环境里仍然采用“定位光标 + 擦行 + 重画屏幕”的 inline TUI repaint 模式。xterm 只看到当前 viewport 被反复重绘，没有行进入 scrollback，所以外层滚动条不会增长。

### 2026-06-29：尝试 `TERM=dumb`，失败后撤回

| 时间 | 节点 | 结论 |
|---|---|---|
| 2026-06-29 00:52 | 用户要求修复 | 选择最小修复方向：只针对 Codex PTY 调整环境 |
| 2026-06-29 00:55 | 给 Codex 会话注入 `TERM=dumb` | 目标是迫使 Codex 退出 TUI repaint 模式，产生普通追加式输出 |
| 2026-06-29 00:57 | TypeScript 检查通过 | 代码层面可编译 |
| 2026-06-29 01:00 | 用户反馈仍然一样无法滚动 | `TERM=dumb` 没解决实际问题 |
| 2026-06-29 01:00-01:06 | 按要求撤回诊断日志与 `TERM=dumb` 改动 | 保留 dev 日志文件名改动，不保留失败修复 |

这一阶段的价值：

| 排除项 | 结果 |
|---|---|
| CSS 滚动条样式 | 排除，因为 xterm buffer 本身没有增长 |
| xterm `scrollback` 配置 | 排除，配置存在但没有可进入 scrollback 的行 |
| Git Bash | 排除，PowerShell 同样复现 |
| `--no-alt-screen` 未生效 | 排除，日志显示没有进入 alternate screen |
| `TERM=dumb` 环境降级 | 尝试失败，撤回 |

### 2026-07-02 14:13：第二轮排查，最初误判为版本/参数注入问题

| 时间 | 节点 | 结论 |
|---|---|---|
| 2026-07-02 14:13 | 用户提出“有些用户有滚动条，有些没有” | 附带 OpenAI Codex issue 与 xterm.js issue |
| 2026-07-02 14:16 | 查看旧任务 `06-23-codex-force-scrollbar` | 旧目标是给 Codex 自动加 `--no-alt-screen` |
| 2026-07-02 14:20-14:28 | 对比提交 `4bee23f`、`ece1557`、`3cfd10c` | 发现 `--no-alt-screen` 自动注入逻辑曾被删 |
| 2026-07-02 14:34 | 初始结论 | 误判为 V1.2.3 删除 `--no-alt-screen` 注入导致用户差异 |
| 2026-07-02 14:39 | 用户纠正：手动 `codex --no-alt-screen` 仍没滚动条 | 排除“只要恢复参数注入即可”的方向 |

刚开始的排查思路：

1. 认为 Codex 默认进入 alternate screen，而 xterm.js 备用缓冲区没有 scrollback。
2. 怀疑 `--no-alt-screen` 自动注入在某个版本被误删。
3. 用提交历史与 CHANGELOG 还原版本差异。
4. 初步把“用户间差异”归因到 CLI-Manager 版本不同。

这个思路后来被推翻，因为用户明确说明：手动 `codex --no-alt-screen` 仍然无法滚动。

### 2026-07-02 14:41：排查思路修正为 ANSI 序列与 ConPTY 差异

| 时间 | 节点 | 结论 |
|---|---|---|
| 2026-07-02 14:41 | 修正结论 | `--no-alt-screen` 只能避免 alternate screen，不能保证 scrollback |
| 2026-07-02 14:48 | 查看 PTY 读取循环 | 当时没有足够原始字节流日志，难以直接对比两台机器 |
| 2026-07-02 14:48 | 提出关键外部变量 | Windows 11 具体 build / ConPTY 行为差异成为头号嫌疑 |
| 2026-07-02 15:03-15:08 | 给 Rust PTY 增加 VT 诊断 | 统计 `?1049h/l`、`2J`、`3J`、DECSTBM、RI 等序列 |

修正后的判断：

| 机制 | 说明 |
|---|---|
| ED2 / `CSI 2J` | 清屏；xterm.js 在 `scrollOnEraseInDisplay: true` 下可把当前屏幕推进 scrollback |
| ED3 / `CSI 3J` | 清空 scrollback；如果 Codex 高频发 ED3，刚推进的历史会被立刻清掉 |
| ConPTY/OpenConsole | 不同 Windows build 对 TUI 控制序列的合成、透传、节奏存在差异 |

### 2026-07-02 晚间：形成前端 ED3/区域滚动方案，但后来被回滚

| 时间 | 节点 | 结论 |
|---|---|---|
| 2026-07-02 18:53 左右 | 形成 ED3 方向记录 | 认为 Codex 在普通缓冲区发 ED2 + ED3，xterm 严格执行 ED3 清空 scrollback |
| 2026-07-02 18:54-18:59 | 扩展为两层前端方案 | 只拦 ED3 还不够，还考虑改写 `DECSTBM + SU` 区域滚动 |
| 2026-07-02 19:23-19:27 | 用户要求回滚 Codex ED3 scrollback 残留 | 删除前端 ED3/scrollback suppression、相关 CHANGELOG 和说明文档残留 |

为什么这个方案没有成为最终方案：

| 问题 | 说明 |
|---|---|
| 方案太偏前端补丁 | 需要 xterm parser hook 拦截/改写 Codex 特定 ANSI 序列 |
| 风险面不低 | 容易影响普通 `clear`/`cls` 语义，或引入重复帧/历史不完整 |
| 不能真正统一底层行为 | 不同 Windows ConPTY 的差异仍然存在，只是在前端补救 |
| 用户要求回滚残留 | 最终没有保留该前端方案作为解决办法 |

### 2026-07-08 11:06：最终排查思路转向运行时 ConPTY 统一

| 时间 | 节点 | 结论 |
|---|---|---|
| 2026-07-08 11:10 | 重新读取 `terminal.rs`、`manager.rs`、`XTermTerminal.tsx` 等关键文件 | 确认 xterm 侧已有 `scrollOnEraseInDisplay` 等设置，问题不应继续靠 UI 猜 |
| 2026-07-08 11:11 | 明确要确认两件事 | `portable-pty` 是否能被 PATH/进程环境影响 ConPTY 加载；xterm 当前是否已启用相关能力 |
| 2026-07-08 11:12-11:16 | 阅读本地 `portable-pty 0.8.1` Windows 实现源码 | 确认 `portable-pty` 自身存在侧载 `conpty.dll` 的逻辑 |
| 2026-07-08 11:16 | 查询 Tauri 资源打包方式与 Windows Terminal 官方 release | 确认资源可以通过 `bundle.resources` 打入应用包 |
| 2026-07-08 11:17 | 下载并检查官方 ConPTY nupkg | 包含 x86/x64/arm64 的 `conpty.dll` 与 `OpenConsole.exe` |

最后的排查思路：

1. 不再尝试让 Codex 输出“变得像普通文本”。
2. 不再在前端强行拦截/改写 Codex ANSI 序列。
3. 把差异收敛到 Windows ConPTY/OpenConsole 运行时版本。
4. 让所有用户随 CLI-Manager 使用同一套新版 ConPTY/OpenConsole。
5. 只在随包资源完整存在时启用；失败时回退系统默认，避免启动失败。

### 2026-07-08 13:40-13:58：最终解决方案实现并提交

| 时间 | 节点 | 结果 |
|---|---|---|
| 2026-07-08 13:40 | 下载 Windows Terminal `v1.24.11321.0` 的 `Microsoft.Windows.Console.ConPTY.1.24.260512001.nupkg` | 提取 x64/x86/arm64 资源并生成 SHA256 |
| 2026-07-08 13:40 | 新增 `src-tauri/resources/conpty/README.md` | 记录来源 URL、包 SHA256、各文件 SHA256 |
| 2026-07-08 13:41 | 新增 `src-tauri/src/conpty_sideload.rs` | Windows 启动时解析随包资源目录 |
| 2026-07-08 13:42 | 修改 `src-tauri/src/lib.rs` | 在 Tauri `setup` 最前调用 ConPTY 侧载初始化，早于任何 PTY 创建 |
| 2026-07-08 13:42 | 修改 `src-tauri/tauri.conf.json` | 增加 `"resources": ["resources/conpty/**/*"]` |
| 2026-07-08 13:43 | 更新文档 | 记录 Windows 内置终端运行时兜底行为 |
| 2026-07-08 13:46 | `cargo test` | 通过 |
| 2026-07-08 13:50 | 总结验证 | `npx tsc --noEmit`、`cargo check`、`cargo test` 均通过 |
| 2026-07-08 13:58 | 提交 | `67afe83 fix(terminal): 侧载新版 ConPTY 修复 Codex 滚动条` |

## 最终解决办法

### 方案结构

| 层级 | 做法 |
|---|---|
| 资源层 | 随包加入 Windows Terminal 官方 ConPTY/OpenConsole 资源 |
| 打包层 | Tauri `bundle.resources` 打包 `src-tauri/resources/conpty/**/*` |
| 启动层 | Tauri `setup` 阶段最早初始化，确保早于任何 PTY 创建 |
| 运行层 | 按当前架构选择 `resources/conpty/{arch}` |
| 加载优先级 | 把随包目录插到进程 `PATH` 最前 |
| 回退策略 | 随包缺失、架构不支持或解析失败时，不改 PATH，继续使用系统 ConPTY |

### 运行时逻辑

```text
应用启动
  -> 解析 Tauri Resource 目录
  -> 选择 resources/conpty/{x64|x86|arm64}
  -> 检查 conpty.dll 和 OpenConsole.exe 是否同时存在
  -> 存在：目录前置到进程 PATH
  -> 不存在：不修改 PATH，回退系统默认
  -> portable-pty 创建 PTY
  -> Windows DLL 搜索优先命中随包 conpty.dll
```

### 最终代码落点

| 文件 | 作用 |
|---|---|
| `src-tauri/src/conpty_sideload.rs` | 新增 Windows ConPTY 侧载初始化逻辑 |
| `src-tauri/src/lib.rs` | 在 Tauri `setup` 最前调用初始化 |
| `src-tauri/tauri.conf.json` | 将 `resources/conpty/**/*` 加入 Tauri 打包资源 |
| `src-tauri/resources/conpty/README.md` | 记录资源来源和 SHA256 |
| `src-tauri/resources/conpty/{x64,x86,arm64}/` | 存放对应架构的 `conpty.dll` 和 `OpenConsole.exe` |

## 问题原因还原

### 表层原因

Codex 没有产生 xterm 可自然滚动的历史行。它大量使用 TUI 重绘序列，例如光标定位、擦行、清屏、清回滚、区域滚动等。xterm 看到的是“当前 viewport 被反复改写”，不是“文本不断追加并滚出 viewport”。

### 深层原因

不同 Windows 版本内置的 ConPTY/OpenConsole 对这些序列的处理和转发行为不一致，导致同样的 Codex、同样的 CLI-Manager、同样的 xterm 配置，在不同机器上可能呈现不同 scrollback 结果。

### 为什么之前的方向不够

| 方向 | 结论 |
|---|---|
| 恢复 `--no-alt-screen` 注入 | 不够；手动执行仍可能无滚动条 |
| 增大 xterm scrollback | 无效；没有行进入 scrollback |
| 改 CSS 滚动条 | 无效；不是滚动条隐藏，而是 scrollback 没增长 |
| 换 Git Bash/PowerShell | 无效；两者都复现过 |
| `TERM=dumb` | 尝试失败并撤回 |
| 前端拦 ED3/改写区域滚动 | 能解释一部分机制，但风险高、残留被回滚，不作为最终方案 |

## 最终判断

最终方案的本质是 **统一 Windows PTY 运行时**，而不是继续追 Codex 的每一种 ANSI 输出形态。

这样做的优点：

| 优点 | 说明 |
|---|---|
| 改动边界清晰 | 只影响 Windows 内置终端 PTY 初始化 |
| 不改 Codex 命令语义 | 不强制 `TERM=dumb`，不篡改用户输入 |
| 不污染普通终端 ANSI 行为 | 不在 xterm 前端全局拦截 `ED3` 或区域滚动 |
| 可回退 | 资源缺失时继续使用系统默认 ConPTY |
| 可验证 | 资源 SHA256、Tauri 打包配置、`cargo check/test` 都可检查 |

## 已验证项

| 验证 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| `cd src-tauri && cargo check` | 通过 |
| `cd src-tauri && cargo test` | 通过 |
| `git commit` | `67afe83 fix(terminal): 侧载新版 ConPTY 修复 Codex 滚动条` |

## 仍需注意

| 项目 | 说明 |
|---|---|
| 未实际解包安装包复核 | 最终会话里明确说明没有跑 `tauri build` 解包检查产物，打包结论基于 Tauri `resources` 配置 |
| 三架构都会打包 | 当前配置会把 x64/x86/arm64 全部打进资源目录，不只打当前架构 |
| 已有 PTY 不会 retroactive 生效 | 需要重启应用或至少确保新 PTY 创建发生在 PATH 前置之后 |
| 如果未来升级 `portable-pty` | 需要重新确认其 Windows ConPTY 加载逻辑是否仍受 PATH/侧载目录影响 |
