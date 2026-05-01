---
name: mms
description: >
  Show knowledge base statistics: article count by type, last compile time,
  daily log status, total vault size, hot cache status, manifest status, and
  a health summary. Quick overview of the Memory Mason knowledge base state.
allowed-tools: "Read Glob Bash(obsidian *)"
---

## Objective

Show a concise snapshot of the Memory Mason knowledge base state.

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
- State file: {vault}/{subfolder}/state.json
- Manifest file: {vault}/{subfolder}/.manifest.json
- Hot cache: {vault}/{subfolder}/hot.md
- Concepts: {vault}/{subfolder}/knowledge/concepts/
- Connections: {vault}/{subfolder}/knowledge/connections/
- Q&A: {vault}/{subfolder}/knowledge/qa/
- Daily logs: {vault}/{subfolder}/daily/
- Index: {vault}/{subfolder}/knowledge/index.md

## Steps

1. Read {vault}/{subfolder}/state.json if it exists.

1.5 Read {vault}/{subfolder}/.manifest.json if it exists.

2. Count files with glob:
- {vault}/{subfolder}/knowledge/concepts/*.md -> concept count
- {vault}/{subfolder}/knowledge/connections/*.md -> connection count
- {vault}/{subfolder}/knowledge/qa/*.md -> Q&A count
- Count daily log entries: glob {vault}/{subfolder}/daily/*.md (flat files) + glob {vault}/{subfolder}/daily/*/ (folders). Each flat file = 1 log entry. Each folder = 1 log entry. Report total as combined count.

**2b. For each daily log entry in `{vault}/{subfolder}/daily/`:**
- For flat `.md` files: record filename + size in bytes.
- For folder-per-day directories: sum the sizes of all `NNN.md` chunk files inside. Record `{YYYY-MM-DD}/` + total size.
- Identify entries over 500KB (524288 bytes) - both flat and folder total sizes count.

3. From state.json, read:
- total_cost_usd (if present)
- ingested entries and each compiled_at timestamp

3.5 From .manifest.json, read:
- total tracked source count (`sources` object size)
- each source entry hash and compiled_at timestamp
- any source paths that no longer exist on disk

4. Determine the most recent compile timestamp from ingested entries.
- If state.json has no ingested entries but .manifest.json exists, use the most recent manifest `compiled_at`.

5. Count uncompiled daily logs.
- Uncompiled means a daily log exists but is not present in the ingested map.

5.5 Identify large daily logs.
- List any daily log over 500KB with its filename and size.
- If total daily/ directory size exceeds 2MB, flag it.
- For folder-per-day entries, the total size is the sum of all chunk files. If a folder's total exceeds 2MB, flag it as oversized even though no single file exceeds that threshold.

5.6 Determine manifest status.
- Report `present` when .manifest.json exists and parses successfully.
- Report `missing` when it does not exist.
- Report tracked source count.
- If manifest source paths are recorded but missing on disk, mark manifest status as `stale references`.

5.7 Determine hot cache status.
- If {vault}/{subfolder}/hot.md exists, read its frontmatter `updated` timestamp.
- Compare hot.md `updated` against the most recent compile timestamp.
- Report `fresh` when hot.md is updated at or after the most recent compile timestamp.
- Report `stale` when hot.md exists but is older than the most recent compile timestamp.
- Report `missing` when hot.md does not exist.

6. Read the first 5 data rows from {vault}/{subfolder}/knowledge/index.md as preview.
- Keep the header and first five article rows.

## Report Format

Return status exactly like this:

```markdown
## Knowledge Base Status

**Vault:** {vaultPath}/{subfolder}
**Articles:** {concept count} concepts, {connection count} connections, {qa count} Q&A
**Daily logs:** {total} total, {uncompiled} uncompiled
**Last compiled:** {ISO timestamp or "never"}
**Manifest:** {present/missing} ({tracked source count} sources)
**Hot cache:** {fresh/stale/missing} ({updated timestamp or "never"})

## Recent Index (first 5 entries)
{index preview}

## Health
{healthy / N daily logs need compilation}
- Manifest: {present / missing / stale references}
- Hot cache: {fresh / stale / missing}

## Daily Log Sizes
{table: filename | size | status}
- status: "OK" if under 500KB, "LARGE" if over 500KB, "⚠ VERY LARGE" if over 2MB

**Total daily/:** {total size in MB}
{If any log is LARGE: "Tip: Run /mmc on large logs to compile them."}
```

## Health Rule

- If uncompiled is 0, report healthy.
- If uncompiled is greater than 0, report N daily logs need compilation.
