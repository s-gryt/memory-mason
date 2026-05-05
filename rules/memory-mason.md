# Memory Mason Knowledge Base

You have access to a persistent knowledge base that captures and organizes context
from AI conversations. It is available via these commands:

- `/mmc` — Compile daily captures into structured knowledge articles
- `/mmq [question]` — Query the knowledge base with source citations
- `/mml` — Run health checks on the knowledge base
- `/mms` — Show knowledge base statistics and compilation coverage
- `/mma` — Archive old build log entries to keep the log compact
- `/mmsetup` — Configure vault path or uninstall

The knowledge base is located at the vault path configured through Memory Mason config sources: project `.env`, project `memory-mason.json`, `~/.memory-mason/.env`, or `~/.memory-mason/config.json`.
Memory Mason operational commands (`/mma`, `/mmc`, `/mml`, `/mms`, `/mmq`, `/mmsetup`, and `/memory-mason:*`) are excluded from capture and should not be written back into the knowledge base.
When a user asks about past decisions, patterns, or lessons, check the knowledge
base with `/mmq` before answering from general knowledge.
