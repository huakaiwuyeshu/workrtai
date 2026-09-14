# Agent Workbench 实施契约（基于 CLI-Manager）

本文是 [`多模型session通信-设计方案.md`](./多模型session通信-设计方案.md) 的工程实施补充。它把“人工接力”和“主 Agent/子 Agent”压缩成一套可测试的本地契约，按 PR-6、PR-7 实现即可。

## 1. 最终运行形态

```text
CLI-Manager Workspan
  ├─ Codex / Claude / agy / Grok 原生 CLI session
  ├─ WorkbenchPanel（CLI-Manager fork 的可选面板）
  └─ Workbench Bridge（本地 TypeScript 进程）
       ├─ CLI-Manager daemon adapter（创建、写入、attach、回放）
       ├─ Pattern Runtime（DAG、轮次、质量门、预算）
       ├─ Task Registry（Workbench SQLite）
       ├─ Workbench MCP（模型调用 create/post_result 等工具）
       └─ Concord MCP（presence、prompt/reply、claim、通知）
```

Bridge 是唯一的任务编排进程，CLI-Manager 仍然拥有 PTY、pane、Workspan、restore 和 focus。Bridge 崩溃不会杀掉 CLI session；重启时从 SQLite checkpoint 和 Concord presence 重建绑定。

## 2. 模块边界和目录

```text
orchestrator/
├─ src/bridge.ts                         # 进程入口、恢复、事件循环
├─ src/runtime/pattern-runtime.ts        # 声明式 pattern 执行器
├─ src/registry/task-registry.ts         # SQLite 事务和状态机
├─ src/mcp/workbench-server.ts           # 给各 CLI 暴露的本地 stdio MCP
├─ src/adapters/cli-manager-daemon.ts    # NDJSON daemon 适配器
├─ src/adapters/concord.ts               # presence / prompt / reply / notify
├─ src/executors/browser.ts              # Playwright；截图/日志作为 artifact
├─ src/policies/authorization.ts         # owner、scope、工具和预算校验
├─ schemas/task.schema.json
├─ schemas/event.schema.json
└─ patterns/
   ├─ manual_handoff.yaml
   ├─ document_review.yaml
   └─ child_task.yaml
```

模型只访问 `workbench` MCP 和 Concord MCP；不得直接写 SQLite、调用 daemon 或伪造 `agent_id`。CLI-Manager fork 只通过 Tauri command 调 Bridge，不把业务编排写进前端。

## 3. Workbench SQLite v1

数据库路径：`.workbench/workbench.sqlite`，WAL 模式，单写者事务。每个写操作都带 `idempotency_key`，重复提交返回原事件。

```sql
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  parent_task_id TEXT REFERENCES tasks(task_id),
  type TEXT NOT NULL CHECK(type IN ('review_task','handoff_task','child_task','integration_task')),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','review','completed','blocked','failed','cancelled')),
  assigned_cli TEXT,
  assigned_model TEXT,
  allowed_paths_json TEXT NOT NULL,
  allowed_tools_json TEXT NOT NULL,
  success_criteria_json TEXT NOT NULL,
  callback_agent_id TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE task_agents (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  session_ref TEXT NOT NULL,
  cli_manager_session_id TEXT,
  concord_agent_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('main','reviewer','child','critic','verifier','synthesizer')),
  bound_at TEXT NOT NULL,
  unbound_at TEXT,
  PRIMARY KEY(task_id, session_ref)
);

CREATE TABLE task_artifacts (
  artifact_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  kind TEXT NOT NULL,
  path TEXT,
  sha256 TEXT,
  content_json TEXT,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  resumable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
```

状态只允许以下转移：

```text
pending -> running -> review -> completed
                    ├-> blocked
                    ├-> failed
                    └-> cancelled
```

重试不能覆盖旧事件；必须创建新 `task_events`，并保留失败 artifact 和原因。

## 4. Bridge MCP 工具契约

Bridge 以本地 stdio MCP 暴露以下工具；输入输出使用 JSON Schema，未知字段拒绝。

```text
create_task({ type, parent_task_id?, title, assigned_cli, assigned_model,
              allowed_paths, allowed_tools, success_criteria,
              callback_agent_id?, depends_on? })
  -> { task_id, status: "pending", version }

dispatch_task({ task_id })
  -> { task_id, status: "running", session_ref, cli_manager_session_id? }

post_progress({ task_id, message, percent?, artifact_ids? })
  -> { event_id, status: "running" }

post_result({ task_id, status, summary, changed_files, evidence,
              blockers?, next_actions?, artifact_ids?, result_version })
  -> { event_id, status: "completed" | "blocked" | "failed" }

get_task({ task_id }) -> { task, children, events, artifacts }
evaluate_gate({ task_id, gate_id }) -> { passed, missing, evidence }
checkpoint({ run_id }) -> { checkpoint_id, resumable: true }
```

`post_result` 的 `result_version` 和 `idempotency_key` 组合唯一。Bridge 先提交 SQLite 事务，再通过 Concord 向 `callback_agent_id` 发送摘要；通知失败时任务仍保留终态，恢复循环会重放通知。

## 5. 两种场景的确定性流程

### 场景一：人工接力审查

1. A 调用 `create_task(type=review_task, assigned_cli=B)`，状态为 `pending`。
2. 人在 WorkbenchPanel 确认 B；Bridge `dispatch_task` 绑定已有 B session，或经 daemon 创建并绑定新 pane。
3. B `start_work` 注册 Concord presence，读取任务包，只读检查 A 的 artifact，调用 `post_result(completed, ...)`。
4. Bridge 写入报告 artifact 和 `task.completed`，向 A 的 `callback_agent_id` 发 Concord 通知。
5. A 通过 `get_task` 读取报告，修复并重新运行质量门；人决定是否切换到 C/D。

### 场景二：主 Agent 委派子任务

1. A 调用 `create_task(type=child_task, parent_task_id=A任务, allowed_paths, allowed_tools, success_criteria)`。
2. Bridge 校验 A 是当前任务 main、父任务允许 fan-out，检查预算/最大 Agent 数，然后 `dispatch_task`。
3. B session 启动提示只包含任务包引用；B `start_work` 后才能被 prompt。Bridge 把 `concord_agent_id` 回填 `task_agents`。
4. A/B 通过 Concord prompt/reply 追问；B 只能在 `allowed_paths` claim，越界立即 `blocked`。
5. B 调用 `post_result`；Bridge 原子写入结果、artifact、`task.completed`，自动通知 A。
6. A 收到回调后调用 `evaluate_gate`，合并 patch/结果，更新父任务；失败或阻塞进入人工裁决，不自动换模型。

## 6. CLI-Manager daemon 适配器

适配器只实现白名单消息：`auth`、`list`、`status`、`create`、`write`、`attach`、`close`；服务端事件只处理 `output`、`exit`、`hook_report`。

启动流程：读取 discovery → 回环连接 → 首帧 auth → 校验 `protocol_version/features` → `create` → 安全转义后的 CLI 启动命令 `write` → `attach(after_sequence)` → 绑定到 Workspan pane。

CLI 与模型只能从项目配置映射（例如 `claude`、`codex`、`agy`），不能把任意 shell 字符串传给 `write`。协议不兼容时返回 `blocked/daemon_protocol_mismatch`，禁止偷偷启动第二套 PTY 宿主。pane 绑定尚未实现时，面板必须显示“session 已运行但未绑定可见 pane”。

## 7. Pattern 最小格式

```yaml
id: child_task
max_agents: 3
max_rounds: 2
timeout: 90m
requires_human_approval: true
steps:
  - create: child
    gate: parent_authorized
  - dispatch: child
  - wait: task.completed|task.blocked|task.failed
  - evaluate: success_criteria
  - synthesize: parent
```

Pattern 只描述步骤和上限；模型、CLI、路径和工具来自任务实例。Runtime 可以追加 verifier 或新一轮 worker，但不能突破这些上限。

## 8. 分阶段验收

| 阶段 | 可交付物 | 必须通过的验收 |
| --- | --- | --- |
| PR-6 | daemon adapter | 测试项目完成 auth/list/status/create/write/attach/output/exit/close；CLI-Manager 重连可回放；无隐藏 PTY |
| PR-7a | Workbench MCP + SQLite + `review_task` | B 产出报告 artifact，A 收到 Concord 回调并能追问 |
| PR-7b | `child_task` + scope/预算/幂等 | B 完成后父任务收到唯一 `task.completed`；越权、重复回调、超时都有明确终态 |
| PR-7c | WorkbenchPanel + pane 绑定 | child session 出现在当前 Workspan，可 focus/restore；阻塞原因和质量门可见 |
| PR-7d | GUI executor | 浏览器子任务保存截图、日志、验证命令，均可由 artifact 查询 |

最终演示必须一次跑通：A 拆分 → B 子任务 → B 回调 → A 整合 → 人指定 C 审查 → A 修正。Concord 挂掉时只允许降级到 HANDOFF，不得伪造“已完成”。

