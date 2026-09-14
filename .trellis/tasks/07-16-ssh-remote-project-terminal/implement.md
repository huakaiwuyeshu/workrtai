# SSH 远程项目 / 远程终端执行计划

## 1. 实施目标

本执行计划只覆盖 P1 SSH 远程终端 MVP：SSH 主机管理、SSH 远程项目、远程路径选择/检测、系统 OpenSSH PTY、连接状态、恢复元数据，以及全应用能力降级。远程文件、Git、Worktree、历史、Hook 和统计不在本次实现范围。

## 2. 实施前置

- 总体设计已批准。
- UI 已批准，最终稿见 `ui/project-type-tabs-v3.png` 等页面。
- Changelog Target 为 `V1.3.0`，最终完成时更新 `CHANGELOG.md`。
- 实现前加载 `trellis-before-dev`，重新读取 frontend/backend spec index。
- 修改任何函数、类或方法前必须运行 GitNexus `impact`；当前 MCP 不可用时使用项目本地 GitNexus CLI。HIGH/CRITICAL 风险必须先告知用户。

## 3. Discovery List

### 数据与项目模型

- `src/lib/types.ts`：Project/CreateProjectInput/TerminalSession 类型。
- `src-tauri/src/lib.rs`：SQLite migration。
- `src/stores/projectStore.ts`：项目 CRUD、树构建、排序与分组。
- `src/components/ConfigModal.tsx`：新增/编辑终端表单。
- `src/lib/db.ts`：数据库初始化边界。

### 终端启动与恢复

- `src/stores/terminalStore.ts`：createSession、split、duplicate、restore、PTY invoke。
- `src-tauri/src/commands/terminal.rs`：`pty_create` IPC。
- `src-tauri/src/pty/manager.rs`：本地进程/PTTY 启动。
- `src-tauri/src/daemon/protocol.rs`、`client.rs`、`server.rs`：daemon 创建与 attach 协议。
- `src/lib/sessionSnapshotPersistence.ts`：会话快照。
- `src/components/TerminalTabs.tsx`、`XTermTerminal.tsx`：Tab 状态和连接反馈。

### 项目树与能力入口

- `src/components/sidebar/index.tsx`、`ProjectTree.tsx`、`TreeNodeItem.tsx`：项目打开、右键菜单、标识。
- `src/lib/terminalProject.ts`：项目/会话归属解析。
- `src/stores/fileExplorerStore.ts`、`gitStore.ts`、`worktreeStore.ts`：SSH 项目能力阻断。
- `src/components/files/FileExplorerSidebar.tsx`、`components/git/*`：统一不支持空态。
- `src/components/HistoryWorkspace.tsx`、统计入口：避免使用远程路径匹配本地历史。

### 设置、安全、同步与 i18n

- `src/components/SettingsModal.tsx`、`settings/pages/*`：SSH 主机页入口。
- `src-tauri/src/credential_store.rs`：未来凭据引用边界；MVP 不保存密码。
- `src/stores/syncStore.ts`、`src-tauri/src/sync/*`：同步过滤。
- `src/lib/i18n.ts`：zh-CN/en-US 文案。
- 日志模块：主机、认证和代理信息脱敏。

## 4. 分阶段实现

### Stage 1：领域模型与数据库

状态：已完成并通过阶段 review（2026-07-17）。验证：SSH migration 定向 Rust 测试、`cargo check`、`npx tsc --noEmit`。

1. 新增 `ssh_hosts` 表及索引。
2. 为 `projects` 增加 `environment_type`、`ssh_host_id`、`remote_path`。
3. 旧项目迁移为 `local`，不改变现有 `path` 行为。
4. 增加 TypeScript 类型、SSH Host store 和 CRUD。
5. 添加数据库迁移/修复路径测试。

验收：升级前项目列表、排序、分组和启动行为不变；SSH 主机可持久化但不含秘密。

### Stage 2：SSH 主机设置页

状态：已完成并通过阶段 review（2026-07-17）。验证：SSH 参数构建 Rust 单测、`cargo check`、`npx tsc --noEmit`；运行时视觉与真实服务器连接列入最终人工验收。

1. 设置导航增加“SSH 主机”。
2. 实现主机列表、手动分组、搜索、添加、编辑、复制、删除。
3. 实现基本信息、认证策略、跳板/代理、连接、初始化分区。
4. MVP 认证支持 SSH Config、Agent、IdentityFile、密码/交互询问；不保存密码。
5. 实现 OpenSSH 探测和结构化测试连接命令。

验收：配置、测试和错误诊断完整；敏感数据不进入 SQLite/日志。

### Stage 3：新增终端类型 Tab 与 SSH 项目

状态：已完成并通过阶段 review（2026-07-17）。验证：`npx tsc --noEmit`；最终人工验收需检查本地/SSH 草稿切换、编辑锁定类型和本地表单零回归。

1. 在现有 `ConfigModal` 顶部增加“本地项目 / SSH 远程项目”Tab。
2. 本地 Tab 保持现有字段、校验和行为。
3. SSH Tab 显示主机、远程路径、浏览/检测、公共 CLI 配置。
4. 两套草稿分别缓存，切换不丢输入。
5. SSH 项目隐藏 Shell/Worktree，展示 P1 能力提示。

验收：本地表单零回归；SSH 项目可创建、编辑、分组、排序和删除。

### Stage 4：远程目录浏览与检测

状态：已完成并通过阶段 review（2026-07-17）。验证：远程路径引用/遍历拒绝 Rust 单测、SSH command 单测、`cargo check`、`npx tsc --noEmit`；真实 SFTP/SSH 服务器行为列入最终人工验收。

1. 实现短生命周期 SSH/SFTP 浏览会话。
2. 支持路径输入、面包屑、目录列表、刷新和选择。
3. SFTP 不可用时降级为手工路径 + `ssh test -d`。
4. 检测目录存在、可进入和 Git 仓库状态，仅展示结果，不启用远程 Git 面板。
5. 认证过程不创建正式终端、不进入历史。

验收：Agent/私钥/密码交互均可选择路径；SFTP 禁用时仍可创建项目。

### Stage 5：SSH Terminal Launch Plan

状态：已完成并通过阶段 review（2026-07-17）。验证：SSH Launch Plan、命令转义、daemon 协议和兼容性 Rust 单测、`cargo check`、`npx tsc --noEmit`。

1. 定义结构化 SSH Launch Plan 和 IPC/daemon 协议字段。
2. Rust 根据 Host 配置生成 OpenSSH 参数，前端不拼 SSH 命令。
3. 使用安全 POSIX wrapper 进入 `remote_path` 并执行启动命令。
4. 本地 `ssh` 进程作为现有 PTY/daemon 根进程。
5. 处理 Host Key、认证、超时、远端退出和本地进程异常。

验收：从项目树、分屏、复制 Tab、批量启动等所有入口打开 SSH 项目均使用同一 Launch Plan。

### Stage 6：会话状态、恢复与后台任务

状态：已完成并通过阶段 review（2026-07-17）。验证：会话状态持久化、断开分类、daemon attach/退出恢复路径 review、`cargo test --lib`、`cargo check`、`npx tsc --noEmit`。

1. TerminalSession 持久化 environmentType/sshHostId/remotePath/connectionState。
2. Tab/hover/侧栏显示连接主机和状态。
3. daemon attach 存活 SSH PTY；已退出会话显示断开，不重跑启动命令。
4. 网络断开、远端 shell 退出、本地 ssh 退出分别分类。
5. 系统资源面板明确仍为“本机资源”。

验收：本地与 SSH 会话混合分屏、Workspan、退出和恢复正确。

### Stage 7：Capability Router 与全应用降级

状态：已完成并通过阶段 review（2026-07-17）。验证：全应用能力入口审计、SSH 空路径本地误匹配根因修复、文件/Worktree 硬拒绝 review、`cargo test --lib`、`npx tsc --noEmit`。

1. 增加项目运行环境能力解析器。
2. 文件、Git、Worktree、历史、Hook、统计、Provider 等入口统一查询能力。
3. SSH P1 禁止调用本地 fs/git/worktree/history API。
4. 提供统一“远程环境暂未支持”空态与说明。
5. 命令模板、项目分组、Tab、Pane、Workspan 保持可用。

验收：遍历 `scenario-matrix.md` 的功能矩阵，无任何远程路径误入本地接口。

### Stage 8：安全、同步、i18n 与收尾

状态：已完成并通过阶段 review（2026-07-17）。验证：同步字段白名单与重新绑定 review、SSH 参数日志脱敏、zh-CN/en-US 文案检查、`cargo test --lib`、`cargo check`、`npx tsc --noEmit`。

1. 日志脱敏和远程命令转义测试。
2. WebDAV/导出排除秘密与机器相关私钥路径，导入后要求重新绑定。
3. 补齐 zh-CN/en-US 文案和 aria。
4. 更新 `docs/功能清单.md` 与 `CHANGELOG.md` 的 `V1.3.0`。
5. 关联 Issue #145 的提交说明。

### Stage 9：SSH 主机配置根因返工

状态：代码实现完成，待人工桌面验收（2026-07-17）。

1. 按已确认的 `ui/hostform.png` 重构 SSH 主机编辑器，使用左侧分区导航、右侧单列配置区和固定底部操作栏。
2. 修复现有表单“展示了字段但没有写入生效模式”的数据断层：跳板主机必须同步 `jump_mode`，ProxyCommand 必须同步 `proxy_type`。
3. 根据连接来源、认证方式、跳板和代理模式动态展示有效字段，隐藏无效配置，避免用户保存互相冲突的参数。
4. 增加保存/测试前前端校验，并让连接诊断、错误状态和交互认证限制可理解。
5. 对齐新增终端 SSH 表单的视觉层级、选择器行为与中英文文案。

验收：SSH 主机配置不再是无语义的字段堆叠；用户可完成 SSH Config、Agent、私钥、密码/交互认证、跳板主机和 ProxyCommand 配置，测试连接后再保存并用于创建 SSH 远程项目。代码验收已完成：`npx tsc --noEmit`、`git diff --check`、GitNexus 变更审计；仍需人工验证 Windows 桌面视觉、真实 OpenSSH 连接和中英文切换。

### Stage 10：SSH 认证方式契约修复

状态：实施中（2026-07-17）。

1. 将 SSH Config 视为连接来源而非普通认证方式；Config 模式由 `~/.ssh/config` 管理用户、端口、认证、跳板和代理。
2. 手动连接仅提供 Agent、私钥、密码和 Keyboard-interactive；切换方式时清理不再生效的私钥等字段。
3. TypeScript 和 Rust 双层按 `auth_mode` 过滤 OpenSSH 参数，禁止旧私钥泄漏到 Agent、密码或交互认证。
4. 主机列表支持直接打开 SSH 终端，用于密码、MFA 和私钥口令交互。
5. 为 SSH Config、Agent、私钥、密码和 Keyboard-interactive 增加参数构建回归测试。

验收：UI 选中的认证方式与最终 `ssh` 参数严格一致；切换认证方式不会携带隐藏字段；无需先创建项目即可打开 SSH 主机终端完成交互认证。

补充 UI 约束：SSH 主机编辑器固定弹窗高度，取消左侧分区导航，改用顶部横向标签和纵向滚动联动；所有配置分区同时挂载，标签点击只负责定位，不再卸载字段状态。

### Stage 11：跨平台 SSH 密码凭据与 AskPass

状态：代码实现完成，待真实系统凭据库和 OpenSSH 人工验收（2026-07-17）。

1. 将 WebDAV 独立 keyring 初始化收敛到共享 `credential_store`，统一支持 Windows Credential Manager、macOS Keychain 和 Linux Secret Service。
2. SSH 密码模式增加系统凭据保存、状态检查、替换和删除 IPC；SQLite 仅保存 `credential_ref`。
3. 新增一次性 loopback AskPass broker：OpenSSH 子进程只接收随机令牌和本地地址，密码不进入命令行、普通环境变量、日志、数据库或同步数据。
4. 主程序与 daemon 均支持作为 AskPass helper 启动；未知提示拒绝自动回答，Keyboard-interactive/MFA 保持人工输入。
5. 新建连接测试使用临时凭据条目，测试结束立即删除；编辑时留空密码保留已有系统凭据。

验收：Windows/macOS/Linux 可保存 SSH 登录密码并由系统 OpenSSH 使用；WSL 原生运行时仅在 Secret Service 可用时支持保存，否则明确失败并保留终端询问模式。

### Stage 12：SSH 主机体验收敛与多级分组

状态：代码实现完成，待人工桌面验收（2026-07-17）。

1. SSH 主机新增/编辑弹框保持固定高度，取消左侧菜单，使用顶部横向标签与滚动联动；所有分区同时挂载，切换连接来源不丢失已输入字段。
2. 测试结果移动到底部“测试连接”按钮右侧，按测试中、成功、失败使用黄、绿、红区分；详细诊断通过按钮附近浮层查看。
3. 新建主机默认认证为“用户/密码”；保存密码走系统凭据库，连接测试和远程目录检测通过 AskPass 使用 `credential_ref`。
4. 新建 SSH 远程项目不再限制为 Agent/私钥；选择“用户/密码”的主机可以进行路径检测和目录浏览。
5. SSH 主机分组改为 `ssh_host_groups` 多级树，列表支持新增根分组、为任意分组新增子分组、删除分组时提升子分组和主机。
6. 新建 SSH 主机表单中的分组控件为可输入搜索的下拉框，选择多级分组路径；项目列表中的 SSH 项目不再显示额外 SSH 徽章。

验收：真实服务器上用户/密码测试连接、目录浏览、SSH 终端启动均可用；多级分组树展示和删除提升逻辑正确；弹框内错误与外层列表错误不重复；中英文切换后新增文案完整。

## 5. 验证顺序

1. 针对新增/修改 Rust 模块执行定向 `cargo test`。
2. `npx tsc --noEmit`。
3. `cd src-tauri && cargo check`。
4. `cd src-tauri && cargo test`。
5. 手工验证 Windows OpenSSH 直连、Agent、私钥、密码交互、首次指纹、ProxyJump、SFTP 禁用、断网和恢复。
6. 手动切换 zh-CN/en-US，确认 24 小时制。
7. GitNexus `detect_changes({scope: compare, base_ref: master})` 或本地 CLI 等价检查。

不主动运行 `npm run dev/build` 或 `npm run tauri dev/build`，除非用户在当前轮明确要求。

## 6. 风险与回滚点

- 数据迁移风险：Stage 1 单独提交，确保可回滚且旧项目默认 local。
- PTY/daemon 高风险：Stage 5/6 分离提交，协议保持向后兼容。
- 命令注入风险：远程路径和启动命令必须经过专用构建器和测试，不允许组件字符串拼接。
- 能力误路由风险：Stage 7 在开放 UI 入口前完成。
- 跨平台风险：Windows 为 P1 首要验收平台；macOS/Linux 保持设计兼容但不虚假宣称已验证。

## 7. 进入实现条件

- [x] PRD 已批准。
- [x] 总体设计已批准。
- [x] UI 已批准。
- [x] `Changelog Target` 已记录。
- [x] 用户审阅并批准本 `implement.md`。
- [x] 执行 `task.py start`，进入 in_progress。
