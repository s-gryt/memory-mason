---
name: mms
description: >
  Show knowledge base statistics: article count by type, last compile time,
  raw capture status, total vault size, session context status, manifest
  status, and a health summary. Quick overview of the Memory Mason knowledge
  base state.
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

Resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Use the source that provides the vault path.

Subfolder rules:
- If the vault path comes from an `.env` file, use `MEMORY_MASON_SUBFOLDER` from that same file when present, otherwise default to `ai-knowledge`.
- If the vault path comes from `memory-mason.json` or `~/.memory-mason/config.json`, use its `subfolder`.

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

## Steps

1. Read {vault}/{subfolder}/_meta/state.json if it exists.

1.5 Read {vault}/{subfolder}/_meta/manifest.json if it exists.

2. Count files with glob:
- {vault}/{subfolder}/concepts/*.md -> concept count
- {vault}/{subfolder}/synthesis/*.md -> synthesis count
- {vault}/{subfolder}/atlas/*.md -> MOC count, including `home.md`
- Count raw capture entries: glob immediate subdirectories in {vault}/{subfolder}/_raw/. Each date folder = 1 raw capture entry.

2.5 For each raw capture entry in `{vault}/{subfolder}/_raw/`:
- Sum the sizes of numeric chunk files such as `001.md`, `002.md`, and so on.
- Ignore `meta.json` for size calculations.
- Record `{YYYY-MM-DD}/` plus total size.
- Identify entries over 500KB (524288 bytes).

3. From `state.json`, read:
- `total_cost_usd` if present
- `ingested` entries and each `compiled_at` timestamp

3.5 From `_meta/manifest.json`, read:
- total tracked source count (`sources` object size)
- each source entry hash and `compiled_at` timestamp
- any source paths that no longer exist on disk

4. Determine the most recent compile timestamp from `ingested` entries.
- If `state.json` has no ingested entries but `_meta/manifest.json` exists, use the most recent manifest `compiled_at`.

5. Count uncompiled raw captures.
- Uncompiled means a raw capture folder exists in `_raw/` but is not present in the `ingested` map.

5.5 Identify large raw captures.
- List any raw capture over 500KB with its folder name and size.
- If total `_raw/` directory size exceeds 2MB, flag it.
- If a raw capture folder's total exceeds 2MB, flag it as oversized.

5.6 Determine manifest status.
- Report `present` when `_meta/manifest.json` exists and parses successfully.
- Report `missing` when it does not exist.
- Report tracked source count.
- If manifest source paths are recorded but missing on disk, mark manifest status as `stale references`.

5.7 Determine session context status.
- If {vault}/{subfolder}/_meta/context.md exists, read its frontmatter `updated` timestamp.
- Compare `context.md` `updated` against the most recent compile timestamp.
- Report `fresh` when `context.md` is updated at or after the most recent compile timestamp.
- Report `stale` when `context.md` exists but is older than the most recent compile timestamp.
- Report `missing` when `context.md` does not exist.

6. Read the first 5 data rows from {vault}/{subfolder}/index.md as preview.
- Keep the header and first five article rows.

7. Compute knowledge graph metrics:
- For each concept page, count outbound `[[...]]` wikilinks in the body (exclude frontmatter, exclude `_raw/` source references).
- Compute average outbound wikilinks per concept page.
- Count concept pages with zero outbound wikilinks (isolated concepts).
- Count concept pages containing `[!contradiction]` callouts (unresolved contradictions).
- Count concept pages containing `[!gap]` callouts (knowledge gaps).

## Report Format

Return status exactly like this:

```markdown
## Knowledge Base Status

**Vault:** {vaultPath}/{subfolder}
**Articles:** {concept count} concepts, {synthesis count} synthesis, {moc count} MOCs
**Raw captures:** {total} total, {uncompiled} uncompiled
**Last compiled:** {ISO timestamp or "never"}
**Manifest:** {present/missing} ({tracked source count} sources)
**Context:** {fresh/stale/missing} ({updated timestamp or "never"})

## Knowledge Graph
- Avg wikilinks per concept: {N.N}
- Isolated concepts (0 links): {count}
- Unresolved contradictions: {count}
- Knowledge gaps: {count}

## Recent Index (first 5 entries)
{index preview}

## Health
{healthy / N raw captures need compilation}
- Manifest: {present / missing / stale references}
- Context: {fresh / stale / missing}

## Raw Capture Sizes
{table: folder | size | status}
- status: "OK" if under 500KB, "LARGE" if over 500KB, "⚠ VERY LARGE" if over 2MB

**Total _raw/:** {total size in MB}
{If any capture is LARGE: "Tip: Run /mmc on recent captures to keep the vault current."}
```

## Health Rule

- If `uncompiled` is 0, report healthy.
- If `uncompiled` is greater than 0, report `N raw captures need compilation`.
