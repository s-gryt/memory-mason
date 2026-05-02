# Memory Mason Agent Instructions

## Available Skills

@./skills/mma/SKILL.md
@./skills/mmc/SKILL.md
@./skills/mmq/SKILL.md
@./skills/mml/SKILL.md
@./skills/mms/SKILL.md
@./skills/mmsetup/SKILL.md

## Knowledge Base Structure

This project syncs AI conversations to an Obsidian vault. Configure the vault
path with any supported Memory Mason config source: `MEMORY_MASON_VAULT_PATH`,
project `.env`, project `memory-mason.json`, `~/.memory-mason/.env`, or
`~/.memory-mason/config.json`.

Vault layout:

- `{vault}/{subfolder}/daily/` — Captured session logs, either flat daily files or folder-per-day chunks
- `{vault}/{subfolder}/knowledge/concepts/` — Compiled concept articles
- `{vault}/{subfolder}/knowledge/connections/` — Cross-concept synthesis articles
- `{vault}/{subfolder}/knowledge/qa/` — Filed query answers
- `{vault}/{subfolder}/knowledge/folds/` — Archived build-log folds created by `/mma`
- `{vault}/{subfolder}/knowledge/index.md` — Master catalog (use for /mmq)
- `{vault}/{subfolder}/knowledge/log.md` — Build log
- `{vault}/{subfolder}/hot.md` — Startup cache refreshed by `/mmc`
- `{vault}/{subfolder}/.manifest.json` — Source-to-page lineage metadata refreshed by `/mmc`
- `{vault}/{subfolder}/state.json` — Compilation state

## Workflow

1. Run `/mmsetup` to configure vault path or uninstall integration
2. Hooks capture conversation context automatically into `daily/`
3. Run `/mmc` to compile captured logs into knowledge articles, `hot.md`, and `.manifest.json`
4. Run `/mmq [question]` to query compiled knowledge
5. Run `/mml` to health-check knowledge base
6. Run `/mms` for status overview
7. Run `/mma` to fold old `knowledge/log.md` entries into `knowledge/folds/`
