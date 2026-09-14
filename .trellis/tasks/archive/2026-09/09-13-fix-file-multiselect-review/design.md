# 技术设计

## 变更边界

本任务是根因修复，触及前端 Zustand 状态、Rust 文件系统边界和两层测试。预计修改：

- `src/features/files/api/fileExplorerStore.ts`：在 `renameEntry` 的成功提交点同步选中项路径，确保选择状态由实际重命名结果驱动。
- `scripts/fileExplorerBatchStore.test.mjs`（或同一文件浏览器 store 测试入口）：验证成功与失败两条状态路径。
- `src-tauri/src/features/files/commands.rs`：将移动祖先判断抽取为遵循平台大小写语义的纯路径比较，供两个方向的 containment guard 使用。
- `src-tauri/src/features/files/commands/security_tests.rs`：增加大小写边界测试和平台语义测试，避免覆盖目标在保护检查前被删除。
- `CHANGELOG.md`、`docs/功能清单.md`：按用户指定的 `V1.4.0` 记录实际修复。

明确不修改 `file_rename` 的符号链接行为、IPC 参数、文件复制逻辑和其他文件浏览器交互。

## 根因与数据流

### 前端选择状态

`renameEntry(path, newName)` → `invoke("file_rename")` → 目录/编辑器刷新 → Zustand 状态提交 → 行键盘批量操作读取 `selectedEntries`。

根因在状态提交层：重命名完成后只更新目录和编辑器，没有把同一条状态记录的身份从旧相对路径迁移到新相对路径。修复落在 `renameEntry` 成功分支，而不是在 Delete/Ctrl-X/Ctrl-C 消费端加失效路径兜底。

### Rust 移动安全

Tauri `file_move` → `resolve_mutation_source` / `resolve_named_target` → `move_path` → ancestor guards → `prepare_target` → `fs::rename`。

根因在 Rust 的 containment predicate：`Path::starts_with` 是大小写敏感的纯路径方法，不能直接表达 Windows 文件系统的大小写不敏感语义。修复落在 `move_path` 删除目标前的共享路径比较；Rust 仍是 WebView 之外的最终安全边界。

## 设计决策

1. 前端仅在 `file_rename` 成功、刷新完成前后的现有提交路径中迁移精确匹配的选中条目；失败、冲突或空名称均不改变选择。
2. Rust 使用纯、可测试的组件前缀比较 helper。原生 Windows 采用大小写折叠，WSL UNC 与 POSIX 保持精确比较；比较以完整路径组件为单位，避免 `foo` 与 `foobar` 的前缀误判。
3. `move_path` 先判断平台语义下的同路径/祖先关系，再调用现有 `ensure_distinct_source_target` 与 `prepare_target`，保留既有错误和覆盖流程。
4. 不把前端的 `ignoreCase` 判断当作安全边界；前端测试验证行为，Rust 测试验证实际删除前的防护。

## 兼容与回滚

- 不改变前端公开 store 方法签名和 Tauri command 名称/参数。
- 纯路径 helper 的失败只会阻止不安全移动，不改变安全路径的复制、删除和普通重命名行为。
- 若验证发现平台语义不兼容，可回滚本任务新增的 helper/状态提交及对应测试，不需要数据迁移或配置回滚。
