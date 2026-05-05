---
name: mmc
description: >
  Compile today's or a specified daily capture into the Vault Architecture v2
  structure. Runs a three-stage EXTRACT -> TRANSFORM -> LOAD pipeline that
  updates concepts, atlas MOCs, synthesis pages, the root index, build log,
  manifest, state, session bootstrap context, and auto-archive folds.
argument-hint: "[YYYY-MM-DD|raw-folder-path]"
allowed-tools: "Read Write Edit Glob Grep Bash(obsidian *)"
---

## Objective

Compile one raw daily capture into the Vault Architecture v2 knowledge base.

This command is operational only. Do not write `/mmc`, `/memory-mason:mmc`, or their execution chatter back into the vault.

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

Use these paths for all operations:
- Raw captures: {vault}/{subfolder}/_raw/
- Raw day folder: {vault}/{subfolder}/_raw/{YYYY-MM-DD}/
- Raw day metadata: {vault}/{subfolder}/_raw/{YYYY-MM-DD}/meta.json
- Meta root: {vault}/{subfolder}/_meta/
- State file: {vault}/{subfolder}/_meta/state.json
- Manifest file: {vault}/{subfolder}/_meta/manifest.json
- Build log: {vault}/{subfolder}/_meta/log.md
- Fold archive: {vault}/{subfolder}/_meta/folds/
- Session context: {vault}/{subfolder}/_meta/context.md
- Taxonomy: {vault}/{subfolder}/_meta/taxonomy.md
- Atlas: {vault}/{subfolder}/atlas/
- Atlas home: {vault}/{subfolder}/atlas/home.md
- Concepts: {vault}/{subfolder}/concepts/
- Synthesis: {vault}/{subfolder}/synthesis/
- Index: {vault}/{subfolder}/index.md

## Pipeline

### 0. Resolve the target raw capture

- If no argument was provided, target today's local date folder: {vault}/{subfolder}/_raw/{YYYY-MM-DD}/.
- If the argument matches `YYYY-MM-DD`, use that date folder under `_raw/`.
- If the argument is a folder path, normalize it and require that it resolves inside {vault}/{subfolder}/_raw/.
- Derive `sourceKey` as the date folder name `YYYY-MM-DD`.
- Read chunk files matching `^[0-9]{3}\.md$` in numeric order: `001.md`, `002.md`, and so on.
- Read `meta.json` if present for operational metadata only. Do not treat `meta.json` as narrative source text.
- If the target folder does not exist, or no numeric chunk files exist, fail fast with an explicit error that names the path checked.
- Concatenate chunk contents in numeric order with a single blank line between chunks. Use this exact concatenation for parsing and hashing.
- Compute a 16-character SHA-256 hex hash for the concatenated source text.
- If {vault}/{subfolder}/_meta/manifest.json already contains `sourceKey` with the same hash, and the user did not explicitly request recompilation, stop and report `Already compiled (unchanged).`

### 1. EXTRACT

- Read {vault}/{subfolder}/index.md if it exists. If it does not exist, start with an empty catalog state.
- Read {vault}/{subfolder}/_meta/taxonomy.md if it exists. Use it to normalize tags, aliases, and tag slugs before creating or updating pages.
- Glob all files in {vault}/{subfolder}/concepts/.
- Read frontmatter and lead sections of every existing concept page to build a duplicate-detection map by slug, title, aliases, and tags.
- Fully read any existing concept whose slug, title, aliases, or tags overlap a candidate concept before deciding whether to create or update.
- Extract only durable knowledge from the raw chunks: decisions, patterns, terminology, workflows, invariants, constraints, and recurring lessons.
- Prefer updating an existing concept over creating a near-duplicate.
- Do not hallucinate novelty. If a fact is already present in an existing concept, merge or refine it only when the raw chunks add new evidence, better wording, or changed status.

For every concept page, use this exact frontmatter schema:

```markdown
---
title: "Concept Name"
type: concept
status: seedling
confidence: medium
aliases: []
tags: []
sources:
  - "_raw/2026-05-04/001.md"
created: 2026-05-04
updated: 2026-05-04
---
```

Concept status rules:
- New concept pages always start as `seedling`.
- Promote to `growing` when the concept has 3 or more unique `sources` entries.
- Promote to `evergreen` when at least one synthesis page links to the concept.
- `evergreen` overrides `growing`, and `growing` overrides `seedling`.
- Never promote status without the required evidence.

Confidence rules:
- `low`: weakly supported, inferred, or only briefly mentioned.
- `medium`: directly supported by the current raw capture or one durable prior source.
- `high`: corroborated by multiple sources or expressed as an explicit stable decision.

Concept page body format (frontmatter omitted here because the schema above is authoritative):

```markdown
# Concept Name

[2-4 sentence core explanation]

## Key Points

- [Self-contained point]
- [Self-contained point]
- [Self-contained point]

## Details

[Encyclopedia-style paragraph]

[Second encyclopedia-style paragraph]

## Related

- [[concepts/related-concept]] - [How it relates]
- [[atlas/topic-slug]] - [Parent topic map]
```

- Keep source provenance in frontmatter only. Do not add a separate `## Sources` section to concept pages.

Concept update rules:
- Preserve the original `created` date.
- Update `updated` on every material change.
- Merge and deduplicate `aliases`, `tags`, and `sources`.
- Recompute `status` and `confidence` after merging sources.
- Preserve the article's established scope. Do not rewrite it into a different concept just because the new source uses slightly different words.

### 2. TRANSFORM

- Scan the full concept set after EXTRACT, not just pages touched in this run.
- Use normalized tags from the concept corpus as the primary grouping mechanism.
- Generate or update atlas MOCs and synthesis pages only from evidence already present in concept pages and raw sources.

MOC generation rule:
- If 5 or more concept pages share the same normalized tag, create or update {vault}/{subfolder}/atlas/{tag-slug}.md.
- One tag = one MOC file.
- Do not create a tag MOC for fewer than 5 concepts.

Atlas page format:

```markdown
---
title: "Tag Name"
type: moc
tag: tag-slug
created: 2026-05-04
updated: 2026-05-04
---

# Tag Name

## Summary

[1 short paragraph describing what this tag collects]

## Concepts

- [[concepts/concept-a]] - [One-line summary]
- [[concepts/concept-b]] - [One-line summary]

## Related Synthesis

- [[synthesis/tag-slug]] - [Only if a synthesis page exists]

## Related Tags

- [[atlas/another-tag]] - [Only when genuinely related]
```

Synthesis generation rule:
- Create or update {vault}/{subfolder}/synthesis/{tag-slug}.md only when all of the following are true:
  - At least 3 concept pages share the same normalized tag.
  - Those concepts draw from 3 or more different daily dates.
  - The material supports a non-obvious cross-cutting pattern, such as a repeated tradeoff, failure mode, design heuristic, invariant, or adoption pattern.
- Do not create synthesis pages for simple topical grouping or restated tag summaries.
- If no non-obvious pattern is present, skip synthesis creation for that tag.

Synthesis page format:

```markdown
---
title: "Synthesis: Tag Name"
type: synthesis
tag: tag-slug
concepts:
  - "concepts/concept-a"
  - "concepts/concept-b"
sources:
  - "_raw/2026-05-01/001.md"
  - "_raw/2026-05-03/002.md"
  - "_raw/2026-05-04/001.md"
created: 2026-05-04
updated: 2026-05-04
---

# Synthesis: Tag Name

## Pattern

[State the non-obvious cross-cutting pattern in 1-2 paragraphs]

## Evidence

- [[concepts/concept-a]] - [Evidence]
- [[concepts/concept-b]] - [Evidence]
- [[concepts/concept-c]] - [Evidence]

## Implications

- [Reusable lesson]
- [Constraint or tradeoff]
- [Follow-up question or operational consequence]
```

Maturity promotion during TRANSFORM:
- After a synthesis page is created or updated, mark every concept it cites as `evergreen`.
- Re-save those concept pages with updated frontmatter and `updated` dates if their status changed.

Home MOC rule:
- Always create or update {vault}/{subfolder}/atlas/home.md on every successful `/mmc` run.
- `atlas/home.md` must include current vault stats and recent activity, even if no tag MOC or synthesis page changed.

Home MOC format:

```markdown
---
title: "Memory Mason Home"
type: moc
created: 2026-05-04
updated: 2026-05-04
---

# Memory Mason Home

## Vault Stats

- Concepts: [count]
- Synthesis: [count]
- MOCs: [count]
- Last compile: [ISO timestamp]

## Active Tags

- [[atlas/tag-slug]] - [Concept count for the tag]

## Recently Updated

- [[concepts/example-concept]]
- [[synthesis/example-tag]]
- [[atlas/example-tag]]
```

### 3. LOAD

- Update {vault}/{subfolder}/index.md.
- The index lives at the vault root, not under a `knowledge/` folder.
- Maintain one row per page for concepts, synthesis pages, and MOCs.
- Use lowercase type values exactly: `concept`, `synthesis`, `moc`.
- Every row must include a one-line summary.

Index format:

```markdown
# Memory Mason Index

| Type | Article | Summary | Updated |
|------|---------|---------|---------|
| concept | [[concepts/example-concept]] | One-line summary. | 2026-05-04 |
| synthesis | [[synthesis/example-tag]] | One-line summary. | 2026-05-04 |
| moc | [[atlas/example-tag]] | One-line summary. | 2026-05-04 |
```

- Read {vault}/{subfolder}/_meta/state.json if it exists. Otherwise start with:

```json
{
  "ingested": {},
  "last_compile": null,
  "last_lint": null
}
```

- Set `ingested[sourceKey]` to:

```json
{
  "hash": "<16-char-hash>",
  "compiled_at": "<ISO-8601 timestamp>",
  "chunk_count": 3
}
```

- Set `last_compile` to the current ISO-8601 timestamp.
- Write {vault}/{subfolder}/_meta/state.json with 2-space JSON indentation.

- Read {vault}/{subfolder}/_meta/manifest.json if it exists. Otherwise start with:

```json
{
  "sources": {}
}
```

- Set `sources[sourceKey]` to:

```json
{
  "source_path": "_raw/YYYY-MM-DD/",
  "hash": "<16-char-hash>",
  "compiled_at": "<ISO-8601 timestamp>",
  "chunks": [
    "_raw/YYYY-MM-DD/001.md",
    "_raw/YYYY-MM-DD/002.md"
  ],
  "pages_created": [
    "concepts/example-concept.md",
    "atlas/example-tag.md"
  ],
  "pages_updated": [
    "concepts/another-concept.md",
    "synthesis/example-tag.md",
    "index.md"
  ]
}
```

- Merge and deduplicate `pages_created` and `pages_updated` if the source key already exists.
- Preserve all other manifest entries.
- Write {vault}/{subfolder}/_meta/manifest.json with 2-space JSON indentation.

- Append one build entry to {vault}/{subfolder}/_meta/log.md using this format:

```markdown
## [ISO-timestamp] compile | YYYY-MM-DD
- Source: _raw/YYYY-MM-DD/ ([chunk count] chunks)
- Concepts created: [count]
- Concepts updated: [count]
- Synthesis created: [count]
- Synthesis updated: [count]
- MOCs created: [count]
- MOCs updated: [count]
- Index rows touched: [count]
```

- After appending the compile entry, count `_meta/log.md` entries by `## [` headings.
- If `_meta/log.md` has 32 or more entries, auto-fold the oldest 16 entries (`k=4`) into `{vault}/{subfolder}/_meta/folds/{fold-id}.md`.
- Reuse `/mma` extractive rules for the fold page: no invented facts, preserve verbatim source entries, and summarize only what those entries record.
- Replace the folded range in `_meta/log.md` with:

```markdown
<!-- folded: [[_meta/folds/{fold-id}]] ({COUNT} entries, {EARLIEST-DATE} to {LATEST-DATE}) -->
```

- Append a fold action entry to `_meta/log.md` after the replacement:

```markdown
## [ISO-timestamp] fold | {fold-id}
- Entries folded: {COUNT} ({EARLIEST-DATE} to {LATEST-DATE})
- Fold page: [[_meta/folds/{fold-id}]]
```

- Report the fold action in `/mmc` output whenever auto-archive runs.

- Overwrite {vault}/{subfolder}/_meta/context.md on every successful compile.
- Keep the body under 300 words.
- `context.md` must summarize only current focus, open decisions, and active threads that are still relevant after this compile.
- Do not append old context verbatim. Carry forward only unresolved threads that are still grounded in the latest compiled knowledge.

context.md format:

```markdown
---
type: meta
title: "Session Context"
updated: 2026-05-04T12:34:56Z
---

## Current Focus

[Short paragraph]

## Open Decisions

- [Decision still unresolved]

## Active Threads

- [Thread still active]
```

## Writing Guidelines

- Write in encyclopedia style: factual, clear, and self-contained.
- Use Obsidian wikilinks without `.md` extensions in article bodies.
- Keep filenames lowercase with hyphens for slugs.
- Use raw chunk paths like `_raw/YYYY-MM-DD/001.md` for source provenance.
- Preserve existing article intent and scope when updating.
- Prefer fewer precise pages over noisy page proliferation.
- Never invent facts that are not grounded in raw chunks or already-existing concept pages.
- Finish only when EXTRACT, TRANSFORM, and LOAD outputs are internally consistent with each other.
