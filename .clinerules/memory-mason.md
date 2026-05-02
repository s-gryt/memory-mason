# Memory Mason Knowledge Base

You have access to a persistent knowledge base that captures and organizes context
from AI conversations. It is available via these commands:

- `/mmc` — Process today's conversation log into knowledge articles
- `/mmq [question]` — Search the knowledge base for relevant knowledge
- `/mml` — Run health checks on the knowledge base
- `/mms` — Show knowledge base statistics

The knowledge base is located at the vault path configured through Memory Mason config sources: `MEMORY_MASON_VAULT_PATH`, project `.env`, project `memory-mason.json`, `~/.memory-mason/.env`, or `~/.memory-mason/config.json`.
When a user asks about past decisions, patterns, or lessons, check the knowledge
base with `/mmq` before answering from general knowledge.
