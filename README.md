# Memory Mason

![Memory Mason](img/cover.png)

**Capture AI conversations. Build an Obsidian knowledge base. One command.**

[![Stars](https://img.shields.io/github/stars/s-gryt/memory-mason?style=flat&color=e8734a)](https://github.com/s-gryt/memory-mason/stargazers)
[![CI](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml)
[![cov](https://raw.githubusercontent.com/s-gryt/memory-mason/gh-pages/badges/coverage.svg)](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-8B5CF6)](https://code.claude.com/docs/en/discover-plugins)

---

## What It Does

Memory Mason hooks into your AI coding agent and silently captures every conversation into daily Obsidian logs. When you're ready, run `/mmc` to compile raw logs into structured knowledge articles — concepts, connections, and Q&A — all interlinked with `[[wikilinks]]`. Then use `/mmq` to retrieve answers from your compiled knowledge base without leaving the conversation.

No API key needed. No cloud sync. Everything stays local in your Obsidian vault.

### How data flows in

```text
[AI Conversation] ──> [Hook Runtime] ──> [Obsidian Vault]
   (any agent)          (automatic)        daily/YYYY-MM-DD.md
```

Hooks capture prompts, tool results, and session transcripts into daily log files. This happens silently in the background — no manual steps required.

### How knowledge is built

```text
daily/YYYY-MM-DD.md ──> /mmc compile ──> knowledge/
                                          ├── concepts/
                                          ├── connections/
                                          └── qa/
```

Run `/mmc` to compile daily logs into structured articles. The host LLM reads your raw logs and produces encyclopedia-style concept pages, cross-concept connection pages, and Q&A entries — all linked with `[[wikilinks]]` for Obsidian graph navigation.

### How knowledge is retrieved

```text
/mmq "How does auth work?" ──> reads knowledge/ ──> answer with [[citations]]
```

Run `/mmq` with a question. Memory Mason reads compiled articles, synthesizes an answer, and cites sources with `[[wikilinks]]` back to the original concepts. Your knowledge base grows with every session and becomes more useful over time.

## Commands

| Command | What it does |
|:--------|:-------------|
| `/mmc` | Compile daily logs into structured knowledge articles |
| `/mmq` | Answer questions from the knowledge base with `[[wikilink]]` citations |
| `/mml` | Run knowledge base health checks |
| `/mms` | Show knowledge base status and compilation coverage |
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

Run `/mmsetup` to configure your vault path interactively. Or set it up manually using any of these methods:

**Global config** (`~/.memory-mason/config.json`):

```json
{
  "vaultPath": "~/ObsidianVault",
  "subfolder": "ai-knowledge"
}
```

**Project `.env`** (per-project override):

```env
MEMORY_MASON_VAULT_PATH=/path/to/your/obsidian/vault
MEMORY_MASON_SUBFOLDER=ai-knowledge
```

**Project `memory-mason.json`** (per-project override):

```json
{
  "vaultPath": "/path/to/your/obsidian/vault",
  "subfolder": "ai-knowledge"
}
```

Config resolves in priority order: env var `MEMORY_MASON_VAULT_PATH` → project `memory-mason.json` → project `.env` → global `~/.memory-mason/config.json`. See [docs/README.md](docs/README.md) for details.

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
