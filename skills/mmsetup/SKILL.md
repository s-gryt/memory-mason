---
name: mmsetup
description: >
  Set up Memory Mason hooks for the current agent/IDE. Detects the agent
  and runs the appropriate installer. Use when the user says "set up memory mason",
  "install hooks", "configure memory mason", or runs /mms setup.
---

# Memory Mason Setup

You are setting up Memory Mason hook capture for the current session.

## Step 1: Detect Agent

Identify which agent you are running in:
- If `CLAUDE_CONFIG_DIR` or `CLAUDE_PLUGIN_ROOT` is set -> Claude Code
- If `.github/hooks/session-start.json` exists in workspace -> GitHub Copilot workspace install already done
- If `~/.copilot/hooks/memory-mason/` exists -> GitHub Copilot user-level already done
- If `~/.codex/` or `.codex/` exists -> Codex

## Step 2: Check if Already Installed

For Claude Code: check `~/.claude/hooks/memory-mason/session-start.js` exists AND `~/.claude/settings.json` contains memory-mason hook entries.
For Copilot: check `~/.copilot/hooks/memory-mason/session-start.js` exists.
For Codex: check `~/.codex/hooks/memory-mason/session-start.js` exists.

If already installed: report status and skip unless user says "reinstall" or "force".

## Step 3: Ask for Vault Config

If `~/.memory-mason/config.json` does not exist:
1. Ask: "What is the absolute path to your Obsidian vault?"
2. Ask: "What subfolder name should Memory Mason use? (default: memory-mason)"
3. Create `~/.memory-mason/config.json`:
```json
{ "vaultPath": "<input>", "subfolder": "<input>" }
```

## Step 4: Run Installer

Claude Code:
```bash
bash hooks/install.sh
```
Or if no local clone:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/hooks/install.sh)
```

GitHub Copilot:
```bash
bash hooks/install-copilot-hooks.sh
# Windows:
powershell -File hooks\install-copilot-hooks.ps1
```
Or remote:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/s-gryt/memory-mason/main/hooks/install-copilot-hooks.sh)
```

Codex:
```bash
bash hooks/install-codex-hooks.sh
```

All at once (universal):
```bash
bash install.sh --agent all
# Windows:
powershell -File install.ps1 -Agent all
```

## Step 5: Verify

After running installer, verify:
1. Hook runtime files exist in agent hooks dir
2. Agent config is updated (settings.json / hooks.json)
3. Config exists at `~/.memory-mason/config.json`
4. Test by simulating a prompt:
```bash
echo '{"hookEventName":"user-prompt-submit","prompt":"setup test","cwd":"."}' | node ~/.claude/hooks/memory-mason/user-prompt-submit.js
```

Report success or troubleshoot any failures.
