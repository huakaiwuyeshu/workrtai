# Crash Reporting Contracts

## Scope

CLI-Manager must keep crash diagnostics in an independent rolling file under
`~/.cli-manager/logs/crash.log`. Normal application logs remain in
`cli-manager.log` / `cli-manager-dev.log`.

## Capture paths

| Failure path | Required record |
|---|---|
| Rust panic, including release `panic = "abort"` | Panic payload, source location, thread, forced backtrace, runtime context |
| React render failure | Error/stack, component stack, window state, recent breadcrumbs |
| Uncaught browser error | Error/stack, URL, line/column, window state, recent breadcrumbs |
| Unhandled promise rejection | Rejection/stack, window state, recent breadcrumbs |
| Bootstrap dynamic-import failure | Error/stack before React mounts |
| WebGL context loss | Rendering-context event and active operation context |
| Native/WebView/OS termination that bypasses handlers | On the next launch, emit `unclean_exit_detected` from the durable runtime marker |
| PTY daemon panic or abnormal termination | Use the same crash file with `processRole="pty-daemon"` |

An unclean-exit record is evidence that the normal Tauri `Exit` event did not
run. It must not claim a definite software crash because forced termination,
power loss, and OS shutdown have the same observable boundary.

## Runtime context

The durable marker is refreshed periodically and when the frontend enters a
diagnostically important operation. At minimum it covers:

- file preview path, extension, size, preview kind, and project;
- terminal/session creation, shell, project/worktree, pane/split state, and a
  length-limited/redacted startup-command summary;
- PTY exit/error status and exit code;
- focused/background/minimized-to-tray observable state via focus and document
  visibility;
- the latest 50 bounded breadcrumbs.

The reporter must never record terminal input, file contents, environment
variable values, tokens, passwords, secrets, or API keys. Payload and stack
sizes are bounded in both the frontend and backend.

## Lifecycle and concurrency

- Debug and release processes use different runtime-marker names because an
  installed app and `tauri dev` can run together against the same data path.
- Main-app and PTY-daemon records carry different `processRole` values.
- A live PID marker must not be classified as an unclean exit.
- The normal Tauri `Exit` event removes only the current process marker.
- A panic leaves the marker in place and also attempts an immediate synchronous
  crash-log write.
- If the primary crash writer is unavailable during panic handling, write a
  distinct `crash-emergency-*.log` file.
- Crash logs reuse the existing 10 MiB rolling writer and seven-day archive
  retention behavior.

## Scenario matrix

The capture behavior is independent of window focus, current/deep split pane,
normal/minimized/tray state, single/multiple sessions and Workspans, focus mode,
local PowerShell/CMD/Pwsh vs WSL/Bash, main repo vs Worktree (including a missing
Worktree path), and Claude/Codex hook installed/partial/not installed. Hook
availability enriches terminal state but is not required for crash capture.

## Validation

- `npx tsc --noEmit`
- `cargo check`
- Rust unit tests for marker naming, payload bounding, rolling writer behavior,
  and unclean-marker recovery
- Manual: trigger a React render error and confirm one JSON line in `crash.log`
- Manual: terminate the app process, relaunch, and confirm
  `unclean_exit_detected` includes the last file/terminal activity
- Manual: exit through tray/window cleanup and confirm no false unclean-exit
  record on the next launch
