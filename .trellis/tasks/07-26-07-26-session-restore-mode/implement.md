# 实施计划

1. 保留并完成会话恢复改动：
   - `settingsStore.ts`：恢复方式类型、默认值和加载校验。
   - `syncSettings.ts`：恢复方式标记为 `excluded`。
   - `App.tsx`：每进程一次守护、ask/auto 启动分流、确认恢复调用；恢复弹窗使用简洁提示语、响应式专用宽度并启用确认按钮自动聚焦。
   - `ConfirmDialog.tsx`：增加默认关闭的可选确认按钮自动聚焦和内容样式 props，通过 Radix `onOpenAutoFocus` + confirm button ref 聚焦，不使用 DOM 查询。
   - `ThemeSettingsPage.tsx` / `i18n.ts`：恢复方式选择器及中英文文案。
2. 修复退出任务行为回归：
   - `requestExitGuardedByRunningTasks` 增加可选预检测结果参数。
   - `closeBehavior=ask` 有运行任务时复用统一守卫；无任务仍打开普通关闭确认。
   - 提取小型持久化 helper，三个 remember 回调先等待设置落盘，再执行 background/minimize/discard；失败记录警告但继续动作。
   - 设置页退出任务行为补齐 minimize。
3. 更新契约：
   - `workspace-session-restore-contracts.md` 固化恢复方式与每进程一次约束。
   - `background-task-continuation-contracts.md` 更新四值枚举、统一入口消费设置和 remember 先落盘再动作。
4. 更新任务 PRD/design/implement，Changelog Target 设为 `V1.3.2`。
5. 将会话恢复与退出策略回归修复写入 `CHANGELOG.md` 的 `V1.3.2`，同步更新 `docs/功能清单.md`。
6. 验证：
   - `npx tsc --noEmit`
   - `node scripts/resumeCliArgs.test.mjs`
   - 相关 Node 测试（如存在）
   - `git diff --check`
7. 运行 GitNexus `detect-changes --compare master`，确认仅影响预期启动、设置和退出执行流。

## 手工验证矩阵

### 会话恢复

- ask：启动仅弹一次；确认/拒绝正确；切换设置页不重复弹窗。
- auto：启动不弹窗直接恢复。
- 总开关关闭：选择器置灰，启动清快照且不恢复。
- daemon / CLI / shell / 单 Pane / 多 Pane / Workspan 分别恢复正确。
- 常规桌面宽度下恢复提示语保持单行；缩窄窗口后弹窗自然收缩，无横向溢出。
- 弹窗打开时焦点落在“恢复”，直接按 Enter 执行恢复；抽查其他 ConfirmDialog 调用点仍保持原默认焦点和宽度。

### 退出任务行为

- `closeBehavior=ask` + 无任务：普通关闭确认。
- `closeBehavior=ask` + 有任务 + ask/background/minimize/discard：按设置执行。
- `closeBehavior=exit` + 有任务：四种行为保持正常。
- 托盘退出 + 有任务：四种行为保持正常。
- remember=true：重启后设置保持；分别验证 background/minimize/discard。
- daemon 可用、不可用、查询失败，以及前台/后台任务组合。

## 回滚点

- 启动恢复异常：优先撤销 `App.tsx` 恢复分流，不修改 `restoreSessions`。
- 恢复弹窗交互异常：撤销该调用点的专用 props 与 `ConfirmDialog` 可选聚焦契约，不调整共享按钮顺序。
- 退出分流异常：撤销窗口 ask 分支向统一守卫传递预检测快照的改动，保留底层清理实现不动。
- 设置持久化异常：恢复 helper 仅影响动作前时序，可独立回滚，不删除用户已保存设置。
