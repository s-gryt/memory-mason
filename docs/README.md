# Memory Mason — Technical Reference

Cross-LLM Obsidian sync. Hook-based capture + reusable KB skills across Claude Code, GitHub Copilot, Codex, Gemini CLI, Cursor, Windsurf, Cline, and other Agent Skills hosts.

## Install by Platform

### Claude Code

**Plugin marketplace (recommended):**

```
/plugin marketplace add s-gryt/memory-mason
/plugin install memory-mason@memory-mason
```

Restart Claude Code. Runtime installs to `~/.claude/plugins/marketplaces/memory-mason/`.

**Shell installer (alternative):**

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent claude
```

```powershell
# Windows PowerShell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent claude
```

The shell installer copies runtime to `~/.claude/hooks/memory-mason/`, wires 6 events in `~/.claude/settings.json`, and creates `~/.memory-mason/config.json`. Restart Claude Code after install.

**From a local clone:**

```bash
bash install.sh --agent claude
powershell -File install.ps1 -Agent claude
```

### GitHub Copilot

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent copilot
```

```powershell
# Windows PowerShell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent copilot
```

Copies runtime to `~/.copilot/hooks/memory-mason/`, generates workspace hook JSON, creates `~/.memory-mason/config.json`.

GitHub Copilot install is split:

- `npx skills add s-gryt/memory-mason -a github-copilot` installs `/mm*` skills
- Memory Mason installer installs capture hooks + vault config

Run both if you want both commands and automatic capture.

**From a local clone:**

```bash
bash install.sh --agent copilot
powershell -File install.ps1 -Agent copilot
```

#### Workspace-level install

```bash
bash install.sh --agent copilot --workspace /path/to/project
```

Remove workspace hooks:

```bash
node hooks/uninstall-copilot-hooks.js --workspace /path/to/project
```

#### Direct Node installer (manual path)

Shell/PowerShell wrappers above are preferred. For lower-level control:

```bash
node hooks/install-copilot-hooks.js                            # user-level
node hooks/install-copilot-hooks.js --workspace /path/to/repo  # workspace-level
```

Remove:

```bash
node hooks/uninstall-copilot-hooks.js
```

> **Why Node?** Copilot hooks are JSON config entries that run shell commands. Memory Mason's hook JSON calls `node ".../session-start.js"` and related `.js` entrypoints. Node is a Memory Mason runtime dependency, not a Copilot requirement.

### Codex

**Marketplace:** Open `/plugins`, search `Memory Mason`, install.

**Shell installer:**

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent codex
```

```powershell
# Windows PowerShell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent codex
```

### All Agents at Once

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.sh) --agent all
```

```powershell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/s-gryt/memory-mason/main/install.ps1 -UseBasicParsing).Content)) -Agent all
```

### Skills-Only Hosts

Cursor, Windsurf, Cline, and other [Agent Skills](https://agentskills.io) hosts get KB commands without hooks:

```bash
npx skills add s-gryt/memory-mason -a cursor -s '*' -y
npx skills add s-gryt/memory-mason -a windsurf -s '*' -y
npx skills add s-gryt/memory-mason -a cline -s '*' -y
npx skills add s-gryt/memory-mason              # any host
```

`npx skills` discovers skills from [skills/](../skills) and installs them into the target agent. No `.github/skills/` copies needed.

### Gemini CLI

```bash
gemini extensions install https://github.com/s-gryt/memory-mason
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
| **Claude Code** (plugin) | Registers in plugin marketplace | `~/.claude/plugins/marketplaces/memory-mason/` |
| **Claude Code** (shell) | Wires 6 hook events in `~/.claude/settings.json` | `~/.claude/hooks/memory-mason/` |
| **GitHub Copilot** | Generates workspace hook JSON + copies runtime | `~/.copilot/hooks/memory-mason/` |
| **Codex** | Writes `.codex/hooks.json` + copies runtime | `~/.codex/hooks/memory-mason/` |
| **Cursor** | Skills only (no hook system) | `npx skills add` |
| **Windsurf** | Skills only (no hook system) | `npx skills add` |

## Runtime Model

Hooks append session activity into `{vault}/{subfolder}/daily/YYYY-MM-DD.md`. No API key required — hooks write directly to the filesystem.

| Command | Action |
|:--------|:-------|
| `/mmc` | Compile daily logs into knowledge articles under `knowledge/` |
| `/mmq` | Answer from compiled KB with `[[wikilink]]` citations |
| `/mml` | Report KB quality issues |
| `/mms` | Show KB status and compilation coverage |

## Configuration

Config resolves in this order (first match wins):

| Priority | Source | Location |
|:--------:|:-------|:---------|
| 1 | Env var | `MEMORY_MASON_VAULT_PATH` |
| 2 | Project config | `memory-mason.json` in project root |
| 3 | Project `.env` | `MEMORY_MASON_VAULT_PATH` + optional `MEMORY_MASON_SUBFOLDER` |
| 4 | Global config | `~/.memory-mason/config.json` |

If no source is found, hooks throw an explicit error.

**`memory-mason.json`:**

```json
{
  "vaultPath": "~/ObsidianVault",
  "subfolder": "ai-knowledge"
}
```

**`.env`:**

```env
MEMORY_MASON_VAULT_PATH=/path/to/your/obsidian/vault
MEMORY_MASON_SUBFOLDER=memory-mason
```

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
| SessionEnd / Stop | Y | Y | Y |

`user-prompt-submit.js` can parse `UserPromptExpansion`, but Memory Mason does not auto-register that Claude hook because current Claude plugin validation can reject the event key.

## Platform Manifests

| Surface | Path | Purpose |
|:--------|:-----|:--------|
| Claude Code | [.claude-plugin/plugin.json](../.claude-plugin/plugin.json) | Plugin marketplace entry |
| Codex | [plugins/memory-mason/.codex-plugin/plugin.json](../plugins/memory-mason/.codex-plugin/plugin.json) | Codex marketplace entry |
| Codex agents | [.agents/plugins/marketplace.json](../.agents/plugins/marketplace.json) | Codex agent marketplace |
| Gemini CLI | [gemini-extension.json](../gemini-extension.json) + [GEMINI.md](../GEMINI.md) | Extension metadata |
| Copilot | [AGENTS.md](../AGENTS.md) | Skill references for Copilot |
| Agent Skills | [skills/](../skills) | Cross-agent KB skills |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | Hook coverage + artifact sync |

## Development

```bash
cd hooks
npm install
npm test
npm run coverage
```

`npm run coverage` enforces 100% line, statement, function, and branch coverage for shared logic in `hooks/lib/`. Hook entry scripts are covered by behavior tests in `hooks/__tests__/entrypoints.test.js`.

## License

MIT. See [LICENSE](../LICENSE).
