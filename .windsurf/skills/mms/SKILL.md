---
name: mms
description: >
  Show vault health: files, token metrics, compilation status, knowledge graph quality, and raw capture inventory. Invoke whenever user checks Memory Mason status or audits the knowledge base.
allowed-tools: "Read Glob Bash(obsidian *)"
---

## Objective

Show a concise snapshot of the Memory Mason knowledge base state.

This command is operational only. Do not write `/mms`, `/memory-mason:mms`, or their execution chatter back into the vault.

## Path Resolution

Before any other reasoning, resolve vault config in this priority order:
1. Project `./.env`
2. Project `./memory-mason.json`
3. Global `~/.memory-mason/.env`
4. Global `~/.memory-mason/config.json`

Resolve `{vault}` (absolute vault path) and `{subfolder}` from the matching config source. Use `{subfolder}` from matching config field (default `ai-knowledge` for `.env`). Priority: `./.env` → `./memory-mason.json` → `~/.memory-mason/.env` → `~/.memory-mason/config.json`.

Do not claim config is missing until you have attempted all four locations above. If none provide a vault path, fail fast with an explicit error that names every location checked.

Use these paths:
- State file: {vault}/{subfolder}/_meta/state.json
- Manifest file: {vault}/{subfolder}/_meta/manifest.json
- Session context: {vault}/{subfolder}/_meta/context.md
- Build log: {vault}/{subfolder}/_meta/log.md
- Atlas: {vault}/{subfolder}/atlas/
- Concepts: {vault}/{subfolder}/concepts/
- Synthesis: {vault}/{subfolder}/synthesis/
- Raw captures: {vault}/{subfolder}/_raw/
- Index: {vault}/{subfolder}/index.md

### Thresholds

- **Large capture:** raw capture folder total exceeds 500KB (512000 bytes).
- **Very large capture:** raw capture folder total exceeds 2MB.
- **Raw directory:** total `_raw/` size exceeds 2MB — flag the entire directory.

## Steps

1. Read {vault}/{subfolder}/_meta/state.json if it exists.

1.5 Read {vault}/{subfolder}/_meta/manifest.json if it exists.

2. Count files with glob:
- {vault}/{subfolder}/concepts/*.md -> concept count
- {vault}/{subfolder}/synthesis/*.md -> synthesis count
- {vault}/{subfolder}/atlas/*.md -> MOC count, including `home.md`
- {vault}/{subfolder}/sessions/*.md -> session note count
- {vault}/{subfolder}/atlas/bases/*.base -> bases file list (record each filename present)
- Count raw capture entries: glob immediate subdirectories in {vault}/{subfolder}/_raw/. Each date folder = 1 raw capture entry.
- For each raw capture entry, sum sizes of all chunk files (both legacy numeric `001.md` files and session-scoped `HHMMSS-{sid8}-NNN.md` files); ignore `meta.json`. Record `{YYYY-MM-DD}/` plus total size. Flag entries exceeding the large-capture threshold.

3. Token Economics Decision — From `state.json`, read `total_cost_usd`, `ingested` entries with `compiled_at` timestamps, and `capture_metrics` (fields: `capture_count`, `total_raw_tokens`, `total_stored_tokens`, `total_savings_tokens`, `total_savings_percent`, `last_capture_at`, `last_capture.source`, `last_capture.raw_tokens`, `last_capture.stored_tokens`, `last_capture.savings_tokens`, `last_capture.savings_percent`). If `capture_metrics` is missing, invalid, or `capture_count` is 0, report token economics as `not tracked yet` with zero totals and `never` for last capture; otherwise report cumulative totals.

3.5 From `_meta/manifest.json`, read:
- total tracked source count (`sources` object size)
- each source entry hash and `compiled_at` timestamp
- any source paths that no longer exist on disk

4. Determine the most recent compile timestamp from `ingested` entries.
- If `state.json` has no ingested entries but `_meta/manifest.json` exists, use the most recent manifest `compiled_at`.

5. Count uncompiled raw captures; then collect supplemental status.
- Uncompiled means a raw capture folder exists in `_raw/` but is not present in the `ingested` map.
- List any raw capture exceeding the large-capture threshold (folder name + size). Flag captures exceeding the very-large threshold as oversized. If total `_raw/` size exceeds the raw-directory threshold, flag the directory.
- Manifest status: `present` when `_meta/manifest.json` exists and parses successfully; `missing` otherwise. Report tracked source count. Mark `stale references` when recorded source paths are missing on disk.
- Context status: if `_meta/context.md` exists, read its frontmatter `updated` timestamp and compare against the most recent compile timestamp — `fresh` if at or after, `stale` if older; `missing` if the file does not exist.

6. Read the first 5 data rows from {vault}/{subfolder}/index.md as preview.
- Keep the header and first five article rows.

7. Compute knowledge graph metrics:
- Per-concept: count outbound `[[...]]` wikilinks in body (exclude frontmatter and `{subfolder}/_raw/` source refs); compute average; count isolated concepts (0 links); count `[!contradiction]` and `[!gap]` callouts.
- Bare-slug (`[[foo]]`): count across all knowledge articles and `index.md` — these lack a folder path and will break navigation.
- Missing-prefix (`[[concepts/foo]]` etc. without `{subfolder}/`): count links missing the subfolder prefix — they resolve only within the same vault subfolder.
- Cross-project (`[[other-subfolder/...]]`): count links starting with a subfolder prefix other than `{subfolder}/` — they reference a different project's vault.

7.5 Count concept page `status` field values from frontmatter across all concept pages in {vault}/{subfolder}/concepts/. Tally: seedling count, growing count, evergreen count, superseded count (concepts with a `superseded_by` frontmatter field, regardless of their `status` value). Treat missing or invalid status as seedling. A superseded concept is counted in both its status bucket (seedling/growing) and the superseded tally.

## Report Format

Return status exactly like this:

```markdown
## Knowledge Base Status

**Vault:** {vaultPath}/{subfolder}
**Articles:** {concept count} concepts, {synthesis count} synthesis, {moc count} MOCs, {session count} sessions
**Raw captures:** {total} total, {uncompiled} uncompiled
**Last compiled:** {ISO timestamp or "never"}
**Manifest:** {present/missing} ({tracked source count} sources)
**Context:** {fresh/stale/missing} ({updated timestamp or "never"})

## Token Economics
- Captures tracked: {capture count or 0}
- Raw tokens: {total raw tokens or 0}
- Stored tokens: {total stored tokens or 0}
- Savings: {total savings percent or 0}% ({total savings tokens or 0} tokens)
- Last capture: {last capture source or "never"} ({last capture timestamp or "never"})
- Last capture savings: {last capture savings percent or 0}% ({last capture raw tokens or 0} -> {last capture stored tokens or 0} tokens)
- Note: token savings are tracked on every capture from raw-vs-stored deltas (sanitize-only changes count even with `minimize` off, default: off). Enabling `minimize` adds prose compression on top, increasing savings further.

## Knowledge Graph
- Avg wikilinks per concept: {N.N}
- Isolated concepts (0 links): {count}
- Unresolved contradictions: {count}
- Knowledge gaps: {count}
- Short-form wikilinks: {count}
- Missing subfolder prefix: {count}
- Cross-project refs: {count}

## Maturity
- Seedling: {seedling count}
- Growing: {growing count}
- Evergreen: {evergreen count}
- Superseded: {superseded count}

## Bases
{List each atlas/bases/*.base filename present, one per line, or "none (run /mmc to generate)" if directory is empty or absent}

## Recent Index (first 5 entries)
{index preview}

## Health
{healthy / N raw captures need compilation}

## Raw Capture Sizes
{table: folder | size | status}
- status: "OK" if under 500KB, "LARGE" if over 500KB (512000 bytes), "⚠ VERY LARGE" if over 2MB

**Total _raw/:** {total size in MB}
{If any capture is LARGE: "Tip: Run /mmc on recent captures to keep the vault current."}
```
