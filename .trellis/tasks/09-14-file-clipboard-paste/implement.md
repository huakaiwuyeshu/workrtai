# Implementation / upstream contribution

## Approved scope
- Continue the user-approved clipboard task with changelog version TEMP.
- Submit only this feature to upstream master, based on 8e55b9e6 (merged #259).
- Preserve the original local checkout and installed application. Do not publish binaries,
  installation backups, build logs, credentials or machine-specific deployment records.

## Completed implementation batches
1. Inspect current files-domain APIs/contracts and #259 review fixes. GitNexus unavailable;
   use contract/reference analysis as permitted by the triage guide. Review inline.
2. Port only the clipboard delta, retaining upstream rename-selection and case-aware move
   protections. Keep current frontend feature boundaries and split locale dictionaries.
3. Add native revision/snapshot and scoped file/image import commands. Extract the shared
   CF_HDROP reader so the existing files command module stays below 2000 lines. Existing
   clipboard file/terminal attachment command signatures remain unchanged.
4. Reuse batch context, dirty-buffer, conflict-only retry and refresh behavior. Preserve
   internal drag snapshots instead of resolving the OS clipboard during a drag.
5. Port focused store/UI/filesystem tests. Native tests never overwrite the OS clipboard.
   The Windows link test skips only ERROR_PRIVILEGE_NOT_HELD on unprivileged machines;
   unexpected link-creation errors still fail.
6. Update both locales, TEMP changelog, feature inventory, contracts and manual checklist.

## Delivery gates
- Focused file-explorer, terminal-path, clipboard and pointer-drag regressions.
- TypeScript / production frontend build and focused Rust tests on the upstream base.
- Strict architecture check; compare any unrelated upstream failures with untouched HEAD,
  without adding exemptions or expanding this PR to repair unrelated domains.
- Inspect the staged feature-only diff and task records for private artifacts before commit.
- Commit and push a new contribution branch without force; create one upstream PR.

## Manual acceptance
Actual desktop clipboard/menu/focus, locale switching and WSL/UNC checks remain for a human,
as required by the frontend quality policy. No app or service is launched for AI UI testing.
