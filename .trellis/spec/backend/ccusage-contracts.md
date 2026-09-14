# ccusage Contracts

> Executable contracts for ccusage runtime selection, Tauri command arguments, cache scope, and settings-driven WSL behavior.

---

## Scenario: explicit ccusage WSL runtime switch

### 1. Scope / Trigger

- Trigger: changes touching `ccusage_refresh_report`, `ccusageStore`, `GeneralSettingsPage`, cache-key selection, or any logic that decides whether ccusage runs in Windows or WSL.
- This is a cross-layer contract because the frontend persists `ccusageUseWsl`, React panels compute runtime readiness from it, `ccusageStore` chooses cache scope from it, and Rust commands must honor it when building runtime/env targets.

### 2. Signatures

Rust command payloads:

```rust
#[tauri::command]
pub async fn ccusage_get_status(
    claude_config_dir: Option<String>,
    codex_config_dir: Option<String>,
) -> Result<CcusageToolStatus, String>

#[tauri::command]
pub async fn ccusage_refresh_report(
    source: String,
    claude_config_dir: Option<String>,
    codex_config_dir: Option<String>,
    use_wsl: bool,
) -> Result<CcusageReportResponse, String>
```

Frontend settings / store surfaces:

```ts
interface Settings {
  ccusageAnalyticsEnabled: boolean;
  ccusageUseWsl: boolean;
}

function resolveCcusageRuntimeScope(
  source: CcusageSource,
  claudeConfigDir: string | null | undefined,
  codexConfigDir: string | null | undefined,
  useWsl?: boolean,
  fallbackDistro?: string | null
): { kind: "host" } | { kind: "wsl"; distro: string } | { kind: "mixed"; reason: "host-wsl" | "multi-wsl" }
```

### 3. Contracts

- `ccusageUseWsl` is the only explicit switch deciding whether ccusage may run in WSL. Default is `false`.
- When `ccusageUseWsl === false`, runtime selection must resolve to `host` even if Claude/Codex config directories point at `\\wsl.localhost\...` or `\\wsl$\...`.
- When `ccusageUseWsl === false`, frontend cache keys must also resolve to the host scope so Windows and WSL reports do not share one cache bucket.
- When `ccusageUseWsl === false`, Rust must pass config directory env vars as raw Windows/UNC paths; do not rewrite them to Linux paths.
- Only when `ccusageUseWsl === true` may runtime selection parse WSL UNC config paths and switch the report execution target to `wsl.exe`.
- When `ccusageUseWsl === true` and both `claudeHookConfigDir` and `codexHookConfigDir` are empty, backend may probe the default WSL distro via `wsl.exe --exec sh -lc 'printf ... "$WSL_DISTRO_NAME" "$HOME"'`.
- The default-WSL fallback is allowed only for the fully-empty case. If either config directory is explicitly set, frontend and backend must keep respecting the explicit host/UNC path instead of silently overriding it with the default distro.
- The default-WSL fallback must derive `CLAUDE_CONFIG_DIR=/home/<user>/.claude` and `CODEX_HOME=/home/<user>/.codex` from the detected WSL `$HOME`.
- Frontend runtime scope, WSL target badges, and cache keys must accept the backend-reported `toolStatus.wsl.distro` as fallback input so UI state matches the runtime chosen by Rust.
- `ccusage_get_status` remains observational: it may still report both host and discovered WSL tool status regardless of the toggle, because the settings UI needs to show readiness before the user enables WSL execution.
- `CcusageStatsPanel` must derive readiness, prepare-card warnings, mixed-runtime warnings, and WSL install hints from the explicit runtime scope, not merely from the existence of any WSL config path.
- Host install CTA (`installTools()` without WSL target) must only show when the active runtime scope is `host`.
- Report refresh execution must invoke `bun x ccusage ...`, not `bunx ccusage ...`. This avoids PATH / wrapper drift where WSL resolves `ccusage` through a Node global entrypoint that fails on locale JSON ESM imports.
- Codex report refresh must not request `blocks`. `ccusage codex` only exposes `daily`, `monthly`, and `session`; `ccusage codex blocks` exits with `The "blocks" report is only available for Claude Code usage.` Return `blocksPayload: null` for `source=codex` and let the frontend normalize it as empty hourly data.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
|------|------|
| `ccusageUseWsl = false` + config dirs are host paths | Run host ccusage; cache scope = `host` |
| `ccusageUseWsl = false` + config dirs are WSL UNC paths | Still run host ccusage; pass UNC env vars through unchanged |
| `ccusageUseWsl = true` + one source resolves to one WSL distro | Run WSL ccusage in that distro |
| `ccusageUseWsl = true` + both config dirs empty + default WSL distro exists | Run WSL ccusage in the default distro and use `~/.claude` / `~/.codex` inside that distro |
| `ccusageUseWsl = true` + one config dir explicitly points to host path | Respect the explicit host path for that source; do not override it with default WSL fallback |
| `ccusageUseWsl = true` + source `all` mixes host + WSL | Return the existing mixed-runtime error; frontend must show the mixed-runtime hint |
| `ccusageUseWsl = true` + source `all` sees multiple WSL distros | Return the existing multi-distro error; frontend must show the conflict hint |
| `ccusageUseWsl = true` + current source runtime is WSL but bunx missing | Refresh stays disabled; prepare card shows WSL manual hint |
| `ccusageUseWsl = true` + no current source WSL runtime | Fall back to host for that source; do not show unrelated WSL install hint |
| `source = codex` | Run `daily` and `session`; skip `blocks`; return `blocksPayload: null` |
| `source = claude` or `source = all` | Keep the existing `blocks` report request |

### 5. Good / Base / Bad Cases

Good:

```ts
const runtimeScope = resolveCcusageRuntimeScope(
  source,
  settings.claudeHookConfigDir,
  settings.codexHookConfigDir,
  settings.ccusageUseWsl
);
```

Base:

```rust
let (target, envs) = resolve_runtime_for_source(
    &source,
    claude_config_dir,
    codex_config_dir,
    use_wsl,
)?;
```

Base:

```rust
let fallback = detect_default_wsl_context()?;
let claude = fallback
    .as_ref()
    .map(|context| default_wsl_config_dir(context, ".claude"));
```

Bad:

```ts
// Wrong: silently switches to WSL whenever a config dir looks like \\wsl.localhost\...
const runtimeScope = resolveCcusageRuntimeScope(source, claudeDir, codexDir);
```

### 6. Tests Required

- Frontend:
  - `npx tsc --noEmit`
  - With `ccusageUseWsl = false`, verify Usage Analysis settings still load and the panel no longer shows WSL-only prepare hints for host runtime.
  - With `ccusageUseWsl = true`, verify current-source WSL readiness/hints and mixed-runtime messages still match the actual source.
  - With empty Hook config dirs + backend fallback distro present, verify WSL target badge, runtime scope, and cache key all resolve to the same fallback distro.
- Backend:
  - `cd src-tauri && cargo check`
  - Assert `ccusage_refresh_report(..., use_wsl = false)` keeps host runtime even for WSL UNC config dirs.
  - Assert `ccusage_refresh_report(..., use_wsl = true)` still converts WSL UNC config dirs to Linux paths and runs via WSL target.
  - Assert default fallback is used only when both config dirs are empty.
  - Assert report command construction uses `bun` with `["x", "ccusage", ...]` so refresh does not depend on `bunx` / `ccusage` shell wrappers.
  - Assert Codex refresh does not request a blocks report and still preserves Claude/all blocks behavior.

### 7. Wrong vs Correct

#### Wrong

```rust
let claude = resolve_config_dir(claude_config_dir, "Claude")?;
// WSL UNC path immediately becomes RuntimeTarget::Wsl, regardless of user preference.
```

#### Correct

```rust
let claude = resolve_config_dir_for_runtime(claude_config_dir, "Claude", use_wsl)?;
// Only convert UNC -> Linux path and switch target when the explicit toggle is on.
```

#### Correct

```rust
let default_wsl = fallback_default_wsl_context(
    claude_config_dir.as_ref(),
    codex_config_dir.as_ref(),
    use_wsl,
)?;
// Only when both config dirs are empty may the runtime fall back to the default WSL distro.
```

#### Wrong

```rust
let blocks_payload = ccusage_report_payload(&target, "codex", "blocks", &envs, false)?;
```

#### Correct

```rust
let blocks_payload = if source_supports_blocks_report(&source) {
    ccusage_report_payload(&target, &source, "blocks", &envs, false)?
} else {
    serde_json::Value::Null
};
```
