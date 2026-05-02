# Memory Mason

@./skills/mma/SKILL.md
@./skills/mmc/SKILL.md
@./skills/mmq/SKILL.md
@./skills/mml/SKILL.md
@./skills/mms/SKILL.md
@./skills/mmsetup/SKILL.md

## Knowledge Base

This repo syncs AI conversations to an Obsidian vault.

Resolve the vault path in this priority order:

1. `MEMORY_MASON_VAULT_PATH`
2. project `.env`
3. project `memory-mason.json`
4. `~/.memory-mason/.env`
5. `~/.memory-mason/config.json`

If `MEMORY_MASON_VAULT_PATH` supplies the vault path, subfolder still falls back to project
`memory-mason.json`, then project `.env`, then `ai-knowledge`.

## Commands

- `/mmc` — Process today's conversation log into knowledge articles
- `/mmq [question]` — Search the knowledge base for relevant knowledge
- `/mml` — Run health checks on the knowledge base
- `/mms` — Show knowledge base statistics
- `/mma` — Fold older build-log entries into archived summaries
- `/mmsetup` — Configure or uninstall Memory Mason for this repo

When a user asks about past decisions, patterns, or lessons, check the knowledge base with `/mmq`
before answering from general knowledge.
