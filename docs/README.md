# Memory Mason — Technical Reference

Cross-LLM Obsidian sync. Hook-based capture + reusable knowledge base skills across Claude Code, GitHub Copilot, Codex, Gemini CLI, Cursor, Windsurf, Cline, and other Agent Skills hosts.

## Install

See the [main README](../README.md) for plugin and shell install commands. Run `/mmsetup` after install to configure your vault path.

> **VS Code Copilot tip:** To add Memory Mason to `@agentPlugins` search, add this to VS Code settings:
>
> ```json
> "chat.plugins.marketplaces": [
>   "s-gryt/memory-mason"
> ]
> ```

Skills-only hosts (Cursor, Windsurf, Cline, and other [Agent Skills](https://agentskills.io) hosts): `npx skills add s-gryt/memory-mason -a <agent> -s '*' -y`. Installs knowledge base commands (`/mmc`, `/mmq`, `/mml`, `/mms`, `/mma`, `/mmsetup`) only — hooks require plugin or shell install.

## Shell Install

Shell installers copy hook runtime, wire events, and create vault config in one step.

### Installer Flags

| Flag | Effect |
|:-----|:-------|
| `--agent <name>` | Skip interactive prompt (`claude`, `copilot`, `codex`, `all`) |
| `--workspace <path>` | Install Copilot/Codex hooks at workspace level |
| `-Force` (PowerShell) | Reinstall even if already installed |

> Remote PowerShell parameters do not flow through `iwr ... | iex`; use the `scriptblock` form shown in the main README.

### What Gets Installed

| Agent | What the installer does | Runtime location |
|:------|:------------------------|:-----------------|
| **Claude Code** | Wires 6 hook events in `~/.claude/settings.json` | `~/.claude/hooks/memory-mason/` |
| **GitHub Copilot** | Generates 6 workspace hook JSON files + copies runtime | `~/.copilot/hooks/memory-mason/` |
| **Codex** | Writes `.codex/hooks.json` + copies runtime | `~/.codex/hooks/memory-mason/` |

## Configuration

Run `/mmsetup` to configure your vault path interactively. Or set it up manually using any of these methods.

`captureMode` controls how much session detail gets written. `lite` is default and keeps capture compact. Set `MEMORY_MASON_CAPTURE_MODE=full` or `"captureMode": "full"` when you want detailed tool output in daily logs.

Config resolves in this order (first match wins):

| Priority | Source | Location | Best for |
|:--------:|:-------|:---------|:---------|
| 1 | Project `.env` | `MEMORY_MASON_VAULT_PATH` + optional `MEMORY_MASON_SUBFOLDER` + optional `MEMORY_MASON_SYNC` | Per-project override |
| 2 | Project config | `memory-mason.json` in project root | Per-project override |
| 3 | Global `.env` | `~/.memory-mason/.env` | Shared local defaults |
| 4 | Global config | `~/.memory-mason/config.json` | Default for all projects |

Vault path is resolved from files only. Per-session `MEMORY_MASON_SYNC` and
`MEMORY_MASON_CAPTURE_MODE` environment variables still override file config. If no source is
found, hooks throw an explicit error. `/mmsetup` creates the global config automatically.

### .env format

`MEMORY_MASON_VAULT_PATH` sets the Obsidian vault location. `MEMORY_MASON_SUBFOLDER` sets the
directory inside the vault. `MEMORY_MASON_SYNC` is optional — capture is enabled by default; set
it to `false` to pause capture. `MEMORY_MASON_CAPTURE_MODE` is optional — set it to `full` to keep
detailed tool output, or leave it at the default `lite` mode for compact capture. Setting
`MEMORY_MASON_SYNC` or `MEMORY_MASON_CAPTURE_MODE` as process environment variables overrides file
config for a single session.

```env
MEMORY_MASON_VAULT_PATH=/path/to/your/obsidian/vault
MEMORY_MASON_SUBFOLDER=ai-knowledge
MEMORY_MASON_SYNC=true
MEMORY_MASON_CAPTURE_MODE=full
```

### JSON format

`vaultPath` sets the Obsidian vault location. `subfolder` sets the directory inside the vault. `sync` is optional — capture is enabled by default; set it to `false` to pause capture. `captureMode` is optional — set it to `full` to keep detailed tool output, or leave it at the default `lite` mode for compact capture. Use this format for `memory-mason.json` in a project root or `~/.memory-mason/config.json` for global config (`/mmsetup` creates the global file automatically).

```json
{
  "vaultPath": "/path/to/your/obsidian/vault",
  "subfolder": "ai-knowledge",
  "sync": true,
  "captureMode": "full"
}
```

## Uninstall

Platform-specific removal:

| Agent | Uninstall method |
|:------|:-----------------|
| **Claude Code** (plugin) | `/plugin uninstall memory-mason` |
| **Claude Code** (shell) | `bash hooks/uninstall.sh` or `powershell -File hooks\uninstall.ps1` |
| **Copilot** | `/mmsetup` uninstall (removes hook files + workspace JSON) |
| **Codex** | `/mmsetup` uninstall (removes hook files + `.codex/hooks.json` entries) |
| **Cursor / Windsurf / Cline** | `npx skills remove s-gryt/memory-mason -a <agent>` |

To also remove global config: delete `~/.memory-mason/config.json`. Vault content (daily logs, knowledge articles) is never deleted.

## How It Works

### Capture

Hooks append session activity into a folder-per-day structure: `{vault}/{subfolder}/_raw/YYYY-MM-DD/`. Each daily folder contains chunk files (`001.md`, `002.md`, …) capped at 500KB each, an `index.md` with wikilinks to all chunks, and a `meta.json` chunk registry. No API key required — hooks write directly to the filesystem. Capture happens silently during every AI session.

```text
[AI Conversation] ──> [Hook Runtime] ──> _raw/YYYY-MM-DD/001.md  (auto-rotates at 500KB)
```

Memory Mason's own commands (`/mmc`, `/mmq`, `/mml`, `/mms`, `/mma`, `/mmsetup`) and namespaced
`/memory-mason:*` forms are automatically excluded from capture. You can compile, query, and
manage your knowledge base at any time without those interactions appearing in your daily logs or
producing duplicate entries. This works through three layers:

1. **Prompt skip** — `user-prompt-submit.js` detects supported Memory Mason commands, including `/memory-mason:*`, and skips writing them to the daily log. It sets an `mmSuppressed` flag in capture state.
2. **Capture state flag** — `post-tool-use.js` and `pre-compact.js` check the `mmSuppressed` flag and skip capture while it is active. The flag resets on the next non-Memory Mason prompt.
3. **Transcript filter** — `session-end.js` runs `filterMmTurns()` to strip any supported Memory Mason user turns and their paired assistant replies from the full session transcript before writing.

To exclude entire sessions from capture, set `sync` to `false` in your config file.

### Compile

Run `/mmc` to compile daily logs into structured knowledge articles. The host LLM reads raw logs and produces concept pages and Q&A entries in `concepts/`, plus MOC-driven linking through `atlas/` pages and `[[wikilinks]]` for Obsidian graph navigation. Compilation also generates session bootstrap context at `_meta/context.md`, updates `_meta/manifest.json` for source-to-page lineage tracking, and writes compile state at `_meta/state.json`.

For large daily logs (over 50KB), `/mmc` splits the content into chunks and compiles them incrementally with per-chunk checkpoints in `_meta/state.json`. Already-compiled chunks are skipped on re-runs.

```text
_raw/YYYY-MM-DD/ ──> /mmc ──> concepts/
                             atlas/
                             synthesis/
                             index.md
                             _meta/context.md     (session bootstrap cache)
                             _meta/manifest.json  (source-to-page lineage)
```

### Retrieve

Run `/mmq` with a question. Memory Mason checks `_meta/context.md` first for recent context, then reads compiled articles, synthesizes an answer, and cites sources with `[[wikilinks]]` back to the original concepts. Your knowledge base grows with every session.

```text
/mmq "How does X work?" ──> _meta/context.md ──> concepts/ + atlas/ + synthesis/ ──> answer with [[citations]]
```

## Vault Layout

```text
{vault}/{subfolder}/
├── _raw/                    # Daily captures — excluded from Obsidian graph
│   └── YYYY-MM-DD/
│       ├── 001.md
│       ├── 002.md
│       ├── index.md         # Wikilinks to all chunks for that day
│       └── meta.json
├── _meta/                   # Operational files — excluded from graph
│   ├── state.json
│   ├── manifest.json
│   ├── log.md
│   ├── context.md           # LLM session bootstrap (replaces hot.md)
│   ├── taxonomy.md
│   └── folds/               # Archived log folds
├── atlas/                   # MOCs — graph visible
│   ├── home.md
│   └── {topic-slug}.md
├── concepts/                # Atomic permanent notes — graph visible
├── synthesis/               # Cross-session insights — graph visible
└── index.md                 # Content catalog with type column
```

## Hook Coverage

| Event | Claude Code | Copilot | Codex |
|:------|:-----------:|:-------:|:-----:|
| SessionStart | Y | Y | Y |
| UserPromptSubmit | Y | Y | Y |
| UserPromptExpansion | — | — | — |
| PostToolUse | Y | Y | Y |
| PreCompact | Y | Y | — |
| Stop | Y | Y | Y |
| SessionEnd | Y | Y | — |

`session-end.js` handles both events: `Stop` appends latest assistant turns; `SessionEnd` captures the full transcript.

## Capture Behavior

`captureMode` controls how much session detail is written to the vault. Set via `MEMORY_MASON_CAPTURE_MODE` env var or `captureMode` in config. Default is `lite`.

### Hook × CaptureMode

| Hook | Script | Lite | Full |
|:-----|:-------|:-----|:-----|
| SessionStart | session-start.js | Runs — outputs context to AI | Runs — outputs context to AI |
| UserPromptSubmit | user-prompt-submit.js | Captures every user prompt | Captures every user prompt |
| PostToolUse | post-tool-use.js | Allowlist: `AskUserQuestion` only | Blocklist: skip `NOISY_TOOLS` only |
| Stop | session-end.js | Captures final assistant turn only | Captures all new assistant turns since last Stop |
| PreCompact | pre-compact.js | Skips entirely | Captures full transcript (skipped if < 5 turns or duplicate within 60 s) |
| SessionEnd | session-end.js | Skips entirely | Captures filtered transcript (MM turns removed, duplicate-guarded) |

### PostToolUse Tool Filter

Tool name matching is exact and case-sensitive.

| Tool | Lite | Full | Reason |
|:-----|:-----|:-----|:-------|
| `AskUserQuestion` | Captured | Captured | In `USER_INPUT_TOOLS` allowlist |
| `Bash`, `Edit`, `Write`, `Grep`, `Agent`, `WebFetch`, `WebSearch`, `ExitPlanMode` | Skipped | Captured | Not in either set |
| `Read`, `Glob`, `LS`, `List`, `ls`, `read`, `glob` | Skipped | Skipped | In `NOISY_TOOLS` blocklist |
| All other MCP tools | Skipped | Captured | Not in either set |
| *(empty tool name)* | Skipped | Skipped | Always skipped |

### Content Filtering

Applied by `normalizeTranscriptText` during JSONL transcript parsing.

| Content | Lite | Full |
|:--------|:-----|:-----|
| `<thinking>` blocks | Stripped | Preserved |
| `<system-reminder>` blocks | Stripped | Preserved |
| Consecutive assistant turns | Collapsed — last in each consecutive run kept | Preserved |
| Local command stdout | Extracted and ANSI-stripped | Extracted and ANSI-stripped |
| Other text | Passed through | Passed through |

### What Reaches the Vault

| Signal | Lite | Full |
|:------|:-----|:-----|
| User prompts | Every prompt | Every prompt |
| `AskUserQuestion` Q+A | Every answer (full JSON: question + answer + annotations) | Every answer (full JSON) |
| Final assistant reply | 1 per Stop | All new turns since last Stop |
| Tool outputs | Never | Most (except `NOISY_TOOLS`) |
| Full transcript dump | Never | On SessionEnd + PreCompact |
| `<thinking>` / `<system-reminder>` | Never | Preserved inline |

## Platform Manifests

| Surface | Path | Purpose |
|:--------|:-----|:--------|
| Claude Code | [.claude-plugin/plugin.json](../.claude-plugin/plugin.json) | Plugin marketplace entry |
| Copilot plugin | [.github/plugin/plugin.json](../.github/plugin/plugin.json) | Copilot and VS Code plugin manifest |
| Copilot plugin hooks | [../hooks.json](../hooks.json) | Copilot CLI and VS Code hook configuration |
| Copilot marketplace | [.github/plugin/marketplace.json](../.github/plugin/marketplace.json) | Copilot CLI and VS Code marketplace |
| Codex | [plugins/memory-mason/.codex-plugin/plugin.json](../plugins/memory-mason/.codex-plugin/plugin.json) | Codex marketplace entry |
| Codex agents | [.agents/plugins/marketplace.json](../.agents/plugins/marketplace.json) | Codex agent marketplace |
| Gemini CLI | [gemini-extension.json](../gemini-extension.json) + [GEMINI.md](../GEMINI.md) | Extension metadata |
| Agent Skills | [skills/](../skills) | Cross-agent knowledge base skills |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | Hook coverage + artifact sync |

## Development

```bash
cd hooks
npm install
npm test
npm run coverage
```

`npm run coverage` enforces 100% line, statement, function, and branch coverage for shared logic in `hooks/lib/`. Hook entry scripts are covered by behavior tests in `hooks/__tests__/`.

## License

MIT. See [LICENSE](../LICENSE).
