# Memory Mason Agent Instructions

## Available Skills

@./skills/mmc/SKILL.md
@./skills/mmq/SKILL.md
@./skills/mml/SKILL.md
@./skills/mms/SKILL.md

## Knowledge Base Structure

This project syncs AI conversations to an Obsidian vault. Configure the vault
path in `memory-mason.json` or via `MEMORY_MASON_VAULT_PATH` environment variable.

Vault layout:

- `{vault}/{subfolder}/daily/` — Append-only conversation logs (written by hooks)
- `{vault}/{subfolder}/knowledge/concepts/` — Compiled concept articles
- `{vault}/{subfolder}/knowledge/connections/` — Cross-concept synthesis articles
- `{vault}/{subfolder}/knowledge/qa/` — Filed query answers
- `{vault}/{subfolder}/knowledge/index.md` — Master catalog (use for /mmq)
- `{vault}/{subfolder}/knowledge/log.md` — Build log
- `{vault}/{subfolder}/state.json` — Compilation state

## Workflow

1. Hooks capture conversation context automatically to daily logs
2. Run `/mmc` to extract knowledge into articles
3. Run `/mmq [question]` to retrieve knowledge
4. Run `/mml` to health-check the knowledge base
5. Run `/mms` for a quick overview
