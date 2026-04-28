<p align="center">
  <img src="img/cover.png" alt="Memory Mason" width="480" />
</p>

<h1 align="center">Memory Mason</h1>

<p align="center">
  <strong>Capture AI conversations. Build an Obsidian knowledge base. One command.</strong>
</p>

<p align="center">
  <a href="https://github.com/s-gryt/memory-mason/stargazers"><img src="https://img.shields.io/github/stars/s-gryt/memory-mason?style=flat&color=e8734a" alt="Stars"></a>
  <a href="https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml"><img src="https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/s-gryt/memory-mason/actions"><img src="https://s-gryt.github.io/memory-mason/badges/coverage.svg" alt="Coverage"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT"></a>
  <a href="https://code.claude.com/docs/en/discover-plugins"><img src="https://img.shields.io/badge/Claude_Code-plugin-8B5CF6" alt="Claude Code"></a>
</p>

<p align="center">
  <a href="#install">Install</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="docs/README.md">Docs</a>
</p>

---

## Install

One command installs hooks + config for your agent:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh)
```

```powershell
iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing | iex
```

Pass `--agent` to skip the interactive prompt:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent claude
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent copilot
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent codex
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent all
```

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

### Other hosts

| Host | Install |
|:-----|:--------|
| **Codex marketplace** | Open `/plugins`, search `Memory Mason`, install |
| **Gemini CLI** | `gemini extensions install https://github.com/s-gryt/memory-mason` |

<details>
<summary><strong>From source / development</strong></summary>

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

</details>

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
| UserPromptExpansion | Y | — | — |
| PostToolUse | Y | Y | Y |
| PreCompact | Y | Y | — |
| SessionEnd / Stop | Y | Y | Y |

UserPromptExpansion is Claude Code only. It captures slash-command metadata (`expansion_type`, `command_name`, `command_args`, `command_source`) before the host expands slash commands.

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
