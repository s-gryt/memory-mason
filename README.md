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

Memory Mason hooks into your AI coding agent and silently captures every conversation into daily Obsidian logs. When you're ready, run `/mmc` and the host LLM compiles raw logs into structured knowledge articles — concepts, connections, and Q&A — all interlinked with `[[wikilinks]]`.

No API key needed. No cloud sync. Everything stays local in your Obsidian vault.

```text
[AI Conversation] ──> [Hook Runtime] ──> [Obsidian Vault]
   (any agent)          (automatic)        daily/YYYY-MM-DD.md
                                                  │
                                            /mmc compile
                                                  │
                                            knowledge/
                                            ├── concepts/
                                            ├── connections/
                                            └── qa/
```

## Commands

| Command | What it does |
|:--------|:-------------|
| `/mmc` | Compile daily logs into structured KB articles |
| `/mmq` | Answer from the compiled KB with `[[wikilink]]` citations |
| `/mml` | Run KB health checks |
| `/mms` | Show KB status and compilation coverage |

## Install

Pick your agent and run one command. Restart the host after install.

> **Prerequisite:** [Node.js](https://nodejs.org) must be installed.

| Agent | Install command |
|:------|:----------------|
| **Claude Code** | `/plugin marketplace add s-gryt/memory-mason` |
| **Codex** | Open `/plugins`, search `Memory Mason`, install |
| **Gemini CLI** | `gemini extensions install https://github.com/s-gryt/memory-mason` |
| **Cursor / Windsurf / Cline** | `npx skills add s-gryt/memory-mason -a <agent> -s '*' -y` |

<details>
<summary><strong>Claude Code — full steps</strong></summary>

Two commands inside Claude Code (no terminal needed):

```
/plugin marketplace add s-gryt/memory-mason
/plugin install memory-mason@memory-mason
```

Restart Claude Code. Runtime installs to `~/.claude/plugins/marketplaces/memory-mason/`.

Alternatively, install with the shell installer:

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent claude

# Windows PowerShell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent claude
```

</details>

<details>
<summary><strong>GitHub Copilot</strong></summary>

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent copilot

# Windows PowerShell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent copilot
```

For both commands and capture, also run:

```bash
npx skills add s-gryt/memory-mason -a github-copilot
```

</details>

<details>
<summary><strong>All agents at once</strong></summary>

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent all

# Windows PowerShell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent all
```

</details>

See [docs/README.md](docs/README.md) for workspace-level installs, from-source builds, uninstall instructions, and advanced configuration.

## Configuration

The installer creates `~/.memory-mason/config.json` automatically. Point it at your Obsidian vault:

```json
{
  "vaultPath": "~/ObsidianVault",
  "subfolder": "ai-knowledge"
}
```

Config resolves in priority order: env var `MEMORY_MASON_VAULT_PATH` → project `memory-mason.json` → project `.env` → global `~/.memory-mason/config.json`. See [docs/README.md](docs/README.md) for details.

## Packaging

| Surface | Path |
|:--------|:-----|
| Claude Code plugin | [.claude-plugin](.claude-plugin) |
| Codex plugin | [plugins/memory-mason](plugins/memory-mason) |
| Gemini CLI extension | [gemini-extension.json](gemini-extension.json) + [GEMINI.md](GEMINI.md) |
| Agent Skills source | [skills](skills) |
| Hook runtime | [hooks](hooks) |
| CI | [.github/workflows/ci.yml](.github/workflows/ci.yml) |

## License

MIT. See [LICENSE](LICENSE).
