# CLAUDE.md — Memory Mason

## Project overview

Memory Mason captures AI coding sessions with hooks and turns them into an Obsidian knowledge base. It ships as a Claude Code plugin, Codex plugin, Gemini CLI extension, and a multi-skill Agent Skills repository.

## Single source of truth

Edit these files directly:

| File | Owns |
| ----- | ----- |
| `skills/mmc/SKILL.md` | Compile workflow |
| `skills/mmq/SKILL.md` | Query workflow |
| `skills/mml/SKILL.md` | Lint workflow |
| `skills/mms/SKILL.md` | Status workflow |
| `skills/mmsetup/SKILL.md` | Setup / install workflow |
| `rules/kb-activate.md` | Always-on knowledge base rule text |
| `hooks/` | Runtime capture behavior |
| `VERSION` | Shared plugin/package version for releasable manifests |
| `README.md` | Product front door |
| `docs/README.md` | Platform details |
| `.github/workflows/ci.yml` | Hook validation + generated artifact sync |

## Generated copies

These are synced from the source files above and should not be edited manually:

| Path | Source |
| ----- | ------ |
| `.cursor/skills/*/SKILL.md` | `skills/*/SKILL.md` |
| `.windsurf/skills/*/SKILL.md` | `skills/*/SKILL.md` |
| `plugins/memory-mason/skills/*/SKILL.md` | `skills/*/SKILL.md` |
| `mmc.skill`, `mmq.skill`, `mml.skill`, `mms.skill` | ZIP archives of `skills/mmc`, `skills/mmq`, `skills/mml`, `skills/mms` |
| `.clinerules/memory-mason.md` | `rules/kb-activate.md` |
| `.cursor/rules/memory-mason.mdc` | `rules/kb-activate.md` + Cursor frontmatter |
| `.windsurf/rules/memory-mason.md` | `rules/kb-activate.md` + Windsurf frontmatter |
| `.github/copilot-instructions.md` | `rules/kb-activate.md` block |

## Important behavior notes

- `npx skills add` reads source skills from `skills/` in this repo. It does not require checked-in `.github/skills/` copies.
- Hook config resolution order is: `MEMORY_MASON_VAULT_PATH` env var, `memory-mason.json` in project root, `.env` in project root, then `~/.memory-mason/config.json` global config. It throws if none are found.
- Claude Code one-command install scripts are `hooks/install.sh` and `hooks/install.ps1`.
- Claude Code install bootstraps `~/.memory-mason/config.json` for cross-project use.
- Do not commit a real `memory-mason.json`. Keep only `memory-mason.example.json` in git.
- Versioning policy: bump patch for fixes/refactors, minor for backward-compatible features, and major for breaking changes.
- Keep repo/product naming aligned to `Memory Mason` and `https://github.com/s-gryt/memory-mason`.

## Validation

- Hook tests: `cd hooks && npm test`
- Hook coverage gate: `cd hooks && npm run coverage`
- Manifest version sync check: `node scripts/version-sync.mjs check`
- Stale-name sweep: search for old ids or old repo names before release
- Manifests to check before publish: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `plugins/memory-mason/.codex-plugin/plugin.json`, `gemini-extension.json`
