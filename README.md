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

Daily logs are stored in per-day folders and auto-split into files of up to 500KB each. This keeps Obsidian responsive and ensures each file stays within LLM processing limits. No data is lost — every conversation turn is preserved, and Obsidian indexes all chunks for full-text search. Token economics (raw vs. stored token counts and savings percentage) are tracked automatically and reported by `/mms`. See [docs/README.md](docs/README.md) for technical details on chunked storage.

### How knowledge is built

```text
_raw/YYYY-MM-DD/ ──> /mmc compile ──> concepts/
                                       atlas/
                                       synthesis/
                                       index.md
```

Run `/mmc` to compile daily logs into structured articles. The host LLM reads your raw logs and produces atomic concept pages, MOC navigation pages in `atlas/`, and cross-session synthesis pages — all linked with `[[wikilinks]]` for Obsidian graph navigation.

### How knowledge is retrieved

```text
/mmq "How does auth work?" ──> _meta/context.md ──> concepts/ + atlas/ + synthesis/ ──> answer with [[citations]]
```

Run `/mmq` with a question. Memory Mason checks session context for recent focus first, then reads compiled articles, synthesizes an answer, and cites sources with `[[wikilinks]]` back to the original concepts. Your knowledge base grows with every session and becomes more useful over time.

## Commands

| Command | What it does |
|:--------|:-------------|
| `/mmc` | Compile raw captures into concepts, MOCs, and synthesis pages; update session context and source manifest |
| `/mmq` | Answer questions from your knowledge base with source citations |
| `/mml` | Run knowledge base health checks (broken links, stale content, manifest integrity, and more) |
| `/mms` | Show knowledge base status, token economics, health summary, and compilation coverage |
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
| **Codex** | Open `/plugins`, search `Memory Mason`, install |
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
→ global `.env` → `~/.memory-mason/config.json`. Per-session `MEMORY_MASON_SYNC` and
`MEMORY_MASON_CAPTURE_MODE` environment variables still override file config. See
[docs/README.md](docs/README.md) for details.

### .env format

`MEMORY_MASON_VAULT_PATH` sets the Obsidian vault location. `MEMORY_MASON_SUBFOLDER` sets the
directory inside the vault. `MEMORY_MASON_SYNC` is optional — capture is enabled by default; set
it to `false` to pause capture. `MEMORY_MASON_CAPTURE_MODE` is optional and controls what gets
captured:

- **`lite`** (default) — Session bookends only: user prompts, errors, test results, and session summaries. Minimal vault footprint.
- **`full`** — Everything in lite, plus plan outputs, agent findings, mid-run discoveries, and state-changing tool results. Exploration reads, meta-tool invocations, and noise are still filtered out.

Process environment variables `MEMORY_MASON_SYNC` and `MEMORY_MASON_CAPTURE_MODE` override file
config for a single session.

```env
MEMORY_MASON_VAULT_PATH=/path/to/your/obsidian/vault
MEMORY_MASON_SUBFOLDER=ai-knowledge
MEMORY_MASON_SYNC=true
MEMORY_MASON_CAPTURE_MODE=lite
```

### JSON format

`vaultPath` sets the Obsidian vault location. `subfolder` sets the directory inside the vault. `sync` is optional — capture is enabled by default; set it to `false` to pause capture. `captureMode` is optional — `lite` (default) captures session bookends only, `full` adds plan outputs, agent findings, and mid-run discoveries. Use this format for `memory-mason.json` in a project root or `~/.memory-mason/config.json` for global config (`/mmsetup` creates the global file automatically).

```json
{
  "vaultPath": "/path/to/your/obsidian/vault",
  "subfolder": "ai-knowledge",
  "sync": true,
  "captureMode": "lite"
}
```

## Uninstall

Run `/mmsetup` and say "uninstall" for guided removal. Your vault content is never deleted.

For skills-only installs: `npx skills remove s-gryt/memory-mason -a <agent>`

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