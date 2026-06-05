---
name: mmsetup
description: >
  Set up or remove Memory Mason. Configures vault path, installs hooks if missing,
  or uninstalls everything. Use when the user says "set up memory mason",
  "install hooks", "configure memory mason", "uninstall memory mason",
  "remove memory mason", or runs /mmsetup.
---

# Memory Mason Setup

You are setting up or removing Memory Mason for the current session.

This command is operational only. Do not write `/mmsetup`, `/memory-mason:mmsetup`, or their execution chatter back into the vault.

**Platform detection:** Check the OS before running any scripts. Use `bash` / `.sh` scripts on macOS and Linux. Use `powershell` / `.ps1` scripts on Windows. Never ask the user which OS they're on — detect it from the environment.

If the user says "uninstall", "remove", or "clean up" → skip to **Uninstall** section below.

## When is this needed?

- **Plugin install** (Claude Code, Codex): hooks auto-wired but vault path not configured yet. Run `/mmsetup` to set vault path.
- **`npx skills add` only** (Cursor, Windsurf, Cline, Copilot): skills installed but no hooks and no vault config. Run `/mmsetup` to configure vault path AND install hooks for capture.
- **Shell installer** (`install.sh` / `install.ps1`): prompts for vault path during install. `/mmsetup` not needed unless reconfiguring.

---

## Setup

### Step 1: Detect Agent

Identify which agent you are running in:
- If `CLAUDE_CONFIG_DIR` or `CLAUDE_PLUGIN_ROOT` is set -> Claude Code
- If `.github/hooks/session-start.json` exists in workspace -> GitHub Copilot workspace install already done
- If `~/.copilot/hooks/memory-mason/` exists -> GitHub Copilot user-level already done
- If `~/.codex/` or `.codex/` exists -> Codex
- Otherwise -> skills-only host (Cursor, Windsurf, Cline, etc.)

### Step 2: Check if Already Installed

For Claude Code: check `~/.claude/hooks/memory-mason/session-start.js` exists AND `~/.claude/settings.json` contains memory-mason hook entries.
For Copilot: check `~/.copilot/hooks/memory-mason/session-start.js` exists.
For Codex: check `~/.codex/hooks/memory-mason/session-start.js` exists.

If already installed: report status and skip unless user says "reinstall" or "force".

### Step 3: Configure Vault

Check if vault is already configured (file-based vault-path priority order):
1. `.env` in project root contains `MEMORY_MASON_VAULT_PATH`
2. `memory-mason.json` exists in project root
3. `~/.memory-mason/.env` contains `MEMORY_MASON_VAULT_PATH`
4. `~/.memory-mason/config.json` exists

If none found, ask user and create global config:
1. Ask: "What is the absolute path to your Obsidian vault?"
2. Ask: "What subfolder name should Memory Mason use? (default: ai-knowledge)"
3. Create `~/.memory-mason/config.json`:
```json
{ "vaultPath": "<input>", "subfolder": "<input>" }
```

Alternatively, user can create a `.env` in their project root:
```env
MEMORY_MASON_VAULT_PATH=/path/to/vault
MEMORY_MASON_SUBFOLDER=ai-knowledge
```

Or a `~/.memory-mason/.env` file:
```env
MEMORY_MASON_VAULT_PATH=/path/to/vault
MEMORY_MASON_SUBFOLDER=ai-knowledge
```

Or a `memory-mason.json` in project root:
```json
{ "vaultPath": "/path/to/vault", "subfolder": "ai-knowledge" }
```

### Step 4: Install Hooks (if missing)

Skip this step if hooks are already wired (plugin install or shell installer already ran).

Claude Code:
```bash
bash scripts/install/claude-code.sh
# Windows:
powershell -File scripts\install\claude-code.ps1
```
Or if no local clone:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/scripts/install/claude-code.sh)
```

GitHub Copilot:
```bash
bash scripts/install/copilot.sh
# Windows:
powershell -File scripts\install\copilot.ps1
```
Or remote:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/scripts/install/copilot.sh)
```

Codex:
```bash
bash scripts/install/codex.sh
# Windows:
powershell -File scripts\install\codex.ps1
```

Skills-only hosts (Cursor, Windsurf, Cline): no hook system available. Inform user that automatic session capture is not supported on this platform. Knowledge base commands (`/mmc`, `/mmq`, `/mml`, `/mms`, `/mma`) work once vault is configured.

### Step 5: Configure Obsidian Graph View (optional)

If the vault has an `.obsidian/` directory (indicating Obsidian is used), create or update `.obsidian/graph.json` with knowledge-base-optimized settings. Replace `{subfolder}` with the actual configured subfolder name (e.g., `ai-knowledge`):

```json
{
  "collapse-filter": false,
  "search": "path:{subfolder} -path:{subfolder}/_raw -path:{subfolder}/_meta",
  "showTags": false,
  "showAttachments": false,
  "hideUnresolved": true,
  "showOrphans": false,
  "collapse-color-groups": false,
  "colorGroups": [
    { "query": "path:{subfolder}/concepts", "color": { "a": 1, "rgb": 5227007 } },
    { "query": "path:{subfolder}/synthesis", "color": { "a": 1, "rgb": 13724009 } },
    { "query": "path:{subfolder}/atlas", "color": { "a": 1, "rgb": 12945088 } },
    { "query": "path:{subfolder}", "color": { "a": 1, "rgb": 4473924 } }
  ],
  "collapse-display": true,
  "showArrow": true,
  "textFadeMultiplier": -1,
  "nodeSizeMultiplier": 2,
  "lineSizeMultiplier": 0.8,
  "collapse-forces": false,
  "centerStrength": 0.25,
  "repelStrength": 20,
  "linkStrength": 1,
  "linkDistance": 80
}
```

Color scheme: concepts = green (5227007), synthesis = orange (13724009), atlas = blue (12945088), fallback = dark grey (4473924). All RGB values from the proven claude-obsidian palette. Hidden: orphan nodes, unresolved links, tags, attachments. Sidebar sections expanded (collapse = false) so user can see and adjust filters, colors, and physics. Physics tuned for readability with strong node repulsion.

The `search` field filters the graph to only show content inside the subfolder while explicitly excluding `{subfolder}/_raw` and `{subfolder}/_meta`. Each `colorGroups` entry must include the subfolder prefix in its query path. The last entry is a catch-all fallback.

Path quoting rule (Obsidian search syntax): bare `path:folder` works for single-word or hyphenated names (e.g. `path:ai-knowledge`). If the subfolder name contains spaces, wrap in double quotes: `path:"my vault"`. Apply the same quoting rule to all `path:` values in both `search` and `colorGroups` entries.

If `.obsidian/graph.json` already exists, merge the `colorGroups` and force settings without overwriting user customizations to other fields. If `.obsidian/` does not exist, skip this step silently.

### Step 6: Verify

After setup, verify:
1. Config exists at `~/.memory-mason/config.json`
2. If hooks were installed: hook runtime files exist in agent hooks dir
3. If hooks were installed: agent config is updated (settings.json / hooks.json)

Report success or troubleshoot any failures.

---

## Uninstall

Guided removal of Memory Mason hooks and configuration. Vault content (daily logs, knowledge articles) is never deleted.

### Step 1: Detect What's Installed

Check all locations:
- Claude Code hooks: `~/.claude/hooks/memory-mason/` and entries in `~/.claude/settings.json`
- Claude Code plugin: `~/.claude/plugins/marketplaces/memory-mason/`
- Copilot hooks: `~/.copilot/hooks/memory-mason/` and `.github/hooks/` JSON files in workspace
- Codex hooks: `~/.codex/hooks/memory-mason/` and `.codex/hooks.json` in workspace
- Global config: `~/.memory-mason/config.json`
- Project config: `memory-mason.json` or `.env` entries in project root

Report what was found and ask user to confirm removal.

### Step 2: Remove Hooks

For Claude Code (shell install):
```bash
bash scripts/uninstall/claude-code.sh
# Windows:
powershell -File scripts\uninstall\claude-code.ps1
```
Or if no local clone:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/scripts/uninstall/claude-code.sh)
```

For Claude Code (plugin install):
```
/plugin uninstall memory-mason
```

For Copilot: remove `~/.copilot/hooks/memory-mason/` directory and any `.github/hooks/` JSON files that reference memory-mason.

For Codex: remove `~/.codex/hooks/memory-mason/` directory and memory-mason entries from `.codex/hooks.json`.

### Step 3: Remove Config

Ask user: "Also remove vault configuration? Your vault content will not be touched."

If yes: delete `~/.memory-mason/config.json`. Remove `memory-mason.json` or Memory Mason entries from `.env` in project root if present.

### Step 4: Report

List everything that was removed. Confirm vault content is untouched. Remind user to restart their agent for changes to take effect.
