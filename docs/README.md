# Memory Mason — Technical Reference

Cross-LLM Obsidian sync. Hook-based capture + reusable knowledge base skills across Claude Code, GitHub Copilot, Codex, Gemini CLI, Cursor, Windsurf, Cline, and other Agent Skills hosts.

## Plugin Install

Install Memory Mason as a plugin. Hooks and skills auto-wire on install. Run `/mmsetup` after install to configure your vault path.

### Claude Code

```
/plugin marketplace add s-gryt/memory-mason
/plugin install memory-mason@s-gryt
```

Restart Claude Code. Plugin cache lives under `~/.claude/plugins/`.

### GitHub Copilot

GitHub Copilot CLI:

```
copilot plugin install s-gryt/memory-mason
```

Or install from the Memory Mason marketplace:

```
copilot plugin marketplace add s-gryt/memory-mason
copilot plugin install memory-mason@s-gryt
```

VS Code:

1. Open Command Palette.
2. Run `Chat: Install Plugin From Source`.
3. Enter `https://github.com/s-gryt/memory-mason`.

To add Memory Mason to `@agentPlugins` search, add this to VS Code settings:

```json
"chat.plugins.marketplaces": [
  "s-gryt/memory-mason"
]
```

### Codex

Open `/plugins`, search `Memory Mason`, install.

### Gemini CLI

```bash
gemini extensions install https://github.com/s-gryt/memory-mason
```

## Skills Install (npx)

For Cursor, Windsurf, Cline, and other [Agent Skills](https://agentskills.io) hosts:

```bash
npx skills add s-gryt/memory-mason -a cursor -s '*' -y
npx skills add s-gryt/memory-mason -a windsurf -s '*' -y
npx skills add s-gryt/memory-mason -a cline -s '*' -y
npx skills add s-gryt/memory-mason -a github-copilot
npx skills add s-gryt/memory-mason              # any host
```

`npx skills add` installs knowledge base commands (`/mmc`, `/mmq`, `/mml`, `/mms`, `/mmsetup`) but does **not** install hooks or configure your vault.

Run `/mmsetup` after install. It configures your vault path and installs capture hooks via the shell installer for your OS. Platforms without a native hook system (Cursor, Windsurf, Cline) get knowledge base commands only.

## Shell Install (backup)

Shell installers copy hook runtime, wire events, and create vault config in one step. Use these if you prefer not to use the plugin system.

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent <name>

# Windows PowerShell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent <name>
```

Replace `<name>` with `claude`, `copilot`, `codex`, or `all`.

From a local clone:

```bash
bash install.sh --agent <name>
powershell -File install.ps1 -Agent <name>
```

### Installer Flags

| Flag | Effect |
|:-----|:-------|
| `--agent <name>` | Skip interactive prompt (`claude`, `copilot`, `codex`, `all`) |
| `--workspace <path>` | Install Copilot/Codex hooks at workspace level |
| `-Force` (PowerShell) | Reinstall even if already installed |

> Remote PowerShell parameters do not flow through `iwr ... | iex`; use the `scriptblock` form shown above.

### What Gets Installed

| Agent | What the installer does | Runtime location |
|:------|:------------------------|:-----------------|
| **Claude Code** | Wires 6 hook events in `~/.claude/settings.json` | `~/.claude/hooks/memory-mason/` |
| **GitHub Copilot** | Generates 6 workspace hook JSON files + copies runtime | `~/.copilot/hooks/memory-mason/` |
| **Codex** | Writes `.codex/hooks.json` + copies runtime | `~/.codex/hooks/memory-mason/` |

## Configuration

Run `/mmsetup` to configure your vault path interactively. Or set it up manually using any of these methods.

Config resolves in this order (first match wins):

| Priority | Source | Location | Best for |
|:--------:|:-------|:---------|:---------|
| 1 | Env var | `MEMORY_MASON_VAULT_PATH` | CI, containers |
| 2 | Project config | `memory-mason.json` in project root | Per-project override |
| 3 | Project `.env` | `MEMORY_MASON_VAULT_PATH` + optional `MEMORY_MASON_SUBFOLDER` | Per-project override |
| 4 | Global config | `~/.memory-mason/config.json` | Default for all projects |

If no source is found, hooks throw an explicit error.

### Global config (recommended for most users)

Created automatically by `/mmsetup` or shell installers. Works across all projects.

**`~/.memory-mason/config.json`:**

```json
{
  "vaultPath": "~/ObsidianVault",
  "subfolder": "ai-knowledge"
}
```

### Per-project config

Override the global config for a specific project. Useful when different projects write to different vaults or subfolders.

**`memory-mason.json`** in project root:

```json
{
  "vaultPath": "/path/to/your/obsidian/vault",
  "subfolder": "my-project"
}
```

**`.env`** in project root:

```env
MEMORY_MASON_VAULT_PATH=/path/to/your/obsidian/vault
MEMORY_MASON_SUBFOLDER=my-project
```

Both formats work identically. Use `.env` if your project already has one; use `memory-mason.json` if you prefer a dedicated config file.

## Uninstall

Run `/mmsetup` and say "uninstall" for guided removal. Your vault content (daily logs, knowledge articles) is never deleted.

Platform-specific alternatives:

| Agent | Uninstall method |
|:------|:-----------------|
| **Claude Code** (plugin) | `/plugin uninstall memory-mason` |
| **Claude Code** (shell) | `bash hooks/uninstall.sh` or `powershell -File hooks\uninstall.ps1` |
| **Copilot** | `/mmsetup` uninstall (removes hook files + workspace JSON) |
| **Codex** | `/mmsetup` uninstall (removes hook files + `.codex/hooks.json` entries) |
| **Cursor / Windsurf / Cline** | `npx skills remove s-gryt/memory-mason -a <agent>` |

To also remove global config: delete `~/.memory-mason/config.json`.

## How It Works

### Capture

Hooks append session activity into `{vault}/{subfolder}/daily/YYYY-MM-DD.md`. No API key required — hooks write directly to the filesystem. Capture happens silently during every AI session.

```text
[AI Conversation] ──> [Hook Runtime] ──> daily/YYYY-MM-DD.md
```

### Compile

Run `/mmc` to compile daily logs into structured knowledge articles. The host LLM reads raw logs and produces concept pages, connection pages, and Q&A entries — all linked with `[[wikilinks]]` for Obsidian graph navigation.

```text
daily/YYYY-MM-DD.md ──> /mmc ──> knowledge/concepts/
                                  knowledge/connections/
                                  knowledge/qa/
```

### Retrieve

Run `/mmq` with a question. Memory Mason reads compiled articles, synthesizes an answer, and cites sources with `[[wikilinks]]` back to the original concepts. Your knowledge base grows with every session.

```text
/mmq "How does X work?" ──> reads knowledge/ ──> answer with [[citations]]
```

### Commands

| Command | Action |
|:--------|:-------|
| `/mmc` | Compile daily logs into structured knowledge articles |
| `/mmq` | Answer questions from the knowledge base with `[[wikilink]]` citations |
| `/mml` | Report knowledge base quality issues |
| `/mms` | Show knowledge base status and compilation coverage |
| `/mmsetup` | First-time vault configuration (or uninstall) |

## Vault Layout

```text
{vault}/{subfolder}/
├── daily/
│   └── 2026-04-28.md
├── knowledge/
│   ├── index.md
│   ├── log.md
│   ├── concepts/
│   ├── connections/
│   └── qa/
└── state.json
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
