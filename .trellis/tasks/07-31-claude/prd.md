# 修复 Claude 子任务转录渐进加载

## Goal

修复本地 Claude Code 子任务在 Worktree 场景订阅错误 transcript、接近结束才一次性显示内容的问题，使运行中输出持续增量展示，并避免 `AgentToolStop` 提前结束或关闭仍在运行的子任务面板。

## Requirements

- `AgentToolStop` 仅用于创建、更新或升级子任务 transcript，不得调用 `finishSubagentTranscript`。
- 只有 `SubagentStop` 或现有 Codex JSONL 终态记录可以结束子任务面板。
- 缺少显式 `agentTranscriptPath` 时，后端优先从父 `transcriptPath` 推导 `<父会话目录>/subagents/agent-<agentId>.jsonl`。
- 仅当父 transcript 路径缺失时，才回退现有 `cwd + sessionId + agentId` 推导。
- 显式 child 路径保持最高优先级；父路径必须经过现有允许根、Windows/WSL 路径规范化及 session 一致性校验。
- 正确的派生路径即使文件尚未创建也应立即开始 tail，文件出现后按完整 JSONL 行增量推送。
- 不修改 transcript 渲染器、Codex rollout、SSH 远程 transcript、历史解析、数据库或依赖。

## Acceptance Criteria

- [ ] `AgentToolStop` 后面板保持运行中且不创建自动关闭计时器。
- [ ] Claude Worktree 场景不再生成包含 `.claude-worktrees-agent-*` 的 projects slug。
- [ ] 子 JSONL 在任务结束前写入完整行后，界面在正常轮询时间内显示内容。
- [ ] 并发多个子 Agent 各自更新对应 Tab，不串流、不重复创建面板。
- [ ] `SubagentStop` 晚到显式 child 路径时仍先回填内容，再标记结束。
- [ ] Windows、本机 POSIX、WSL UNC/Linux 与显式 child 路径行为无回归。
- [ ] Rust 相关测试、全量 Rust 测试、`cargo check`、TypeScript 类型检查和 `git diff --check` 通过。

## Definition of Done

- 产品代码、Rust 回归测试、CLI Hook 契约和 `[TEMP]` Changelog 同步完成。
- GitNexus `detect_changes` 仅命中预期的 Hook/子任务 transcript 范围。
- 不引入新依赖、迁移、用户可见文案或国际化键。

## Technical Approach

- 前端把 `AgentToolStop` 路由为 `openSubagentTranscript`，不再调用 finish。
- `subagent_transcript_subscribe` 新增可选 `parentTranscriptPath`，返回结构保持不变。
- Rust 路径优先级固定为：显式 child 路径 → 父 transcript 推导 → cwd 兼容回退。
- 父路径去掉 `.jsonl` 后拼接 `subagents/agent-<agentId>.jsonl`，复用现有路径规范化与边界校验。

## Decision (ADR-lite)

**Context**: 子 Agent 的 Hook `cwd` 指向临时 Worktree，但 Claude 实际将 child JSONL 存在父项目会话目录；同时 `AgentToolStop` 在异步子任务仍运行时即可到达。

**Decision**: 使用父 transcript 作为派生路径权威来源，并将 `AgentToolStop` 降为发现/更新提示。

**Consequences**: 修复运行中流式展示；旧 Claude 若缺少 `SubagentStop`，面板可能保留到用户手动关闭，但不会再提前丢失输出。

## Out of Scope

- AI Replay 唯一键错误。
- Hook `unsupported_payload` 诊断。
- Codex、SSH、历史会话解析或 transcript 渲染性能重构。

## Technical Notes

- Approved implementation plan: `.claude/plan/fix-claude-subagent-transcript-streaming.md`.
- Relevant contract: `.trellis/spec/backend/cli-hook-contracts.md`, `Scenario: Sub-Agent Transcript Hook`.
- Changelog Target: `[TEMP]`.
