---
name: mms
description: >
  Show knowledge base statistics: article count by type, last compile time,
  daily log status, total vault size, and a health summary. Quick overview
  of the Memory Mason knowledge base state.
allowed-tools: "Read Glob"
---

## Objective

Show a concise snapshot of the Memory Mason knowledge base state.

## Path Resolution

Read memory-mason.json first and resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Use these paths:
- State file: {vault}/{subfolder}/state.json
- Concepts: {vault}/{subfolder}/knowledge/concepts/
- Connections: {vault}/{subfolder}/knowledge/connections/
- Q&A: {vault}/{subfolder}/knowledge/qa/
- Daily logs: {vault}/{subfolder}/daily/
- Index: {vault}/{subfolder}/knowledge/index.md

## Steps

1. Read {vault}/{subfolder}/state.json if it exists.

2. Count files with glob:
- {vault}/{subfolder}/knowledge/concepts/*.md -> concept count
- {vault}/{subfolder}/knowledge/connections/*.md -> connection count
- {vault}/{subfolder}/knowledge/qa/*.md -> Q&A count
- {vault}/{subfolder}/daily/*.md -> daily log count

3. From state.json, read:
- total_cost_usd (if present)
- ingested entries and each compiled_at timestamp

4. Determine the most recent compile timestamp from ingested entries.

5. Count uncompiled daily logs.
- Uncompiled means a daily log exists but is not present in the ingested map.

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

## Recent Index (first 5 entries)
{index preview}

## Health
{healthy / N daily logs need compilation}
```

## Health Rule

- If uncompiled is 0, report healthy.
- If uncompiled is greater than 0, report N daily logs need compilation.
