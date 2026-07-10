---
name: mml
description: >
  Lint the knowledge base for broken links, orphan pages, stale captures, and wikilink convention violations. Run as a periodic health check.
allowed-tools: "Read Glob Grep Bash(obsidian *)"
---

## Objective

Run eighteen health checks on the knowledge base and report all findings by severity.

This command is operational only. Do not write `/mml`, `/memory-mason:mml`, or their execution chatter back into the vault.

## Path Resolution

Before any other reasoning, resolve vault config in this priority order:
1. Project `./.env`
2. Project `./memory-mason.json`
3. Global `~/.memory-mason/.env`
4. Global `~/.memory-mason/config.json`

Resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Use the source that provides the vault path.

Subfolder: `.env` sources use `MEMORY_MASON_SUBFOLDER` when present, else `ai-knowledge`. JSON sources use their `subfolder` field.
If no location provides a vault path, fail fast with an explicit error naming every location checked.

Checks run against `{vault}/{subfolder}/{atlas|concepts|synthesis}/*`, `index.md`, `_meta/{state.json, manifest.json, context.md}`, `_raw/*`.

## Execution Rules

- Glob all markdown files under {vault}/{subfolder}/atlas/, {vault}/{subfolder}/concepts/, and {vault}/{subfolder}/synthesis/. Also include {vault}/{subfolder}/index.md if it exists.
- Do not lint files under `_raw/` or `_meta/` as knowledge articles, except for the explicit checks below against `_meta/manifest.json` and `_meta/context.md`.
- Parse wikilinks in the form `[[target]]` from article content.
- Treat links starting with `{subfolder}/_raw/` as valid source references. Links starting with bare `_raw/` (missing subfolder prefix) are flagged by Check 13.
- Treat bare slug links such as `[[foo]]` as format violations handled by Check 13.
- Report every issue found. Do not stop after the first failure.

## Checks

See [detailed specifications](references/checks.md) for exact rules, report formats, and edge cases for every check.

1. **Broken wikilinks** (error) — flag every `[[link]]` whose target file does not exist under `{vault}/{subfolder}`.
2. **Orphan pages** (warning) — report articles with zero inbound links from other content articles.
3. **Uncompiled raw captures** (warning) — report `_raw/YYYY-MM-DD/` folders absent from `state.json` `ingested` map.
4. **Stale articles** (warning) — report raw captures whose current hash differs from the compiled hash in `state.json`.
5. **Missing backlinks** (suggestion) — flag A→B links where B does not link back to A.
6. **Sparse articles** (suggestion) — report articles with fewer than 200 words (excluding frontmatter).
7. **Large raw captures** (warning/error) — warn >500 KB, error >2 MB total chunk size per daily folder (sum all chunk files regardless of naming layout: legacy numeric `001.md` files and session-scoped `HHMMSS-{sid8}-NNN.md` files).
8. **Manifest integrity** (error/warning/suggestion) — validate `_meta/manifest.json` structure, page references, and hash agreement with `state.json`.
9. **Session context freshness** (warning/suggestion) — validate `_meta/context.md` exists, has required frontmatter, and is not older than `last_compile`.
10. **Unresolved contradictions** (warning) — count `[!contradiction]` callouts in `concepts/` articles.
11. **Wikilink density** (suggestion) — flag concept pages with zero outbound links; flag atlas MOCs with fewer than 3 concept links.
12. **Knowledge gaps** (suggestion) — count `[!gap]` callouts in `concepts/` articles.
13. **Wikilink format convention** (error) — flag bare slugs and links missing the `{subfolder}/` prefix.
14. **Cross-project references** (error) — flag links starting with a subfolder prefix other than `{subfolder}/`.
15. **Session note coverage** (warning) — compiled date has sessions recorded in `_raw/{YYYY-MM-DD}/meta.json` (schemaVersion 2) but the corresponding `sessions/YYYY-MM-DD-{sid8}.md` file is missing.
16. **Bases integrity** (suggestion) — `atlas/bases/*.base` files expected after at least one compile are absent or contain invalid YAML.
17. **Supersede integrity** (error) — a `superseded_by` target wikilink does not resolve; a superseded concept (has `superseded_by`) has `status: evergreen`; or `has_contradiction` flag does not match callout presence.
18. **Index session rows** (warning) — a session note exists in `sessions/` with no corresponding `session` row in `index.md`.

## Output Format

- Return a markdown report grouped by severity: `### Errors (must fix)`, `### Warnings (should fix)`, `### Suggestions (nice to fix)`, and a `### Summary` with counts. If no issues: `✓ Knowledge base is healthy.`
