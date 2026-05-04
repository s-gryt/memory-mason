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

1. project `.env`
2. project `memory-mason.json`
3. `~/.memory-mason/.env`
4. `~/.memory-mason/config.json`

`.env` sources use their own `MEMORY_MASON_SUBFOLDER` when present and otherwise default to
`ai-knowledge`. JSON sources use their own `subfolder`. Memory Mason command traffic (`/mmc`,
`/mmq`, `/mml`, `/mms`, `/mma`, `/mmsetup`, and `/memory-mason:*`) is operational noise and must
not be written into the vault.

## Commands

- `/mmc` — Process today's conversation log into knowledge articles
- `/mmq [question]` — Search the knowledge base for relevant knowledge
- `/mml` — Run health checks on the knowledge base
- `/mms` — Show knowledge base statistics
- `/mma` — Fold older build-log entries into archived summaries
- `/mmsetup` — Configure or uninstall Memory Mason for this repo

When a user asks about past decisions, patterns, or lessons, check the knowledge base with `/mmq`
before answering from general knowledge.
