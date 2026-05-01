---
name: mml
description: >
  Run health checks on the knowledge base. Finds broken wikilinks, orphan
  pages, uncompiled daily logs, stale articles, missing backlinks, sparse
  content, manifest drift, and stale hot cache. Reports issues by severity:
  error, warning, suggestion.
allowed-tools: "Read Glob Grep Bash(obsidian *)"
---

## Objective

Run nine health checks on the knowledge base and report all findings by severity.

## Path Resolution

Before any other reasoning, read `./memory-mason.json` from the current project root and resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Do not claim config is missing until you have attempted that read.
If `./memory-mason.json` is missing, run one workspace search for `**/memory-mason.json`.
- If exactly one file is found, read it and continue.
- If multiple files are found, report the candidate paths briefly and ask which project root to use.
- If no file is found, fail fast with an explicit error.

Use these paths:
- Knowledge root: {vault}/{subfolder}/knowledge/
- Daily logs: {vault}/{subfolder}/daily/
- State file: {vault}/{subfolder}/state.json
- Manifest file: {vault}/{subfolder}/.manifest.json
- Hot cache: {vault}/{subfolder}/hot.md

## Execution Rules

- Glob all markdown files under {vault}/{subfolder}/knowledge/ recursively.
- Parse wikilinks in the form [[path/slug]] from article content.
- Treat links starting with daily/ as valid source references.
- Report every issue found. Do not stop after first failure.

## Checks

### Check 1: Broken wikilinks (severity: error)

- For each knowledge article, find all [[wikilinks]].
- Skip links starting with daily/.
- Check whether each linked target exists at knowledge/{link}.md.
- Report format:

```text
ERROR [broken_link] file.md: Broken link: [[target]] - target does not exist
```

### Check 2: Orphan pages (severity: warning)

- For each article in knowledge/, count inbound links from other knowledge articles.
- Report any article with zero inbound links.
- Report format:

```text
WARN [orphan_page] file.md: No other articles link to [[path/slug]]
```

### Check 3: Uncompiled daily logs (severity: warning)

- Read {vault}/{subfolder}/state.json if it exists.
- Use the ingested map of filename -> hash.
- Glob all .md files in {vault}/{subfolder}/daily/ (flat files). Also glob all immediate subdirectories in {vault}/{subfolder}/daily/ (folder-per-day entries). For flat files the key is the filename (e.g. "2026-04-30.md"). For folders the key is the date string (e.g. "2026-04-30"). Check each against state.json ingested map using the appropriate key format.
- Report any daily log that is not present in ingested.
- Report format:

```text
WARN [orphan_source] daily/YYYY-MM-DD.md: Not yet compiled
```

### Check 4: Stale articles (severity: warning)

- From state.json ingested entries, compare current daily log file hash with stored hash.
- For folder-per-day logs: compute hash over concatenated chunk content in numeric order. Compare against stored hash for the date key `"YYYY-MM-DD"`.
- If a file changed since compilation, report it.
- Report format:

```text
WARN [stale_article] daily/file.md: File changed since last compilation
```

- Include recommendation to run /mmc.

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

### Check 7: Large daily logs (severity: warning)

For each entry under `{vault}/{subfolder}/daily/`:
- Flat `.md` files: read file size directly.
- Folder-per-day directories: sum sizes of all `NNN.md` chunk files inside.

Report flat files over 500KB:
```text
WARN [large_daily_log] daily/YYYY-MM-DD.md: File is {size}KB (over 500KB). Run /mmc to compile.
```
Report flat files over 2MB as error:
```text
ERROR [oversized_daily_log] daily/YYYY-MM-DD.md: File is {size}MB (over 2MB). /mmc may fail. Run /mmc immediately.
```
Report folder-per-day total over 2MB as warning (chunked = Obsidian-safe, but flag for awareness):
```text
WARN [large_daily_folder] daily/YYYY-MM-DD/: Total {size}MB across {n} chunks. Consider running /mmc.
```

### Check 8: Manifest integrity (severity: error / warning / suggestion)

- Read {vault}/{subfolder}/.manifest.json if it exists.
- If it is missing, report:

```text
SUGGESTION [missing_manifest] .manifest.json: No source-to-page manifest yet. Run /mmc to create lineage metadata.
```

- If it exists, it must be valid JSON with a top-level `sources` object.
- For each `sources[sourceKey]` entry:
  - `hash` must be a string
  - `compiled_at` must be a string
  - `pages_created` and `pages_updated` must be arrays of strings if present
  - every referenced page path must exist
- If a source key exists in both state.json and .manifest.json and the hashes differ, report:

```text
WARN [manifest_drift] .manifest.json: Source key {sourceKey} hash differs from state.json
```

- If a referenced page is missing, report:

```text
ERROR [manifest_page_missing] .manifest.json: Listed page {path} does not exist
```

### Check 9: Hot cache freshness (severity: warning / suggestion)

- Check whether {vault}/{subfolder}/hot.md exists.
- If it is missing, report:

```text
SUGGESTION [missing_hot_cache] hot.md: No hot cache yet. Run /mmc to create one.
```

- If it exists, ensure frontmatter includes:
  - `type: meta`
  - `title: "Hot Cache"`
  - `updated:`
- If a required field is missing, report:

```text
WARN [invalid_hot_cache] hot.md: Missing required frontmatter field {field}
```

- If `last_compile` exists in state.json and hot.md's `updated` timestamp is older than `last_compile`, report:

```text
WARN [stale_hot_cache] hot.md: Hot cache is older than the most recent compilation
```

## Output Format

Return results exactly in this structure:

```markdown
## Knowledge Base Lint Report

### Errors (must fix)
- ERROR [broken_link] ...
- ERROR [oversized_daily_log] ...

### Warnings (should fix)
- WARN [orphan_page] ...
- WARN [large_daily_log] ...

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
