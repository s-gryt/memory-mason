# CLAUDE.md — Memory Mason

## Project overview

Memory Mason captures AI coding sessions with hooks and turns them into an Obsidian knowledge base. It ships as a Claude Code plugin, Codex plugin, Gemini CLI extension, and a multi-skill Agent Skills repository.

## Single source of truth

Edit these files directly:

| File | Owns |
| ----- | ----- |
| `skills/mma/SKILL.md` | Build-log folding workflow |
| `skills/mmc/SKILL.md` | Compile workflow |
| `skills/mmq/SKILL.md` | Query workflow |
| `skills/mml/SKILL.md` | Lint workflow |
| `skills/mms/SKILL.md` | Status workflow |
| `skills/mmsetup/SKILL.md` | Setup / install workflow |
| `rules/memory-mason.md` | Always-on knowledge base rule text |
| `hooks/` | Runtime capture behavior |
| `VERSION` | Shared plugin/package version for releasable manifests |
| `README.md` | Product front door |
| `docs/README.md` | Platform details |
| `.claude-plugin/` | Claude plugin manifests |
| `plugins/memory-mason/.codex-plugin/plugin.json` | Codex plugin manifest |
| `gemini-extension.json` | Gemini extension manifest |

## Generated copies

These are checked-in generated distribution surfaces synced from the source files above and should not be edited manually:

| Path | Source |
| ----- | ------ |
| `.cursor/skills/*/SKILL.md` | `skills/*/SKILL.md` |
| `.windsurf/skills/*/SKILL.md` | `skills/*/SKILL.md` |
| `plugins/memory-mason/skills/*/SKILL.md` | `skills/*/SKILL.md` |
| `*.skill` | ZIP archives of corresponding `skills/*` directories |
| `.clinerules/memory-mason.md` | `rules/memory-mason.md` |
| `.cursor/rules/memory-mason.mdc` | `rules/memory-mason.md` + Cursor frontmatter |
| `.windsurf/rules/memory-mason.md` | `rules/memory-mason.md` + Windsurf frontmatter |

`skills/*` are product skills shipped by Memory Mason.
`.cursor/skills/*` and `.windsurf/skills/*` are generated host-facing copies of root `skills/*`.
`plugins/memory-mason/skills/*` is generated plugin-packaged copy of root `skills/*`.
`.claude-plugin/` is publishable Claude plugin surface.

## Important behavior notes

- `npx skills add` reads source skills from `skills/` in this repo.
- Hook vault-path resolution order is: `MEMORY_MASON_VAULT_PATH` env var, `.env` in project root, `memory-mason.json` in project root, `~/.memory-mason/.env`, then `~/.memory-mason/config.json`. It throws if none are found.
- If the vault path comes from `MEMORY_MASON_VAULT_PATH`, subfolder still falls back to project `memory-mason.json`, then project `.env`, then `ai-knowledge`.
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
- Manifests to check before publish: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugins/memory-mason/.codex-plugin/plugin.json`, `gemini-extension.json`
