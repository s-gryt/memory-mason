## Check Specifications — mml

Detailed rules, report formats, and edge cases for all fourteen knowledge base health checks. Run every check in full; do not skip any.

### Check 1: Broken wikilinks (severity: error)

- For each knowledge article and the root `index.md`, find all [[wikilinks]].
- Skip links starting with `{subfolder}/_raw/`. Skip bare `_raw/` links (Check 13 handles missing prefix).
- Skip bare slug links that contain no `/`. Check 13 handles them.
- For links starting with `{subfolder}/`, strip the prefix and check whether the target exists at {vault}/{subfolder}/{remainder}.md.
- For links not starting with `{subfolder}/`, Check 13 or 14 handles them.
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

### Check 10: Unresolved contradictions (severity: warning)

- For each article in `concepts/`, search for `[!contradiction]` callout blocks.
- Each unresolved contradiction prevents the concept from reaching `evergreen` status.
- Report format:

```text
WARN [unresolved_contradiction] concepts/file.md: Contains N unresolved [!contradiction] callout(s)
```

### Check 11: Wikilink density (severity: suggestion)

- For each article in `concepts/`, count outbound `[[...]]` wikilinks in the body (excluding frontmatter and `_raw/` source references).
- Report any concept page with zero outbound wikilinks.
- Report any atlas MOC page with fewer than 3 concept links.
- Report format:

```text
SUGGESTION [isolated_concept] concepts/file.md: No outbound wikilinks — consider adding related concept links
SUGGESTION [thin_moc] atlas/file.md: Only N concept links (minimum recommended: 3)
```

### Check 12: Knowledge gaps (severity: suggestion)

- For each article in `concepts/`, search for `[!gap]` callout blocks.
- Report the total count of concepts with knowledge gaps.
- Report format:

```text
SUGGESTION [knowledge_gap] concepts/file.md: Contains [!gap] callout — awaiting enrichment from future sessions
```

### Check 13: Wikilink format convention (severity: error)

All wikilinks must include the `{subfolder}/` prefix followed by the directory path. This ensures Obsidian resolves links within the correct project when multiple subfolders share a vault.

- For each wikilink in knowledge articles and the root `index.md`:
  - **Bare slug** `[[slug]]` — always an error. Search for matching files and suggest the full `{subfolder}/directory/slug` form.
  - **Missing subfolder prefix** `[[concepts/slug]]`, `[[atlas/slug]]`, `[[synthesis/slug]]`, `[[_raw/...]]` — error. The link must be `[[{subfolder}/concepts/slug]]`, etc.
- Report formats:

```text
ERROR [short_form_link] file.md: [[foo]] should be [[{subfolder}/concepts/foo]] — use full {subfolder}-prefixed paths
ERROR [ambiguous_short_form_link] file.md: [[foo]] matches [[{subfolder}/concepts/foo]], [[{subfolder}/atlas/foo]] — use an explicit {subfolder}-prefixed target
ERROR [missing_subfolder_prefix] file.md: [[concepts/foo]] should be [[{subfolder}/concepts/foo]] — add {subfolder}/ prefix
ERROR [missing_subfolder_prefix] file.md: [[_raw/2026-05-04/001]] should be [[{subfolder}/_raw/2026-05-04/001]] — add {subfolder}/ prefix
```

### Check 14: Cross-project reference (severity: error)

- Scan article bodies and the root `index.md` for wikilinks that start with a subfolder prefix OTHER than `{subfolder}/`.
- Report any wikilink that references a sibling subfolder. Each project must link only within its own boundary.
- Report format:

```text
ERROR [cross_project_link] file.md: [[other-project/concepts/foo]] references a different subfolder — remove or replace with a local concept
```
