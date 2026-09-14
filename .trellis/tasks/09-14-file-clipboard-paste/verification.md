# Verification on upstream master

Base: `8e55b9e6347fa65f3aed620e93ef6c039c8a2d2e` (includes merged #259 and its review fixes).
Version: **TEMP**. Implementation and review performed inline; no subagents.

## Automated checks
- File-explorer/store/UI, OpenCode clipboard, terminal-file-link and pointer-drag tests:
  **107/107 passed** using
  `node --test scripts/fileExplorer*.test.mjs scripts/openCodeTuiClipboard.test.mjs scripts/terminalFileLinks.test.mjs scripts/terminalFilePointerDrag.test.mjs`.
- `npm run build`: **passed** (TypeScript and desktop frontend production build).
- `npm run web:build`: **passed**; the current upstream native build requires these bundled
  web assets even for library tests. Initial native build identified this missing prerequisite.
- Architecture-rule regression tests: **11/11 passed** with
  `node --test scripts/architecture.test.mjs scripts/architectureRust.test.mjs`.
- Native filesystem regressions: **42/42 passed**, including **12/12 new import tests**
  and **30 existing tests**, using
  `cargo test --offline --locked -j 2 --lib commands::fs:: --manifest-path src-tauri/Cargo.toml -- --skip path_exists_rejects_invalid_wsl_unc_without_launching_wsl --nocapture`.
  The new real-Windows-symlink test executed successfully without taking its privilege-skip path.
  Running the same compiled test binary without the filter gives **42 passed / 1 failed**:
  the unchanged upstream test `path_exists_rejects_invalid_wsl_unc_without_launching_wsl`
  assumes `\\wsl.localhost\Ubuntu` does not exist, but that distribution root exists on
  this Windows host. This baseline test and its implementation are not changed by the PR.
- `git diff --check`: passed.
- Both locale dictionaries contain the same six new paste keys. Existing upstream
  rename-selection and case-aware move regression code is retained.

## Existing architecture baseline failures
`npm run check:architecture -- --strict` reports **38 violations** in unrelated upstream files
(web UI long lines, two oversized modules and existing shared-to-feature imports).
An independent in-memory scan of Git's unmodified HEAD blobs with the same architecture
rules reports the **exact same 38 violations**. Introduced: **0**; resolved: **0**.
No architecture exemptions or unrelated cleanup are included. All files changed/added by
this feature remain below 2000 physical lines, with no new long-line or dependency violations.

## Review and boundaries
- Only the delta from the already approved clipboard implementation is ported; the older
  local checkout, installed executable and production application data are not PR inputs.
- File copies do not send file contents through WebView/base64. Screenshot data is a bounded
  immutable PNG snapshot. Native clipboard reads never write or clear the OS clipboard.
- Internal drags keep their private snapshot; ordinary paste resolves OS content. Async
  source/target context, dirty buffers and conflict-only retries retain their existing guards.
- Native imports stage before replacing destinations and preserve recovery data if rollback
  cannot safely restore the old item. External Cut is intentionally COPY-only.
- GitNexus tooling/index is unavailable. Final scope review uses contracts, direct callers,
  focused tests and the staged diff instead, as permitted by the triage guide.
- No dependency manifest/lockfile, asset scope, database, PTY/daemon, Live Server or SSH write
  behavior changes are included. The shared CF_HDROP reader's stable command also serves
  existing terminal attachments.

## Human acceptance pending
No desktop app/services are launched for AI UI verification. See `manual-checklist.md` for
actual clipboard/menu/focus, both locales, layouts, WSL/UNC and Worktree checks.
