# Contributing

## Scope

Memory Mason is a publishable multi-agent plugin and skills repo. Keep changes minimal, product-facing, and consistent across all install surfaces.

## Source of truth

- Edit root skills in `skills/`
- Edit always-on rule text in `rules/kb-activate.md`
- Edit runtime behavior in `hooks/`
- Edit release version in `VERSION`
- Edit product docs in `README.md` and `docs/README.md`

Do not hand-edit generated copies under `.cursor/skills`, `.windsurf/skills`, `plugins/memory-mason/skills`, `.clinerules`, or `.github/copilot-instructions.md`.

## Validation

Run these before publishing or merging behavior changes:

```bash
node scripts/version-sync.mjs check
cd hooks
npm test
npm run coverage
```

Coverage gate applies to shared hook logic under `hooks/lib/`. Hook entry scripts are behavior-tested separately.

Run `node scripts/version-sync.mjs sync` after changing `VERSION` to propagate new release version into tracked manifests.

Also check manifest and naming consistency across:

- `.claude-plugin/`
- `.agents/plugins/marketplace.json`
- `plugins/memory-mason/.codex-plugin/plugin.json`
- `gemini-extension.json`

## Release hygiene

- Use `x.y.z` semantic versioning in `VERSION`.
- Bump patch (`x.y.Z`) for fixes and refactors.
- Bump minor (`x.Y.0`) for backward-compatible feature additions.
- Bump major (`X.0.0`) for breaking changes.
- Keep real vault config out of git
- Keep product name aligned to `Memory Mason`
- Keep repository URL aligned to `https://github.com/s-gryt/memory-mason`
- Update docs when install commands or command names change
