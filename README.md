# Memory Mason

![Memory Mason](img/cover.png)

**Capture AI conversations. Build an Obsidian knowledge base. One command.**

[![Stars](https://img.shields.io/github/stars/s-gryt/memory-mason?style=flat&color=e8734a)](https://github.com/s-gryt/memory-mason/stargazers)
[![CI](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml)
[![cov](https://raw.githubusercontent.com/s-gryt/memory-mason/gh-pages/badges/coverage.svg)](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml)
[![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-8B5CF6)](https://code.claude.com/docs/en/discover-plugins)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Sergii%20Grytsaienko-0077B5?logo=linkedin)](https://www.linkedin.com/in/sergii-grytsaienko/)

---

## What It Does

Memory Mason hooks into your AI coding agent and silently captures every conversation into daily Obsidian logs. When you're ready, run `/mmc` to compile raw logs into structured knowledge articles — concepts, synthesis pages, and MOCs — all interlinked with `[[wikilinks]]`. Then use `/mmq` to retrieve answers from your compiled knowledge base without leaving the conversation.

No API key needed. No cloud sync. Everything stays local in your Obsidian vault.

### How data flows in

```text
[AI Conversation] ──> [Hook Runtime] ──> [Smart Filter] ──> [Obsidian Vault]
   (any agent)          (automatic)       (6-stage pipe)      _raw/YYYY-MM-DD/
```

Hooks capture prompts, tool results, and session transcripts into daily log files. Before anything reaches your vault, a six-stage filtering pipeline strips noise and protects sensitive data:

1. **Tag stripping** — Removes system-reminder, system-instruction, and other injected tags
2. **ANSI removal** — Strips terminal control characters from tool output
3. **Event classification** — Categorizes each event as error, test result, discovery, exploration, meta, or noise. Exploration and meta events are discarded; errors and test results are always kept.
4. **Prose compression** — Removes filler words and hedging phrases while preserving code blocks, URLs, inline code, and quoted strings
5. **Sensitive content blocking** — Skips capture when input contains credentials, private keys, `.env` contents, or paths like `.ssh/` and `.aws/`
6. **Deduplication** — Content-hash check prevents the same data from being written twice within a session

Memory Mason's own commands (`/mmc`, `/mmq`, `/mml`, `/mms`, `/mma`, `/mmsetup`) and namespaced `/memory-mason:*` forms are automatically excluded from capture.

Raw captures are stored in session-scoped files: `_raw/YYYY-MM-DD/{HHMMSS}-{sid8}-{NNN}.md` (session start time, 8-char session id prefix, 3-digit chunk index). Each file is capped at 512 KB; a 2 MB hard cap may force a split, marked with a `[!continued]` callout. One session's prompt→answer exchange never splits across files at the soft cap. Concurrent sessions never interleave. This keeps Obsidian responsive and ensures each file stays within LLM processing limits. No data is lost — every conversation turn is preserved, and Obsidian indexes all chunks for full-text search. The raw tier is append-only by design and is never auto-deleted; archive manually if desired. Token economics (raw vs. stored token counts and savings percentage) are tracked on every capture and reported by `/mms`, whether or not `minimize` is enabled — sanitize-only changes (e.g. tag stripping) still count. Enabling `minimize` adds prose compression on top, increasing savings further. See [docs/README.md](docs/README.md) for technical details on chunked storage.

### How knowledge is built

```text
_raw/YYYY-MM-DD/ ──> /mmc compile ──> concepts/
                                       sessions/         (per-session summaries)
                                       atlas/            (MOCs + Bases views)
                                       synthesis/
                                       index.md
```

Run `/mmc` to compile daily logs into structured articles. The host LLM reads your raw logs and produces atomic concept pages, MOC navigation pages in `atlas/`, cross-session synthesis pages, and per-session summary notes in `sessions/` — all linked with `[[wikilinks]]` for Obsidian graph navigation. `atlas/bases/` holds Obsidian Bases views (sessions-timeline, decisions, contradictions, seedlings) for timeline queries; Bases requires Obsidian 1.9+.

### How knowledge is retrieved

```text
/mmq "How does auth work?" ──> _meta/context.md ──> concepts/ + atlas/ + synthesis/ ──> answer with [[citations]]
```

Run `/mmq` with a question. Memory Mason checks session context for recent focus first, then searches compiled articles (including a grep stage for exact matches) and the `sessions/` tier for temporal questions, synthesizes an answer, and cites sources with `[[wikilinks]]` back to the original concepts. `/mmq insights` surfaces candidate-skill recommendations from coaching advisories. Your knowledge base grows with every session and becomes more useful over time.

## Commands

| Command | What it does |
|:--------|:-------------|
| `/mmc` | Compile raw captures into concepts, MOCs, synthesis pages, and per-session summaries in `sessions/`; update session context and source manifest; maintain Bases views in `atlas/bases/` |
| `/mmq` | Answer questions from your knowledge base with source citations; grep stage + sessions tier for temporal queries; `/mmq insights` for coaching-advisory skill recommendations |
| `/mml` | Run knowledge base health checks (broken links, stale content, manifest integrity, and more) |
| `/mms` | Show knowledge base status, health summary, and compilation coverage; token-savings metrics tracked on every capture, larger when `minimize` is enabled |
| `/mma` | Archive old build log entries to keep the knowledge base log compact |
| `/mmsetup` | First-time vault configuration (or uninstall) |

## Install

Pick your agent. Restart the host after install.

> **Prerequisite:** [Node.js](https://nodejs.org) must be installed.

### Plugin install (recommended)

| Agent | Install command |
|:------|:----------------|
| **Claude Code** | `/plugin marketplace add s-gryt/memory-mason` then `/plugin install memory-mason@s-gryt` |
| **GitHub Copilot CLI** | `copilot plugin marketplace add s-gryt/memory-mason` then `copilot plugin install memory-mason@s-gryt` |
| **VS Code Copilot** | Command Palette → `Chat: Install Plugin From Source` → `https://github.com/s-gryt/memory-mason` |
| **Codex** | `codex plugin marketplace add s-gryt/memory-mason` then open `/plugins`, search `Memory Mason`, install |
| **Gemini CLI** | `gemini extensions install https://github.com/s-gryt/memory-mason` |
| **Cursor / Windsurf / Cline** | `npx skills add s-gryt/memory-mason -a <agent> -s '*' -y` |

After install, run `/mmsetup` to configure your Obsidian vault path.

### Shell install (direct)

For any platform, you can also install directly with a shell command:

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent <name>

# Windows PowerShell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent <name>
```

Replace `<name>` with `claude`, `copilot`, `codex`, or `all`.

See [docs/README.md](docs/README.md) for marketplace installs, workspace-level installs, and advanced configuration.

## Configuration

Run `/mmsetup` to configure your vault path interactively, or create a config file manually.
Config can be set globally (`~/.memory-mason/`) or per-project (project root). When multiple
sources exist, vault path resolves in priority order: project `.env` → project `memory-mason.json`
→ global `.env` → `~/.memory-mason/config.json`. Per-session `MEMORY_MASON_SYNC`,
`MEMORY_MASON_CAPTURE_MODE`, and `MEMORY_MASON_MINIMIZE` environment variables override file config
(process env takes highest precedence). `MEMORY_MASON_SUBFOLDER` is layered independently from the
same file priority order, so a nearer project subfolder still wins even if a different source
provided the vault path. See [docs/README.md](docs/README.md) for details.

**Project isolation:** Give each project its own `.env` or `memory-mason.json` with a dedicated
`MEMORY_MASON_SUBFOLDER` value. Projects without per-project config fall back to global config and
share a single capture stream — projects wanting data isolation must define per-project config.

**Skills-only hosts (Cursor, Windsurf, Cline, Gemini CLI):** `npx skills add` installs the six
knowledge base commands but provides no capture hooks. Hooks require plugin or shell install on a
supported hook-capable agent (Claude Code, Copilot, Codex).

### .env format

`MEMORY_MASON_VAULT_PATH` sets the Obsidian vault location. `MEMORY_MASON_SUBFOLDER` sets the
directory inside the vault. `MEMORY_MASON_SYNC` is optional — capture is enabled by default; set
it to `false` to pause capture. `MEMORY_MASON_CAPTURE_MODE` is optional and controls what gets
captured:

- **`lite`** (default) — User prompts, errors, test results, and final assistant reply per stop event. Minimal vault footprint.
- **`full`** — Everything in lite, plus all filtered tool events, plan outputs, agent findings, mid-run discoveries, and pre-compact transcripts. Exploration reads, meta tools, and noise are still filtered out.

`MEMORY_MASON_MINIMIZE` is optional — set to `true` to enable deterministic lossless
compression (whitespace and punctuation normalization) on assistant narrative text before writing to the vault. Content is compacted but never dropped; code blocks, user prompts,
URLs, quoted strings, and errors are never modified. Default is `false` (raw text stored verbatim).
Token-savings metrics are reported by `/mms` on every capture regardless of this setting; enabling it increases savings further.

Process environment variables override file config for a single session and take highest precedence.

```env
MEMORY_MASON_VAULT_PATH=/path/to/your/obsidian/vault
MEMORY_MASON_SUBFOLDER=ai-knowledge
MEMORY_MASON_SYNC=true
MEMORY_MASON_CAPTURE_MODE=lite
MEMORY_MASON_MINIMIZE=false
```

### JSON format

`vaultPath` sets the Obsidian vault location. `subfolder` sets the directory inside the vault. `sync` is optional — capture is enabled by default; set it to `false` to pause capture. `captureMode` is optional — `lite` (default) captures user prompts, errors, test results, and final assistant replies; `full` adds all filtered tool events and pre-compact transcripts. `minimize` is optional — when `true`, a deterministic compression algorithm reduces assistant narrative text before vault writes (default `false`). Use this format for `memory-mason.json` in a project root or `~/.memory-mason/config.json` for global config (`/mmsetup` creates the global file automatically).

```json
{
  "vaultPath": "/path/to/your/obsidian/vault",
  "subfolder": "ai-knowledge",
  "sync": true,
  "captureMode": "lite",
  "minimize": false
}
```

## Uninstall

Run `/mmsetup` and say "uninstall" for guided removal. Your vault content is never deleted.

For skills-only installs: `npx skills remove s-gryt/memory-mason -a <agent>`

## Troubleshooting

**Hooks fail silently by design.** They never block the agent or surface errors in the chat. If capture seems inactive:

1. **Verify capture is working.** Check `{vault}/{subfolder}/_raw/` for a folder named today's date (e.g., `2026-07-05`). Inside it you should see files named `{HHMMSS}-{sid8}-{NNN}.md`. Also inspect `{vault}/{subfolder}/_meta/state.json` — the `capture_metrics` field records the number of items written this session.

2. **Check config resolution.** The hook resolves config in this order: project `.env` → project `memory-mason.json` → `~/.memory-mason/.env` → `~/.memory-mason/config.json`. If none of these exist, the hook throws an explicit error and logs it; no vault writes occur. Run `/mmsetup` to create the global config.

3. **Disable capture for a session.** Set `MEMORY_MASON_SYNC=false` as a process environment variable (or in your project `.env`) to pause capture without uninstalling.

4. **Hook file locations per platform:**
   - Claude Code: `~/.claude/hooks/memory-mason/`
   - GitHub Copilot: `~/.copilot/hooks/memory-mason/`
   - Codex: `~/.codex/hooks/memory-mason/`

5. **Skills-only hosts.** Cursor, Windsurf, Cline, and Gemini CLI receive the six knowledge base commands but have no hook runtime installed. No capture occurs on these platforms regardless of config.

## Packaging

| Surface | Path |
|:--------|:-----|
| Claude Code plugin | [.claude-plugin](.claude-plugin) |
| GitHub Copilot plugin | [.github/plugin](.github/plugin) |
| Copilot plugin hooks | [hooks.json](hooks.json) |
| Codex plugin | [plugins/memory-mason](plugins/memory-mason) |
| Gemini CLI extension | [gemini-extension.json](gemini-extension.json) + [GEMINI.md](GEMINI.md) |
| Agent Skills source | [skills](skills) |
| Hook runtime | [hooks](hooks) |
| CI | [.github/workflows/ci.yml](.github/workflows/ci.yml) |

## License

MIT. See [LICENSE](LICENSE).

## Star History

<a href="https://www.star-history.com/?repos=s-gryt%2Fmemory-mason&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=s-gryt/memory-mason&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=s-gryt/memory-mason&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=s-gryt/memory-mason&type=date&legend=top-left" />
 </picture>
</a>
