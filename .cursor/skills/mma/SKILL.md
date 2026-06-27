---
name: mma
description: >
  Archive log entries when they exceed 32 entries, using batches of 2^k for
  compact storage. Extractive only — no invented facts. Run whenever
  _meta/log.md grows unwieldy.
argument-hint: "[--dry-run | --commit] [--k <n>]"
allowed-tools: "Read Write Edit Glob"
---

## Objective

Fold the oldest 2^k entries from _meta/log.md into a single summary page, reducing log.md size while preserving all information.

This command is operational only. Do not write `/mma`, `/memory-mason:mma`, or their execution chatter back into the vault.

Use `/mma` for:
- Manual runs outside the compile flow
- Custom batch sizes (`--k 5` folds 32 entries at once)
- Dry-run inspection before committing a fold (`--dry-run`)

## Path Resolution

Resolve vault config in priority order: `./.env` → `./memory-mason.json` → `~/.memory-mason/.env` → `~/.memory-mason/config.json`.

- `{vault}`: absolute path to the Obsidian vault.
- `{subfolder}`: `MEMORY_MASON_SUBFOLDER` (`.env` source) or `subfolder` field (JSON source); default `ai-knowledge`.
- Attempt all four locations before reporting missing config. Fail fast with an explicit error naming every location checked.

## Parameters

Run with `--dry-run` (default) to preview, `--commit` to write, `--k N` to batch 2^N entries (default k=4, 16 entries).

## Steps

1. Read {vault}/{subfolder}/_meta/log.md.
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

4. Fold page format (_meta/folds/{fold-id}.md):

```markdown
---
fold_id: "{fold-id}"
entries_folded: {COUNT}
source: "_meta/log.md"
created: {ISO-date}
---
# Build Log Fold: {EARLIEST-DATE} to {LATEST-DATE}

{COUNT} entries. Compiles: {n} | Created: {n} ([[wikilinks]]) | Updated: {n} | Queries: {n}

## Source Entries
{verbatim copy of folded entries}
```

5. Write the fold page to _meta/folds/{fold-id}.md.

6. Remove the folded entries from log.md.
   - Replace the folded section with a single back-reference line:
   `<!-- folded: [[{subfolder}/_meta/folds/{fold-id}]] ({COUNT} entries, {EARLIEST-DATE} to {LATEST-DATE}) -->`

7. Append to log.md:
```
## [{ISO-timestamp}] fold | {fold-id}
- Entries folded: {COUNT} ({EARLIEST-DATE} to {LATEST-DATE})
- Fold page: [[{subfolder}/_meta/folds/{fold-id}]]
```

## Dry-run Output

Report without writing:
```
Fold plan:
- Entries to fold: {COUNT} (oldest 2^{k})
- Date range: {EARLIEST-DATE} to {LATEST-DATE}
- Fold ID: {fold-id}
- Fold page: _meta/folds/{fold-id}.md
- Remaining in log.md: {total - COUNT} entries

Run /mma --commit to execute.
```
