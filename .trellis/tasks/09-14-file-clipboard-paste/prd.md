# Clipboard paste requirements

## Approval and baseline
User approved this Trellis task and version TEMP, implemented locally, then explicitly requested an upstream pull request. Publish only the clipboard feature delta on upstream master 8e55b9e6, preserving the author's PR #259 review fixes. Work in an isolated contribution branch; leave the installed application and existing local checkout untouched. No dependency upgrades or app/service shutdown.

## Acceptance
- Ctrl/Command+V and existing Paste menus import Explorer files/folders or screenshot PNG into the focused directory, a file's parent, or project root when background is focused.
- Same behavior in sidebar/panel, tree/search/compact paths. Text inputs, editors and terminals keep their own paste. SSH remains read-only.
- Existing internal copy/cut remains usable; newer OS clipboard data takes priority over stale internal selections on Windows. Text-only clipboard must not replay stale internal files.
- Preserve names, multi-item results, conflict-only retries and dirty-buffer guards. Never delete/move the external source, including Explorer Cut. Screenshot name includes timestamp and unique suffix.
- Destination containment, traversal/link/recursive-copy guards at Rust boundary. Stage a complete copy before replacing an existing destination; failed staging leaves the old file intact.
- Snapshot project/generation and clipboard payload across async reads and confirmation. Refresh exact changed entry paths.
- No new dependencies/database/proxy/PTY/Live Server changes. Bilingual strings and TEMP records. Run isolated regression tests, TypeScript/Rust checks and production build. Do not launch the app/services for AI UI testing.
