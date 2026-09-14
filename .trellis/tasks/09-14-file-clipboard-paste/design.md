# Design / discovery / impact (reviewed inline)

## Cause and architecture
File explorer paste consumes only its private selection clipboard; Windows file lists and screenshot bitmaps are not connected to project filesystem writes. Add a native clipboard snapshot command and scoped import commands; reuse the existing batch/dirty/refresh pipeline instead of routing through terminal attachments (which expire after two days).

## Impact analysis fallback
GitNexus MCP/runner/index is unavailable here. Read project-file-command and file-explorer-batch contracts and grep upstream references before edits.
- FileExplorerSidebar / FileNode / pasteIntoTarget / error mapper: direct hosts Sidebar and TerminalTabs; directory menus and keyboard paste. Medium focus/interaction risk. No global listener.
- useFileExplorerStore / setClipboard / performFileBatch: sidebar mutations; FileEditorPane/Tabs and refresh controller indirectly observe buffers. HIGH data-loss risk, reported before edits: immutable source/destination scope, existing lock, dirty checks and staged backend imports.
- fs::read_clipboard_file_paths: terminal input and new importer call it. Use HDROP handle per Win32 API, bounded busy retries, no write to OS clipboard. Existing command signature unchanged.
- fs module and lib::run registration: new submodule/commands only; existing path validation/copy helpers reused without broadening other commands. HIGH filesystem risk: validate root/name, reject links/overlap, stage before overwrite, rollback backup on publish failure.
- i18n, CHANGELOG, feature list, contracts/tests/task artifacts: affected.
- terminal input, drag payload, PTY/daemon/proxy, SSH transport, hooks, settings/database, Live Server: inspected; no implementation change. Terminal clipboard regression checks required.

## Clipboard ownership
Internal copy/cut captures a native clipboard revision promise; paste awaits that and requests a native snapshot. Matching Windows revision uses the internal selection. Changed revision uses external paths first, otherwise image PNG, otherwise no import (never interpret clipboard text as a file list). Snapshot reads detect mid-read changes. Native file lists are Windows-only; screenshots are supported via existing clipboard plugin. Non-Windows internal copy retains precedence when no revision is available. File copies stream on disk, not through base64. Only image bytes cross IPC, capped at 64 MiB and 12M pixels.

## Filesystem publishing
New import commands validate the project-relative destination and absolute external source, reject self/ancestor/descendant targets, and protect all captured external source paths during conflict retry. Copy to a unique temporary directory next to the target. On confirmed overwrite, move the old target to backup, publish the staged item, restore backup if publish fails. Failed rollback preserves the recovery directory and reports its path. No recursive shell delete. Internal copy/move is intentionally unchanged.

## Scenario matrix
| Dimension | Behavior |
|---|---|
| File row, folder, root/background | Folder itself / file parent / root; context menu captures its row |
| Input, editor, terminal, another window | No interception or global shortcuts |
| Sidebar/panel/compact/tree/name search/content search | Shared resolver and existing menu callbacks |
| Multiple panes/windows/Workspan/project switch | Captured scope, generation validation, mutation lock; no mutation in replacement project |
| Hidden/minimized/tray/focus mode | No global reads; pending results remain scoped |
| Local/Worktree/WSL | Root-scoped filesystem commands; case-preserving WSL paths; missing roots fail; .git filtering untouched |
| SSH | Read-only in UI and store |
| Hooks installed/not installed | Unrelated |
| Multi-file/folder/screenshot/empty/text/busy clipboard | Files before image; bounded read error; no automatic text file |
| Existing private copy then external copy | Revision chooses newest clipboard, including invalidation by text |
| Conflict/dirty buffer/partial errors | Confirm only conflicts, preserve dirty buffers, report per-item outcomes |
| Symlink/junction/missing source/recursive destination | Reject unsafe paths; staging protects old destination |

## Review
Scope reviewed inline against contracts, original implementation authorization and source. No subagents. The user explicitly authorized this PR submission; commit only the isolated feature branch. Human UI acceptance remains pending.

## Final inline review (before release freeze)
- Reviewed the task delta against the pre-task source backup, rather than treating prior multiselect edits as new work.
- `runFileOperationBatch` impact: direct production caller is `performFileBatch`; the additional source-case option defaults to the old behavior. Only external imports opt out of destination-case source dedup. Added a WSL-case regression.
- Corrected file/folder publication to native Windows MoveFileExW(flags=0), which works without requiring hard-link support and refuses replacing a race-created destination.
- Canonicalized existing target aliases before overlap checking, so case variants cannot rewrite the copied source.
- Kept internal pointer drag on its captured private clipboard instead of invoking the new OS resolver.
- Screenshot import decodes/validates PNG after dimensions/encoded-size checks; folder imports validate child names and reject links, special files and excessive nesting before replacing old data.
- Tests exercise actual filesystem bytes, actual Windows symlinks, conflict replacement, staging cleanup, publish failure rollback, Win32 case alias and no-replace publication. UI handler/store tests execute source with mocks, not just search for strings.

## Primary API references consulted
- [DragQueryFileW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-dragqueryfilew): HDROP handle input.
- [GetClipboardSequenceNumber](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardsequencenumber): native clipboard revision and delayed-render caveat.
- Installed `tauri-plugin-clipboard-manager` 2.3.2 and `arboard` 3.6.1 source: Rust read_image, error string and worker-thread requirement. No dependency/network upgrade.

## Upstream contribution adaptation
- Base: master 8e55b9e6, including merged #259 and review commit 160bb41. Preserve rename-selection updates and case-aware move guards.
- Use the current files feature API/library and split i18n dictionaries; preserve stable Rust command routes.
- Extract the shared native clipboard file reader into commands/clipboard_files.rs to keep commands.rs below the strict 2000-line limit.
- GitNexus remains unavailable (no MCP tool or local index); contracts plus symbol-reference inspection confirm only the documented file/clipboard flows are affected.
