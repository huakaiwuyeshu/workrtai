# 执行计划

## Phase 1：进入实现前检查

- [x] 已完成分支与上游只读同步检查：`master` 与 `origin/master` 同步。
- [x] 已读取前端状态、质量、类型、架构、注释契约及 Rust 文件命令、安全、目录和注释契约。
- [x] 已完成根因陈述、触点清单和场景矩阵；第三项符号链接重命名明确排除。
- [x] 用户批准本规划摘要后，创建/切换到基于 PR #259 head 的修复分支并启动任务。

## Phase 2：实现顺序

1. 在 PR #259 head 上重新建立 GitNexus 索引，分别对 `renameEntry` 与 `move_path` 执行 upstream impact；确认共享 store、文件侧栏和 Rust 命令触点。
2. 修改 `renameEntry` 成功状态提交，迁移精确匹配的 `selectedEntries` 条目到新路径/名称；保持失败路径不变。
3. 增加前端 store 回归测试，覆盖成功重命名后的选择迁移和 IPC 失败后的选择保留。
4. 在 Rust `commands.rs` 增加平台语义组件前缀比较 helper，并将 `move_path` 的祖先检查接入 helper；保留现有同路径和子目录保护。
5. 在 `security_tests.rs` 增加 Windows 大小写祖先覆盖测试及纯 helper 的大小写敏感/不敏感测试。
6. 更新 `CHANGELOG.md` 的 `V1.4.0` 与 `docs/功能清单.md` 文件浏览器板块。

## Phase 2：验证

- `node --test scripts/fileExplorerBatchStore.test.mjs scripts/fileExplorerMultiSelect.test.mjs scripts/fileExplorerMultiSelectUi.test.mjs`
- `npx tsc --noEmit --pretty false`
- `npm run check:architecture -- --strict`
- `npm run build`
- `cd src-tauri && cargo test --locked --lib commands::security_tests`
- `cd src-tauri && cargo test --locked --lib`
- `rustfmt --edition 2021 --check` 修改的 Rust 文件
- `git diff --check`
- `gitnexus_detect_changes`：确认只影响预期文件/流程。

## 风险与回滚点

- 高风险文件：`fileExplorerStore.ts`、`commands.rs`；每完成一层立即运行对应定向测试。
- 若前端测试暴露 store harness 不能覆盖重命名，应仅扩展现有 harness，不新建并行状态实现。
- 若 Windows helper 与 WSL 路径语义冲突，先保留纯 helper 测试失败证据，停止扩展范围并修正设计，不通过前端绕过 Rust 校验。

## Phase 3：交付

- [x] `task.py validate` 通过并启动任务。
- [x] 完成质量检查和 GitNexus 变更检测。
- [x] 更新任务进度/日志，记录未执行的人工 UI 验证。
- [x] 提交前确认 `CHANGELOG.md` 与 `docs/功能清单.md` 修复记录均为 `V1.4.0`。
