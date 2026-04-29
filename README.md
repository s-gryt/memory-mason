# Memory Mason

![Memory Mason](img/cover.png)

**Capture AI conversations. Build an Obsidian knowledge base. One command.**

[![Stars](https://img.shields.io/github/stars/s-gryt/memory-mason?style=flat&color=e8734a)](https://github.com/s-gryt/memory-mason/stargazers)
[![CI](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml)
[![cov](https://raw.githubusercontent.com/s-gryt/memory-mason/gh-pages/badges/coverage.svg)](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-8B5CF6)](https://code.claude.com/docs/en/discover-plugins)

[Install](#install) • [Commands](#commands) • [Configuration](#configuration) • [How It Works](#how-it-works) • [Docs](docs/README.md)

---

## Install

One command installs hooks + config for your agent:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh)
```

```powershell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content))
```

Pass `--agent` to skip the interactive prompt:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent claude
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent copilot
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent codex
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent all
```

```powershell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent claude
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent copilot
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent codex
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent all
```

Pass `-Force` to reinstall. Remote PowerShell parameters do not flow through `iwr ... | iex`; use the scriptblock form above.

Restart your host after install.

### What gets installed

| Agent | What the installer does | Runtime location |
|:------|:------------------------|:-----------------|
| **Claude Code** | Wires 6 hook events in `~/.claude/settings.json` | `~/.claude/hooks/memory-mason/` |
| **GitHub Copilot** | Generates workspace hook JSON + copies runtime | `~/.copilot/hooks/memory-mason/` |
| **Codex** | Writes `.codex/hooks.json` + copies runtime | `~/.codex/hooks/memory-mason/` |
| **Cursor** | Skills only (no hook system) | `npx skills add` |
| **Windsurf** | Skills only (no hook system) | `npx skills add` |

> **Node.js is required.** Hook JSON runs Memory Mason runtime through `node`. The installer checks for it and exits with an error if missing. Install from [nodejs.org](https://nodejs.org).

### Skills-only hosts

Cursor, Windsurf, Cline, and other [Agent Skills](https://agentskills.io) hosts get KB commands without hooks:

```bash
npx skills add s-gryt/memory-mason -a cursor -s '*' -y
npx skills add s-gryt/memory-mason -a windsurf -s '*' -y
npx skills add s-gryt/memory-mason -a cline -s '*' -y
npx skills add s-gryt/memory-mason              # any host
```

`npx skills` installs KB commands only. For continuous capture, use the installer above.

For GitHub Copilot, install is split:

- `npx skills add s-gryt/memory-mason -a github-copilot` installs `/mm*` skills
- Memory Mason installer installs hook capture + vault config

Run both if you want both Copilot commands and automatic capture.

### Other hosts

| Host | Install |
|:-----|:--------|
| **Codex marketplace** | Open `/plugins`, search `Memory Mason`, install |
| **Gemini CLI** | `gemini extensions install https://github.com/s-gryt/memory-mason` |

### From source / development

```bash
bash install.sh --agent claude
bash install.sh --agent copilot
bash install.sh --agent codex
bash install.sh --agent all
```

```powershell
powershell -File install.ps1 -Agent claude
powershell -File install.ps1 -Agent copilot
powershell -File install.ps1 -Agent codex
powershell -File install.ps1 -Agent all
```

Workspace-level Copilot/Codex targeting:

```bash
bash install.sh --agent copilot --workspace /path/to/project
```

Uninstall Copilot hooks:

```bash
node hooks/uninstall-copilot-hooks.js
node hooks/uninstall-copilot-hooks.js --workspace /path/to/project
```

## Commands

| Command | What it does |
|:--------|:-------------|
| `/mmc` | Compile daily logs into structured KB articles |
| `/mmq` | Answer from the compiled KB with `[[wikilink]]` citations |
| `/mml` | Run KB health checks |
| `/mms` | Show KB status and compilation coverage |

## Configuration

Config resolves in this order (first match wins):

| Priority | Source | Location |
|:--------:|:-------|:---------|
| 1 | Env var | `MEMORY_MASON_VAULT_PATH` |
| 2 | Project config | `memory-mason.json` in project root |
| 3 | Project `.env` | `MEMORY_MASON_VAULT_PATH` in `.env` |
| 4 | Global config | `~/.memory-mason/config.json` |

If no source is found, hooks throw an explicit error. The installer creates `~/.memory-mason/config.json` during setup so hooks work from any project.

```json
{
  "vaultPath": "~/ObsidianVault",
  "subfolder": "ai-knowledge"
}
```

## How It Works

```text
[AI Conversation] ---> [Hook Runtime] ---> [Obsidian Vault]
   (any agent)           (Node.js)          daily/YYYY-MM-DD.md

          |
          v
        /mmc compile
          |
          v
       [knowledge/]
       |-- index.md
       |-- concepts/
       |-- connections/
       |-- qa/
```

Hooks fire on every tool call, prompt, and session event. They append to `daily/YYYY-MM-DD.md` in your vault. Run `/mmc` when ready to compile raw logs into structured articles. No API key needed — the host LLM does the compilation.

### Hook coverage

| Event | Claude Code | Copilot | Codex |
|:------|:-----------:|:-------:|:-----:|
| SessionStart | Y | Y | Y |
| UserPromptSubmit | Y | Y | Y |
| UserPromptExpansion | — | — | — |
| PostToolUse | Y | Y | Y |
| PreCompact | Y | Y | — |
| SessionEnd / Stop | Y | Y | Y |

`user-prompt-submit.js` can parse `UserPromptExpansion`, but Memory Mason does not auto-register that Claude hook because current Claude plugin validation can reject the event key.

## Packaging

| Surface | Path |
|:--------|:-----|
| Claude Code plugin | [.claude-plugin](.claude-plugin) |
| Codex plugin | [plugins/memory-mason](plugins/memory-mason) |
| Gemini CLI extension | [gemini-extension.json](gemini-extension.json) + [GEMINI.md](GEMINI.md) |
| Agent Skills source | [skills](skills) |
| Hook runtime | [hooks](hooks) |
| CI | [.github/workflows/ci.yml](.github/workflows/ci.yml) |

See [docs/README.md](docs/README.md) for platform-specific details and development setup.

## License

MIT. See [LICENSE](LICENSE).
