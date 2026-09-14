# Linux Graphics Contracts

## Scope

- Trigger: changing Linux startup graphics variables, WebKitGTK compatibility modes, graphics diagnostics IPC, or AUR distribution behavior.

## Contracts

- Graphics policy runs before `tauri::generate_context!()` and before any WebView/WebKitGTK process is created.
- Persisted mode values are `auto`, `system`, `disable-dmabuf`, and `disable-compositing`.
- Precedence is: existing standard WebKit/NVIDIA environment variables, `CLI_MANAGER_LINUX_GRAPHICS_MODE`, `settings.json.linuxGraphicsMode`, then `auto`.
- Existing standard environment variables are never overwritten, including an explicit value that disables a workaround.
- `auto` sets `__NV_DISABLE_EXPLICIT_SYNC=1` only when both Wayland and the proprietary NVIDIA driver are detected.
- `disable-dmabuf` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`; `disable-compositing` sets `WEBKIT_DISABLE_COMPOSITING_MODE=1`.
- Diagnostics expose only platform/session/desktop, NVIDIA detection, selected/effective modes, source, and workaround booleans. Do not expose the full environment or user paths.
- Linux windows remain hidden until the frontend has rendered a real loading or application screen; the fallback timer may show the loading screen but not an empty root.

## AUR

- `CLI_MANAGER_DISTRIBUTION=aur` marks package-manager ownership.
- AUR-managed installs do not call Tauri updater check/download/install paths and link users to the AUR package.
- The AUR wrapper must preserve all command-line arguments and use LF line endings.

## Tests

- Rust unit tests cover auto detection, explicit modes, precedence, non-overwrite behavior, and non-Linux no-op behavior.
- Run `cargo check`, `cargo test`, and `npx tsc --noEmit`.
- Manual runtime verification requires NVIDIA Wayland plus Mesa Wayland/X11 comparison; AppImage, source build, and AUR package must be tested separately.
