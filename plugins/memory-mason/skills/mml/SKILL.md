---
name: mml
description: >
  Run health checks on the knowledge base. Finds broken wikilinks, orphan
  pages, uncompiled daily logs, stale articles, missing backlinks, and sparse
  content. Reports issues by severity: error, warning, suggestion.
allowed-tools: "Read Glob Grep"
---

## Objective

Run six health checks on the knowledge base and report all findings by severity.

## Path Resolution

Read memory-mason.json first and resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Use these paths:
- Knowledge root: {vault}/{subfolder}/knowledge/
- Daily logs: {vault}/{subfolder}/daily/
- State file: {vault}/{subfolder}/state.json

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
- Glob all .md files in {vault}/{subfolder}/daily/.
- Report any daily log that is not present in ingested.
- Report format:

```text
WARN [orphan_source] daily/YYYY-MM-DD.md: Not yet compiled
```

### Check 4: Stale articles (severity: warning)

- From state.json ingested entries, compare current daily log file hash with stored hash.
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

## Output Format

Return results exactly in this structure:

```markdown
## Knowledge Base Lint Report

### Errors (must fix)
- ERROR [broken_link] ...

### Warnings (should fix)
- WARN [orphan_page] ...

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
