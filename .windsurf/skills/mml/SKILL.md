---
name: mml
description: >
  Run health checks on the knowledge base. Finds broken wikilinks, orphan
  pages, uncompiled raw captures, stale articles, missing backlinks, sparse
  content, manifest drift, and stale session context. Reports issues by
  severity: error, warning, suggestion.
allowed-tools: "Read Glob Grep Bash(obsidian *)"
---

## Objective

Run nine health checks on the knowledge base and report all findings by severity.

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

Subfolder rules:
- If the vault path comes from an `.env` file, use `MEMORY_MASON_SUBFOLDER` from that same file when present, otherwise default to `ai-knowledge`.
- If the vault path comes from `memory-mason.json` or `~/.memory-mason/config.json`, use its `subfolder`.

Do not claim config is missing until you have attempted all four locations above. If none provide a vault path, fail fast with an explicit error that names every location checked.

Use these paths:
- Atlas: {vault}/{subfolder}/atlas/
- Concepts: {vault}/{subfolder}/concepts/
- Synthesis: {vault}/{subfolder}/synthesis/
- Index: {vault}/{subfolder}/index.md
- Raw captures: {vault}/{subfolder}/_raw/
- State file: {vault}/{subfolder}/_meta/state.json
- Manifest file: {vault}/{subfolder}/_meta/manifest.json
- Session context: {vault}/{subfolder}/_meta/context.md
- Build log: {vault}/{subfolder}/_meta/log.md

## Execution Rules

- Glob all markdown files under {vault}/{subfolder}/atlas/, {vault}/{subfolder}/concepts/, and {vault}/{subfolder}/synthesis/. Also include {vault}/{subfolder}/index.md if it exists.
- Do not lint files under `_raw/` or `_meta/` as knowledge articles, except for the explicit checks below against `_meta/manifest.json` and `_meta/context.md`.
- Parse wikilinks in the form [[path/slug]] from article content.
- Treat links starting with `_raw/` as valid source references.
- Report every issue found. Do not stop after the first failure.

## Checks

### Check 1: Broken wikilinks (severity: error)

- For each knowledge article and the root `index.md`, find all [[wikilinks]].
- Skip links starting with `_raw/`.
- Check whether each linked target exists at {vault}/{subfolder}/{link}.md.
- Report format:

```text
ERROR [broken_link] file.md: Broken link: [[target]] - target does not exist
```

### Check 2: Orphan pages (severity: warning)

- For each article in `atlas/`, `concepts/`, and `synthesis/`, count inbound links from other articles in those same content directories.
- Report any article with zero inbound links.
- Report format:

```text
WARN [orphan_page] file.md: No other articles link to [[path/slug]]
```

### Check 3: Uncompiled raw captures (severity: warning)

- Read {vault}/{subfolder}/_meta/state.json if it exists.
- Use the `ingested` map of `YYYY-MM-DD -> hash`.
- Glob all immediate subdirectories in {vault}/{subfolder}/_raw/ that match daily capture folders.
- For each folder, use the folder name `YYYY-MM-DD` as the source key.
- Report any raw capture folder that is not present in `ingested`.
- Report format:

```text
WARN [orphan_source] _raw/YYYY-MM-DD/: Not yet compiled
```

### Check 4: Stale articles (severity: warning)

- From `state.json` ingested entries, compare the current raw capture hash with the stored hash.
- Compute the current hash over the concatenated chunk contents in numeric order.
- If a raw capture changed since compilation, report it.
- Report format:

```text
WARN [stale_article] _raw/YYYY-MM-DD/: File changed since last compilation
```

- Include a recommendation to run `/mmc`.

### Check 5: Missing backlinks (severity: suggestion)

- For each article A that links to article B, check whether B also links to A.
- If A -> B exists but B -> A does not, report it.
- Report format:

```text
SUGGESTION [missing_backlink] a.md: [[a/slug]] links to [[b/slug]] but not vice versa
```

### Check 6: Sparse articles (severity: suggestion)

- Count words in each article, excluding YAML frontmatter.
- Report articles with fewer than 200 words.
- Report format:

```text
SUGGESTION [sparse_article] file.md: Only N words (minimum recommended: 200)
```

### Check 7: Large raw captures (severity: warning / error)

For each entry under `{vault}/{subfolder}/_raw/`:
- Read only numeric chunk files such as `001.md`, `002.md`, and so on.
- Sum the sizes of those chunk files for the daily capture folder.
- Ignore `meta.json` for size calculations.

Report captures over 500KB:
```text
WARN [large_daily_folder] _raw/YYYY-MM-DD/: Total {size}KB across {n} chunks. Consider running /mmc.
```

Report captures over 2MB as error:
```text
ERROR [oversized_daily_folder] _raw/YYYY-MM-DD/: Total {size}MB across {n} chunks. Run /mmc immediately.
```

### Check 8: Manifest integrity (severity: error / warning / suggestion)

- Read {vault}/{subfolder}/_meta/manifest.json if it exists.
- If it is missing, report:

```text
SUGGESTION [missing_manifest] _meta/manifest.json: No source-to-page manifest yet. Run /mmc to create lineage metadata.
```

- If it exists, it must be valid JSON with a top-level `sources` object.
- For each `sources[sourceKey]` entry:
  - `hash` must be a string
  - `compiled_at` must be a string
  - `pages_created` and `pages_updated` must be arrays of strings if present
  - every referenced page path must exist
- If a source key exists in both `state.json` and `_meta/manifest.json` and the hashes differ, report:

```text
WARN [manifest_drift] _meta/manifest.json: Source key {sourceKey} hash differs from state.json
```

- If a referenced page is missing, report:

```text
ERROR [manifest_page_missing] _meta/manifest.json: Listed page {path} does not exist
```

### Check 9: Session context freshness (severity: warning / suggestion)

- Check whether {vault}/{subfolder}/_meta/context.md exists.
- If it is missing, report:

```text
SUGGESTION [missing_context] _meta/context.md: No session context yet. Run /mmc to create one.
```

- If it exists, ensure frontmatter includes:
  - `type: meta`
  - `title: "Session Context"`
  - `updated:`
- If a required field is missing, report:

```text
WARN [invalid_context] _meta/context.md: Missing required frontmatter field {field}
```

- If `last_compile` exists in `state.json` and `context.md`'s `updated` timestamp is older than `last_compile`, report:

```text
WARN [stale_context] _meta/context.md: Session context is older than the most recent compilation
```

## Output Format

Return results exactly in this structure:

```markdown
## Knowledge Base Lint Report

### Errors (must fix)
- ERROR [broken_link] ...
- ERROR [oversized_daily_folder] ...
- ERROR [manifest_page_missing] ...

### Warnings (should fix)
- WARN [orphan_page] ...
- WARN [large_daily_folder] ...

### Suggestions (nice to fix)
- SUGGESTION [sparse_article] ...

### Summary
- Errors: N
- Warnings: N
- Suggestions: N
```

If no issues are found, output exactly:

```text
✓ Knowledge base is healthy. No issues found.
```
