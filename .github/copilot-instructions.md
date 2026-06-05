# Memory Mason — Coding Conventions

- Node.js + CommonJS (`require` / `module.exports`) — no ESM
- No inline comments — file-level doc-string only (`/** What this module does */`)
- Pure functional — no mutations in `hooks/lib/`
- 100% test coverage required: `cd hooks && npm run coverage`
- Domain-organized lib: `capture/` `config/` `vault/` `filter/` `state/` `economics/` `hook/` `migration/` `prompt/` `cli/` `shared/`
- Do not commit a real `memory-mason.json` — keep only `memory-mason.example.json` in git
- Versioning: patch = fixes/refactors · minor = backward-compat features · major = breaking changes
- Manifests to sync before release: `.claude-plugin/plugin.json` · `.claude-plugin/marketplace.json` · `plugins/memory-mason/.codex-plugin/plugin.json` · `gemini-extension.json`

<!-- BEGIN memory-mason -->
# Memory Mason Knowledge Base

You have access to a persistent knowledge base that captures and organizes context
from AI conversations. It is available via these commands:

- `/mmc` — Process today's conversation log into knowledge articles
- `/mmq [question]` — Search the knowledge base for relevant knowledge
- `/mml` — Run health checks on the knowledge base
- `/mms` — Show knowledge base statistics
- `/mma` — Archive old build log entries to keep the knowledge base log compact
- `/mmsetup` — Configure vault path or uninstall Memory Mason

The knowledge base is located at the vault path configured through Memory Mason config sources: project `.env`, project `memory-mason.json`, `~/.memory-mason/.env`, or `~/.memory-mason/config.json`.
Memory Mason operational commands (`/mma`, `/mmc`, `/mml`, `/mms`, `/mmq`, `/mmsetup`, and `/memory-mason:*`) are excluded from capture and should not be written back into the knowledge base.
When a user asks about past decisions, patterns, or lessons, check the knowledge
base with `/mmq` before answering from general knowledge.
<!-- END memory-mason -->
