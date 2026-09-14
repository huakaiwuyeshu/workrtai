# Command Suggestion Contracts

## Scenario: LLM-backed terminal command suggestions

### 1. Scope / Trigger

- Trigger: terminal input suggestions now cross frontend settings, Tauri commands, and an OpenAI-compatible model endpoint.
- Goal: keep LLM suggestions optional, fast, secret-safe, and unable to execute commands automatically.
- Execution model: local history/template/built-in suggestions are the first layer and must render without waiting for the model; the LLM is only an asynchronous second-phase upgrade for stable input.

### 2. Signatures

- `command_suggestion_test_model(baseUrl: string, apiKey: string, model: string) -> CommandSuggestionModelTestResult`
- `command_suggestion_generate(request: CommandSuggestionGenerateRequest) -> CommandSuggestionResponse`

```typescript
interface CommandSuggestionGenerateRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  input: string;
  cwd: string | null;
  previousCommand: string | null;
  history: string[];
  templates: string[];
}

interface CommandSuggestionResponse {
  command: string | null;
  responseTimeMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}
```

### 3. Contracts

- Backend auto-detects the endpoint from `baseUrl`: a full `/v1/responses` URL uses Responses; a full `/v1/chat/completions`, root, or `/v1` URL uses Chat Completions. It avoids duplicate `/v1`, `/v1/chat/completions`, or `/v1/responses` suffixes.
- API key is used only in the `Authorization: Bearer ...` header and must not be logged, returned, or written to task docs.
- Frontend sends only compact LLM context: history/templates are limited to the current command root, deduplicated, capped at 12 entries, and secret-bearing entries such as `.env`, token/password/API-key assignments, bearer tokens, provider keys, and private key file names are dropped or redacted before `command_suggestion_generate`.
- Frontend should compact `cwd` before sending it to the model instead of leaking the full absolute path; if the path contains secret markers, send `null`.
- Model test uses a minimal chat request and classifies:
  - `operational`: HTTP 2xx and response time is at or below the fast threshold.
  - `degraded`: HTTP 2xx but response is slow; UI should warn that it is not recommended.
  - `failed`: non-2xx, timeout, connection error, or invalid config.
- Generate returns a single candidate command or `null`; frontend must still require the command to start with the current input before showing a suffix.
- AI suffixes must be rejected when they introduce dangerous shells/pipes or force flags, for example `curl ... | sh`, `irm ... | iex`, shell pipe execution, `rm`/`del`/`Remove-Item`, `--force`, `--yes`, `-f`, or `-y`.
- LLM output is never executed. `Tab` / `Ctrl+Space` may insert only the accepted suffix.
- Backend should reuse a shared `reqwest::Client`; per-request timeout stays on the request builder. Response bodies are bounded before parsing to avoid unbounded memory growth.
- Usage stats are hot-path data. Frontend may update the Zustand state immediately, but persistent store writes should be batched/debounced.
- LLM suggestion diagnostics must follow the system Debug Mode. When debug mode is off, no prediction diagnostics are emitted. When debug mode is on, frontend `@tauri-apps/plugin-log` entries and backend command logs write to the existing local log file.
- Debug diagnostics may include endpoint type, sanitized endpoint URL, model name, response time, HTTP status, body byte length, context item counts, token usage, and frontend reject/fallback reason. They must not include API keys, full current input, prompt text, history/template command text, cwd absolute path, or response body text.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Empty `baseUrl` | Return `missing_base_url` |
| Empty `apiKey` | Return `missing_api_key` |
| Empty `model` | Return `missing_model` |
| Empty `input` for generation | Return `missing_input` |
| Oversized prompt/input/cwd/previous command | Return `input_too_large` |
| HTTP non-2xx | Return summarized `HTTP <status>: <body prefix>` without secrets |
| Timeout | Return `Request timeout` |
| Response `Content-Length` or actual body exceeds the configured response body cap | Return `model_response_too_large` |
| Multi-line or very long generated command | Treat as no command and let frontend fall back |
| AI result does not start with the current input or adds a dangerous suffix | Treat as no command and keep/fall back to local suggestions |
| Debug Mode disabled | Do not write LLM prediction diagnostics |
| Debug Mode enabled | Write only sanitized LLM prediction diagnostics to the local app log |

### 5. Good/Base/Bad Cases

- Good: Chat Completions or Responses returns `{"command":"git status"}` for input `git s`; frontend shows only `tatus`.
- Good: local history returns `git status` immediately for `git s`; a later valid AI result for the same still-current input may replace the ghost suffix.
- Base: model is slow but succeeds; settings test reports degraded and terminal suggestions keep local suggestions visible while the input-time request is pending.
- Base: debug mode is enabled; logs show timing/status/counts for model test and generation, plus frontend fallback reason, without command text or secrets.
- Bad: model returns `rm -rf .\ngit status`, `git status && rm -rf .`, or a command that does not start with current input; backend/frontend reject it and local suggestions remain available.
- Bad: debug logs contain API keys, full prompt, full command input, history/template command text, or raw provider response body.

### 6. Tests Required

- Rust unit tests:
  - endpoint URL builder avoids duplicate `/v1`.
  - JSON command content is parsed.
  - Responses `output[].content[].text` command content is parsed.
  - multi-line commands are rejected.
- Frontend checks:
  - `npx tsc --noEmit`.
  - LLM-disabled path still returns local history/template/built-in suggestions.
  - LLM-enabled path renders local suggestions first and rejects stale async LLM responses when input changes.
  - LLM context redaction drops or masks secrets before invoking `command_suggestion_generate`.
  - Stale async LLM responses do not overwrite suggestions for newer input.
- Backend checks:
  - `cd src-tauri && cargo check`.
  - `cd src-tauri && cargo test command_suggestion`.
  - Response body cap rejects oversized responses before JSON parsing.
  - Debug log endpoint labels remove URL userinfo, query, and fragment before writing diagnostics.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Sends model output straight into the terminal or trusts any returned text.
forwardTerminalInput(modelCommand, "onData");
```

#### Correct

```typescript
const suffix = getSafeSuggestionSuffix(currentInput, modelCommand);
if (suffix) {
  showGhostSuffix(suffix);
}
```

Keep LLM completion as a suggestion source only; the PTY write path is reached only after explicit user acceptance.

## Scenario: Local path suggestions

### 1. Scope / Trigger

- Trigger: terminal input ends with a path-shaped token or a command that normally accepts a path, such as `cd`, `ls`, `cat`, `code`, `git add src/`, or `D:/work/`.
- Goal: provide fish/zsh-style path suffix suggestions without invoking the user's shell completion engine or executing user commands.
- Execution model: frontend parses the current input, asks the backend for one directory listing, and merges path candidates with history/template/built-in suggestions.

### 2. Signatures

- `command_suggestion_list_path_entries(request: CommandSuggestionPathRequest) -> CommandSuggestionPathEntry[]`
- `command_suggestion_resolve_directory(path: string) -> string | null`

```typescript
interface CommandSuggestionPathRequest {
  directory: string;
  prefix: string;
  directoriesOnly: boolean;
  limit?: number;
}

interface CommandSuggestionPathEntry {
  name: string;
  kind: "directory" | "file";
  isSymlink: boolean;
}
```

### 3. Contracts

- Path suggestions are read-only. Backend may list a directory or check whether a submitted `cd` target is a directory; it must not create, delete, move, or execute paths.
- Native `directory` must be absolute before listing. Relative tokens are resolved by the frontend against the session cwd.
- WSL UNC paths are listed through `wsl.exe --exec find` inside the target distro; native paths use `std::fs::read_dir`.
- Entries are filtered by case-insensitive prefix, directories are sorted before files, and result count is clamped.
- `directoriesOnly=true` returns only directories, including symlinks whose target is a directory.
- Frontend must treat listing failures as no path suggestions and keep existing local suggestions visible.
- Session cwd can be updated from shell integration cwd sequences (`OSC 7` or `OSC 633;P;Cwd=...`) or from a submitted `cd` command only after `command_suggestion_resolve_directory` confirms the target exists.
- Accepted suggestions only insert the suffix. They never send Enter or execute commands.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Empty directory | Return `missing_directory` |
| Empty path for resolve | Return `missing_path` |
| NUL or oversized path/prefix | Return `path_input_too_large` |
| Native list directory is relative | Return `path_not_absolute` |
| Directory cannot be canonicalized or read | Return an error; frontend silently falls back |
| Resolve target does not exist or is not a directory | Return `null` |
| Prefix has no matches | Return an empty list |

### 5. Tests Required

- `npx tsc --noEmit`.
- `cd src-tauri && cargo test command_suggestion`.
- `cd src-tauri && cargo check`.
- Native path tests should cover prefix filtering, directory-first sorting, `directoriesOnly`, and canonicalizing submitted `cd` targets.

## Scenario: Local command-history suggestions and storage controls

### 1. Scope / Trigger

- Trigger: terminal command history is used as a local suggestion source or shown/cleared from Command Suggestions settings.
- Goal: keep command-history suggestions useful by storing shell-like commands only, while making local storage visible and clearable.

### 2. Signatures

- Frontend store: `useCommandHistoryStore.addCommand(projectId: string | null, command: string) -> Promise<void>`
- Frontend store: `useCommandHistoryStore.getStorageStats() -> Promise<{ commandCount: number; storageBytes: number }>`
- Frontend store: `useCommandHistoryStore.cleanup() -> Promise<void>`
- SQLite table: `command_history(id, project_id, command, executed_at)`

### 3. Contracts

- `addCommand` is the write boundary for terminal command history. Filtering belongs there, not in the xterm input path.
- Store only one-line, shell-like input. Reject obvious natural-language prompts such as CJK/script-first text, question sentences, and common English natural-language starters.
- Keep normal developer commands valid, including common command roots (`git`, `npm`, `cargo`, `python`, `codex`, `claude`), slash commands such as `/status`, shell operators, environment assignments, and path/script invocations.
- LLM prediction controls may exist in code, but the user-facing settings page can hide them while the feature is not mature. On load, persisted command-suggestion provider state must normalize back to local suggestions when LLM is disabled by product policy.
- `getStorageStats` returns local command-history count and an estimated byte size from SQLite text/blob lengths. It is an approximate UI metric, not a database-file-size contract.
- `cleanup` deletes all command-history rows and refreshes in-memory history state.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Empty or whitespace input | Do not insert. |
| Multi-line input | Do not insert into command history. |
| Chinese or other script-first natural-language prompt | Do not insert. |
| `fix bug`, `please update this`, or question-like prompt | Do not insert. |
| `npm run dev`, `git status`, `cd src`, `./script.ps1`, `/status` | Insert unless it duplicates the latest persisted command for the same project. |
| Stored provider is `ai` or LLM enabled is `true` while LLM is hidden | Normalize provider to `local` and LLM enabled to `false` during settings load. |
| User clears storage | Delete all `command_history` rows and update displayed stats. |

### 5. Good/Base/Bad Cases

- Good: a Codex/Claude natural-language prompt in Chinese is not offered later as a shell command suggestion.
- Good: a normal developer command with Chinese arguments, such as `git commit -m "修复"` or `echo 你好`, remains valid because the command root is shell-like.
- Base: custom ASCII commands with command-like syntax can still be stored; the filter is conservative and not a full shell parser.
- Bad: filtering only in `XTermTerminal` would let other history write paths bypass the rule.
- Bad: showing stale LLM settings while the feature is disabled would let old persisted config keep sending model requests.

### 6. Tests Required

- Run `npx tsc --noEmit`.
- Manually verify command history stores normal commands and skips obvious natural-language prompts.
- Manually verify Command Suggestions settings shows stored command count, estimated storage usage, and clearing storage refreshes both values.
- Manually verify LLM controls are not visible in Command Suggestions settings.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Filters only one caller; another caller could still persist natural-language prompts.
if (looksLikeCommand(inputBuffer.current)) {
  addCommand(projectId, inputBuffer.current);
}
```

#### Correct

```typescript
// Keep validation inside the store write boundary.
addCommand: async (projectId, command) => {
  const trimmed = command.trim();
  if (!isLikelyShellCommand(trimmed)) return;
  // insert into command_history
}
```
