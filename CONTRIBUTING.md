# Contributing

## Scope

Memory Mason is a publishable multi-agent plugin and skills repo. Keep changes minimal, product-facing, and consistent across all install surfaces.

## Source of truth

| What | Where |
| :--- | :---- |
| Knowledge base skills | `skills/` |
| Always-on rule text | `rules/kb-activate.md` |
| Hook runtime | `hooks/` |
| Install scripts | `install.sh`, `install.ps1`, `hooks/install*.sh`, `hooks/install*.ps1` |
| Release version | `VERSION` |
| Product docs | `README.md`, `docs/README.md`, `hooks/README.md` |

Do not hand-edit generated copies under `.cursor/skills`, `.windsurf/skills`, `plugins/memory-mason/skills`, `*.skill`, `.clinerules`, or `.github/copilot-instructions.md`. CI syncs those.

## Validation

Run before publishing or merging behavior changes:

```bash
node scripts/version-sync.mjs check
cd hooks && npm test && npm run coverage
```

Coverage gate: 100% line, statement, function, and branch coverage for `hooks/lib/`. Entry scripts are behavior-tested separately.

Run `node scripts/version-sync.mjs sync` after changing `VERSION` to propagate into tracked manifests.

Check manifest consistency across:

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json`
- `plugins/memory-mason/.codex-plugin/plugin.json`
- `gemini-extension.json`

## Release hygiene

- Semantic versioning in `VERSION`: patch for fixes, minor for features, major for breaking changes
- Keep real vault config out of git (`memory-mason.json` is gitignored)
- Product name: `Memory Mason`
- Repository URL: `https://github.com/s-gryt/memory-mason`
- Update docs when install commands or command names change
