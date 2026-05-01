---
name: mma
description: >
  Archive old build log entries from knowledge/log.md into compact summary pages
  in knowledge/folds/. Prevents log.md from growing unbounded. Extractive only —
  no invented facts, additive only — never removes source entries until confirmed.
  Use when knowledge/log.md exceeds 200 entries or feels unwieldy.
argument-hint: "[--dry-run] [--k <batch-exponent>]"
allowed-tools: "Read Write Edit Glob"
---

## Objective

Fold the oldest 2^k entries from knowledge/log.md into a single summary page, reducing log.md size while preserving all information.

## Path Resolution

Before any other reasoning, read `./memory-mason.json` from the current project root and resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Do not claim config is missing until you have attempted that read.
If missing, search for `**/memory-mason.json`. Fail fast if not found.

## Parameters

- `--dry-run`: Show what would be folded without writing anything. Default behavior.
- `--k <n>`: Batch exponent. Fold 2^n entries at once. Default: k=4 (16 entries).

Always dry-run first. Only write when user confirms or `--commit` is passed.

## Steps

1. Read {vault}/{subfolder}/knowledge/log.md.
   - Count total entries (each starts with `## [`).
   - If under 32 entries, report "Nothing to fold yet (N entries, minimum 32)." and stop.

2. Determine fold range.
   - Take the oldest 2^k entries (default 16).
   - Record the earliest and latest timestamps from those entries.
   - Generate fold ID: `fold-k{k}-from-{EARLIEST-DATE}-to-{LATEST-DATE}-n{COUNT}`
     Example: `fold-k4-from-2026-04-01-to-2026-04-16-n16`

3. Generate fold summary.
   - Extractive: summarize what those entries recorded (compiles run, articles created/updated, queries answered).
   - Include exact wikilinks to articles mentioned.
   - Do NOT invent facts not present in the source entries.

4. Fold page format (knowledge/folds/{fold-id}.md):

```markdown
---
title: "Fold: {EARLIEST-DATE} to {LATEST-DATE}"
fold_id: "{fold-id}"
entries_folded: {COUNT}
source: "knowledge/log.md"
created: {ISO-date}
---

# Build Log Fold: {EARLIEST-DATE} to {LATEST-DATE}

{COUNT} entries from {EARLIEST-DATE} to {LATEST-DATE}.

## Summary

- Compiles run: {count}
- Articles created: {count} ({list key ones with wikilinks})
- Articles updated: {count}
- Queries answered: {count}

## Source Entries

{verbatim copy of the folded entries}
```

5. Write the fold page to knowledge/folds/{fold-id}.md.

6. Remove the folded entries from log.md.
   - Replace the folded section with a single back-reference line:
     `<!-- folded: [[folds/{fold-id}]] ({COUNT} entries, {EARLIEST-DATE} to {LATEST-DATE}) -->`

7. Append to log.md:
```
## [{ISO-timestamp}] fold | {fold-id}
- Entries folded: {COUNT} ({EARLIEST-DATE} to {LATEST-DATE})
- Fold page: [[folds/{fold-id}]]
```

## Dry-run Output

Report without writing:
```
Fold plan:
- Entries to fold: {COUNT} (oldest 2^{k})
- Date range: {EARLIEST-DATE} to {LATEST-DATE}
- Fold ID: {fold-id}
- Fold page: knowledge/folds/{fold-id}.md
- Remaining in log.md: {total - COUNT} entries

Run /mma --commit to execute.
```
