---
name: mmc
description: >
  Compile today's or a specified daily capture into the Vault Architecture v2
  structure. Runs a three-stage EXTRACT -> TRANSFORM -> LOAD pipeline that
  updates concepts, atlas MOCs, synthesis pages, the root index, build log,
  manifest, state, session bootstrap context, and auto-archive folds.
  Triggers: "compile today", "/mmc", "compile YYYY-MM-DD", "--all" for batch.
  Use /mmq instead to query the vault without modifying it.
argument-hint: "[YYYY-MM-DD|raw-folder-path|--all]"
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

Resolve `vaultPath` from the first source in priority order that provides it.

Resolve `subfolder` independently using the nearest source in the same priority order:
- Project `./.env` `MEMORY_MASON_SUBFOLDER`
- Project `./memory-mason.json` `subfolder`
- Global `~/.memory-mason/.env` `MEMORY_MASON_SUBFOLDER`
- Global `~/.memory-mason/config.json` `subfolder`
- Default to `ai-knowledge` only if none of those define a subfolder

Do not claim config is missing until you have attempted all four locations above. If none provide a vault path, fail fast with an explicit error that names every location checked.

Resolve `minimize` from the same priority order:

- Process environment variable `MEMORY_MASON_MINIMIZE` (highest precedence)
- Project `./.env` `MEMORY_MASON_MINIMIZE`
- Project `./memory-mason.json` key `minimize`
- Global `~/.memory-mason/.env` `MEMORY_MASON_MINIMIZE`
- Global `~/.memory-mason/config.json` key `minimize`
- Default: `false`

When `minimize` is `true`, apply deterministic lossless compression (whitespace and punctuation normalization) to assistant narrative text before vault writes. Content is compacted but never dropped; code blocks, inline code, URLs, and quoted strings are preserved verbatim. When `false` (the default), write captured text verbatim.

## Project Isolation

All reads, writes, and wikilinks are strictly scoped to `{vault}/{subfolder}/`. Never access, create, or link files in sibling subfolders; only add `[[{subfolder}/concepts/slug]]` links to concepts confirmed to exist in this subfolder during this compile.

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
- Atlas bases: {vault}/{subfolder}/atlas/bases/
- Concepts: {vault}/{subfolder}/concepts/
- Synthesis: {vault}/{subfolder}/synthesis/
- Sessions: {vault}/{subfolder}/sessions/
- Index: {vault}/{subfolder}/index.md

## Pipeline

### 0. Resolve the target raw capture

- If the argument is `--all`, enter batch mode: read `_meta/state.json` ingested map, glob all date folders under `_raw/`, identify every folder not present in the ingested map (or whose hash changed), and process each in ascending chronological order. Run the full EXTRACT → TRANSFORM → LOAD pipeline for each date. After each date completes, persist state and manifest before proceeding to the next date. Report per-day results. After all days complete, run a final TRANSFORM pass across the full concept set to ensure atlas/synthesis pages reflect the complete corpus.
- If no argument was provided, target today's local date folder: {vault}/{subfolder}/_raw/{YYYY-MM-DD}/.
- If the argument matches `YYYY-MM-DD`, use that date folder under `_raw/`.
- If the argument is a folder path, normalize it and require that it resolves inside {vault}/{subfolder}/_raw/.
- Derive `sourceKey` as the date folder name `YYYY-MM-DD`.
- Read `meta.json` if present for operational metadata only. Do not treat `meta.json` as narrative source text. Inspect the `schemaVersion` field: version 2 signals session-scoped layout; any other value or absence signals legacy daily layout.

**Raw layout detection and chunk reading — support both layouts, including mixed transition days:**

*Session-scoped layout (meta.json schemaVersion 2):* chunk files are primarily named `{HHMMSS}-{sid8}-{NNN}.md` (session start time, first 8 chars of session id, 3-digit chunk index). Also glob legacy numeric chunks matching `^[0-9]{3}\.md$`; on transition days they are part of the same compile and hash input as a separate legacy group. Build ordered groups as follows:
- If any legacy numeric chunks exist, create one `legacy` group first and sort those files by numeric chunk index ascending.
- Group session-scoped files by their `{HHMMSS}-{sid8}` prefix; within each group, sort by `{NNN}` ascending.
- After the optional `legacy` group, process session groups in ascending `{HHMMSS}` order. Use `{sid8}` as a deterministic tie-breaker if two groups share the same `{HHMMSS}`.

For parsing, hashing, and manifest chunk ordering, concatenate chunks in full group order: legacy group first when present, then session groups by `{HHMMSS}`/`{sid8}`, with chunk order ascending inside each group. Insert a single blank line between chunks. Legacy numeric chunks remain their own group even when `schemaVersion` is 2; do not merge them into any session group.

*Legacy daily layout (schemaVersion absent or not 2):* read chunk files matching `^[0-9]{3}\.md$` in numeric order: `001.md`, `002.md`, and so on. Concatenate in numeric order with a single blank line between chunks.

In both layouts, `sourceKey` is the date folder name `YYYY-MM-DD`.

- If the target folder does not exist, or no chunk files exist under either layout, fail fast with an explicit error that names the path checked.
- The `_raw/{YYYY-MM-DD}/_meta/` subfolder is a sibling artifact class. Do NOT concatenate its files into chunk text and do NOT include them in the `sourceKey` hash. They are processed separately in section 1.5.
- Compute a 16-character SHA-256 hex hash for the concatenated source text.
- If {vault}/{subfolder}/_meta/manifest.json already contains `sourceKey` with the same hash, and the user did not explicitly request recompilation, stop and report `Already compiled (unchanged).`

**Continuation chunk boundary (`> [!continued]`):** when an exchange (user prompt → assistant reply pair) is split across two chunk files due to a hard size cap, the continuation chunk begins with:

```markdown
> [!continued]
```

EXTRACT and all compile parsing must treat `> [!continued]` as a split boundary marker — skip it and treat the remainder of that chunk as the direct continuation of the preceding chunk's content. Do not surface it as vault content, a callout, or a key point.

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
has_contradiction: false
sources:
  - "_raw/2026-05-04/143022-a1b2c3d4-001.md"
created: 2026-05-04
updated: 2026-05-04
---
```

Frontmatter discipline rules (vault-wide):
- Every property keeps ONE type vault-wide (string, boolean, list, ISO date). Do not mix types across pages for the same key.
- Wikilink values inside frontmatter properties must be quoted strings, not bare brackets.
- Dates are ISO YYYY-MM-DD strings. Do not use nested YAML objects.

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

- [decision] Chose X over Y because of Z #tag
- [fact] This system always does A before B
- [gotcha] Omitting the config key silently disables the feature #tag
- [method] Run X then Y to achieve Z
- [Self-contained point with no category prefix when none fits]

## Details

[Encyclopedia-style paragraph]

[Second encyclopedia-style paragraph]

## Related

- [[{subfolder}/concepts/related-concept]] - [How it relates]
- [[{subfolder}/atlas/topic-slug]] - [Parent topic map]
```

**Typed observations grammar for `## Key Points`:** each bullet SHOULD begin with a category tag in `[brackets]` where a category fits. Valid categories: `decision` (a choice made), `fact` (an observable truth or invariant), `gotcha` (a non-obvious trap or surprise), `method` (a procedure or technique). Plain bullets without a category are allowed as fallback when none of the four categories fits naturally. Inline `#tag` tokens within a bullet are encouraged for discoverability but optional. The category tag is for human and LLM comprehension only; it does not affect status or confidence rules.

- If creating or updating a concept leaves at least one `[decision]` bullet in `## Key Points`, ensure frontmatter `tags` contains `decision` so `atlas/bases/decisions.base` can discover it.

- Keep source provenance in frontmatter only. Do not add a separate `## Sources` section to concept pages.

Concept update rules:
- Preserve the original `created` date.
- Update `updated` on every material change.
- Merge and deduplicate `aliases`, `tags`, and `sources`.
- Recompute `status` and `confidence` after merging sources.
- Preserve the article's established scope. Do not rewrite it into a different concept just because the new source uses slightly different words.

Contradiction detection and supersede lifecycle:
- Before merging new claims into an existing concept, compare the new raw evidence against the existing `## Key Points`.
- If the new evidence directly contradicts an existing key point (a decision reversed, a tool replaced, an approach abandoned), do not silently overwrite the original point.
- Add a callout below the contradicted key point and set `has_contradiction: true` in the concept's frontmatter:

> \[!contradiction\] Session \_raw/2026-05-05/143022-a1b2c3d4-001.md states Y, but existing evidence from \_raw/2026-05-01/090011-deadbeef-002.md says X.

- Keep both the original key point and the new one so the user can resolve the conflict.
- Concepts with unresolved `[!contradiction]` callouts must not be promoted to `evergreen`.

**Supersede resolution (when later evidence resolves a contradiction):** when 3 or more sources agree on a newer fact that contradicts an older key point, the contradiction is considered resolved by supersession. Perform the split:
1. On the **superseded concept** (or the concept page holding the now-invalid key point): remove the `[!contradiction]` callout, set `has_contradiction: false`, add frontmatter fields `superseded_by: "[[{subfolder}/concepts/new-slug]]"` and `invalid_at: YYYY-MM-DD` (the date of this compile). Do not delete the superseded concept — it remains in the vault as an archived record. Do not promote a superseded concept to `evergreen`.
2. On the **superseding concept** (the note whose evidence resolves the contradiction): add a line in `## Related`: `- supersedes [[{subfolder}/concepts/old-slug]]`.
3. If the contradicting evidence lives within the same concept page (one concept whose key points conflict), create a new concept page for the now-current fact, apply the supersede fields to the old concept page, and link bidirectionally as above.

Gap flagging for thin concepts:
- When creating a new concept page where `confidence: low` and the `## Key Points` section has fewer than 3 items, append a callout at the end of the `## Details` section:

> \[!gap\] Sparse capture — this concept was only briefly mentioned. Awaiting future sessions for enrichment.

- Do not add gap callouts to concepts with `confidence: medium` or `high`.
- Remove existing gap callouts when a concept is updated with sufficient evidence (3+ key points or confidence promoted to medium or higher).

### 1.5 EXTRACT — coaching advisories

Coaching advisories are deterministic, hook-emitted files describing workflow signals such as repeated prompts. They are NOT durable knowledge and must NOT become concept pages.

- Source location: `{vault}/{subfolder}/_raw/{YYYY-MM-DD}/_meta/*.md`
- Each file uses YAML frontmatter with required keys: `kind`, `hash`, `count`, `sessionId`, `iso`, plus an optional `snippet` key (a short redacted excerpt of the repeated prompt or error text — absent on older advisories written before this field existed).
- Supported `kind` values: `prompt-repeat`, `error-repeat`. Unknown `kind` values must be ignored, not compiled.

Advisories must not enter concepts, taxonomy, or synthesis pages and must not be included in `sourceKey` hashing. Route each advisory exclusively to `{vault}/{subfolder}/atlas/workflow-coaching.md`.

Atlas workflow-coaching page format:

```markdown
---
title: "Workflow Coaching"
type: moc
tag: workflow-coaching
created: 2026-06-26
updated: 2026-06-26
---

# Workflow Coaching

## Summary

Repeated workflow signals captured deterministically by Memory Mason hooks. Each entry below corresponds to a unique prompt hash whose recurrence has crossed the nag threshold.

## Active Advisories

- **<hash16>** — kind: `prompt-repeat` — count: N — first: ISO — last: ISO — sessions: [s1, s2] — snippet: "<redacted excerpt>"
- ...

## Resolved Advisories

- **<hash16>** — kind: `prompt-repeat` — count: N — resolved: ISO — note: [optional]
```

Advisory upsert rules:
- For each advisory file under `_raw/{date}/_meta/`, parse its frontmatter.
- If the hash already appears in `## Active Advisories`, update `count`, `last` (= advisory `iso`), append `sessionId` to its sessions list deduplicated, and replace `snippet` with the newest advisory's value when present.
- If the hash is new, append a new row to `## Active Advisories`. Omit the ` — snippet: "..."` segment entirely when the source frontmatter has no `snippet` key.
- Never delete advisory rows automatically. Movement from `## Active Advisories` to `## Resolved Advisories` is a manual user action; only honor it when an advisory already appears under `## Resolved Advisories` in the existing page content.
- Sort `## Active Advisories` by `count` descending, then by `last` descending.

After upserting, update `updated` in the page frontmatter to today's date.

### 1.6 EXTRACT — episodic session notes

For each date being compiled, emit one session note per session found in the raw chunk files. Session identity depends on layout:

- **Session-scoped layout (schemaVersion 2):** each `{HHMMSS}-{sid8}` group is one session. The `sid8` value is normally the first 8 characters of the sanitized (lowercased, non-alphanumeric-stripped) session id; when sanitizing yields an empty string, `sid8` falls back to the literal `nosession` (9 characters — treat it as an opaque fallback token, not a length-8 slice). The session start time is `{HHMMSS}` (parse as HH:MM:SS local time on the date being compiled). Read `meta.json` entries to find `sessionId` for each chunk when available.
- **Legacy daily layout:** there is no per-session grouping. Treat the entire date as one session with `sid8 = "daily"`. Read session id from `meta.json` if present; otherwise use `"daily"`.

Emit the session note at: `{vault}/{subfolder}/sessions/YYYY-MM-DD-{sid8}.md`

If the file already exists, update it: merge any new files, tags, and decisions; update `updated` and `outcome`; do not overwrite a user-edited narrative.

Session note frontmatter schema:

```markdown
---
title: "Session YYYY-MM-DD {sid8}"
type: session
date: YYYY-MM-DD
session_id: "{full session id or 'daily'}"
project: "{project name derived from context or path, or 'unknown'}"
files:
  - "path/to/file.ts"
tags: []
outcome: "One-line summary of what was accomplished."
sources:
  - "_raw/YYYY-MM-DD/HHMMSS-{sid8}-001.md"
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Session note body format:

```markdown
# Session YYYY-MM-DD {sid8}

## What happened

[2-4 sentence narrative of what occurred in this session: what was being built, investigated, or decided.]

## Decisions

- [Decision made or conclusion reached]
- [Another decision]

## Links

- [[{subfolder}/concepts/related-concept]] - [Why relevant]
- [[{subfolder}/_raw/YYYY-MM-DD/HHMMSS-{sid8}-001]] - Raw part 1
```

Session note rules:
- `files` lists source files touched or discussed in the session, inferred from raw chunks. Omit if none are identifiable.
- `tags` mirrors the union of tags from concept pages extracted from this session's chunks.
- `outcome` is one line; derive it from the most prominent decision or result in the session.
- `sources` uses plain string paths (no wikilink brackets), same convention as concept `sources:` arrays. For session-scoped layout, prefer entries like `"_raw/YYYY-MM-DD/143022-a1b2c3d4-001.md"`. For legacy daily layout, list the numeric chunk files: `"_raw/YYYY-MM-DD/001.md"`, etc.
- `## Links` uses wikilinks with `{subfolder}/` prefix. Include links to every concept page extracted from this session's chunks, and wikilinks to raw chunk files for direct navigation.
- Do not create a session note if the session's chunks contain no extractable content (all chunks are empty or whitespace-only).
- Session notes must not enter the taxonomy or be treated as concept source evidence.

### 2. TRANSFORM

- Scan the full concept set within `{vault}/{subfolder}/` after EXTRACT, not just pages touched in this run. Never read concepts from sibling subfolders.
- Use normalized tags from the concept corpus as the primary grouping mechanism.
- Generate or update atlas MOCs and synthesis pages only from evidence already present in concept pages and raw sources.
- When creating or updating any concept, scan existing concepts within `{vault}/{subfolder}/concepts/` for shared tags. Add `[[{subfolder}/concepts/related-slug]]` entries in the `## Related` section for concepts that share 2 or more tags. Target 3-5 outbound wikilinks per concept page. Only link to concepts confirmed to exist in the current subfolder.

MOC generation rule:
- If 5 or more concept pages share the same normalized tag, create or update {vault}/{subfolder}/atlas/{tag-slug}.md.
- One tag = one MOC file.
- Do not create a tag MOC for fewer than 5 concepts.

Sparse MOC rule:
- If 2-4 concept pages share the same normalized tag, create or update {vault}/{subfolder}/atlas/{tag-slug}-sparse.md.
- Use the same atlas page format as a regular MOC page but set `status: sparse` in the frontmatter.
- Do not create a sparse MOC when a regular MOC already exists for the same tag.
- Sparse MOCs are upgraded to regular MOCs automatically when the tag reaches 5 concepts; at that point, rename the file from `{tag-slug}-sparse.md` to `{tag-slug}.md` and remove the `status: sparse` field.

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

- [[{subfolder}/concepts/concept-a]] - [One-line summary]
- [[{subfolder}/concepts/concept-b]] - [One-line summary]

## Related Synthesis

- [[{subfolder}/synthesis/tag-slug]] - [Only if a synthesis page exists]

## Related Tags

- [[{subfolder}/atlas/another-tag]] - [Only when genuinely related]
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
  - "_raw/2026-05-01/090011-deadbeef-001.md"
  - "_raw/2026-05-03/002.md"
  - "_raw/2026-05-04/143022-a1b2c3d4-001.md"
created: 2026-05-04
updated: 2026-05-04
---

# Synthesis: Tag Name

## Pattern

[State the non-obvious cross-cutting pattern in 1-2 paragraphs]

## Evidence

- [[{subfolder}/concepts/concept-a]] - [Evidence]
- [[{subfolder}/concepts/concept-b]] - [Evidence]
- [[{subfolder}/concepts/concept-c]] - [Evidence]

## Implications

- [Reusable lesson]
- [Constraint or tradeoff]
- [Follow-up question or operational consequence]
```

Maturity promotion during TRANSFORM:
- After a synthesis page is created or updated, mark each cited concept as `evergreen` only if it has no unresolved `[!contradiction]` callouts and does not have a `superseded_by` field.
- If a cited concept still has unresolved contradictions, do not promote it beyond its source-based status (`seedling` or `growing`) until the contradiction is resolved.
- Superseded concepts (those with `superseded_by` frontmatter) are permanently excluded from `evergreen` promotion regardless of synthesis citations.
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

- [[{subfolder}/atlas/tag-slug]] - [Concept count for the tag]

## Recently Updated

- [[{subfolder}/concepts/example-concept]]
- [[{subfolder}/synthesis/example-tag]]
- [[{subfolder}/atlas/example-tag]]
```

### 3. LOAD

#### Index

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
| concept | [[{subfolder}/concepts/example-concept]] | One-line summary. | 2026-05-04 |
| synthesis | [[{subfolder}/synthesis/example-tag]] | One-line summary. | 2026-05-04 |
| moc | [[{subfolder}/atlas/example-tag]] | One-line summary. | 2026-05-04 |
| session | [[{subfolder}/sessions/2026-05-04-a1b2c3d4]] | One-line outcome. | 2026-05-04 |
```

- Add one `session` row per session note created or updated during this compile.
- Use lowercase type value `session` exactly.

#### State

- Read {vault}/{subfolder}/_meta/state.json if it exists. Otherwise start with:

```json
{
  "ingested": {},
  "last_compile": null,
  "last_lint": null
}
```

Preserve all other existing keys (including `capture_metrics` and `total_cost_usd`) when updating an existing `state.json`.

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

#### Manifest

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
    "_raw/YYYY-MM-DD/143022-a1b2c3d4-001.md",
    "_raw/YYYY-MM-DD/002.md"
  ],
  "pages_created": [
    "concepts/example-concept.md",
    "atlas/example-tag.md",
    "sessions/2026-05-04-a1b2c3d4.md"
  ],
  "pages_updated": [
    "concepts/another-concept.md",
    "synthesis/example-tag.md",
    "index.md"
  ]
}
```

The `chunks` array may mix session-scoped filenames (`{HHMMSS}-{sid8}-{NNN}.md`) with bare numeric filenames (`002.md`). Bare numeric entries are legacy daily-layout chunks — they remain valid and readable; no migration is required.

Include every session note created or updated during this compile in `pages_created` (if new) or `pages_updated` (if it already existed).

- Merge and deduplicate `pages_created` and `pages_updated` if the source key already exists.
- Preserve all other manifest entries.
- Write {vault}/{subfolder}/_meta/manifest.json with 2-space JSON indentation.

#### Taxonomy

- Update {vault}/{subfolder}/_meta/taxonomy.md on every successful compile.
- Glob all concept pages in {vault}/{subfolder}/concepts/. Collect every unique tag from frontmatter `tags:` arrays.
- If taxonomy.md does not exist, create it with all collected tags.
- If taxonomy.md exists, read it and append any new tags not already listed.
- Taxonomy format:

```markdown
---
type: meta
title: "Taxonomy"
updated: 2026-05-04
---

# Taxonomy

| Tag | Canonical | Aliases |
|-----|-----------|---------|
| tag-slug | Tag Name | alias-1, alias-2 |
```

- When a concept uses a tag that resembles an existing tag (plural/singular, hyphenation variant), normalize it to the existing canonical form instead of creating a duplicate. Update the concept's frontmatter to use the canonical tag.

#### Bases

- Create or maintain four Obsidian Bases files under `{vault}/{subfolder}/atlas/bases/`. Bases require Obsidian 1.9 or later and read real frontmatter properties only.
- Create the `atlas/bases/` directory if it does not exist.
- Treat the YAML blocks below as canonical only for the managed structure of the four shipped Bases files: filename, top-level shape, and the default filters/view definitions.
- Regenerate a `.base` file only when one of those canonical elements is missing, invalid, or differs from the canonical block. This is canonical drift.
- If an existing `.base` file is valid YAML and still preserves the canonical structure, leave it unchanged so user formatting or other non-canonical edits are not clobbered.

`atlas/bases/sessions-timeline.base` — table of all session notes, newest first:

```yaml
filters:
  and:
    - 'type == "session"'
views:
  - type: table
    name: Sessions Timeline
    groupBy:
      property: date
      direction: DESC
    order:
      - file.name
      - date
      - project
      - outcome
      - tags
```

`atlas/bases/decisions.base` — concepts that contain decision-category key points or a `decision` tag:

```yaml
filters:
  and:
    - 'type == "concept"'
    - tags.contains("decision")
views:
  - type: table
    name: Decisions
    groupBy:
      property: updated
      direction: DESC
    order:
      - file.name
      - updated
      - tags
```

`atlas/bases/contradictions.base` — concepts with an unresolved contradiction (approximated via the `has_contradiction` frontmatter flag):

```yaml
filters:
  and:
    - 'type == "concept"'
    - has_contradiction == true
views:
  - type: table
    name: Contradictions
    groupBy:
      property: updated
      direction: DESC
    order:
      - file.name
      - updated
      - has_contradiction
```

`atlas/bases/seedlings.base` — concepts still at seedling maturity:

```yaml
filters:
  and:
    - 'type == "concept"'
    - 'status == "seedling"'
views:
  - type: table
    name: Seedlings
    groupBy:
      property: created
      direction: DESC
    order:
      - file.name
      - created
      - status
```

`has_contradiction` flag discipline: when adding a `[!contradiction]` callout to a concept page, set `has_contradiction: true` in that concept's frontmatter. When removing all `[!contradiction]` callouts from a concept page (because supersede resolution cleared them), set `has_contradiction: false`. The flag must stay in sync with callout presence on every concept update.

#### Log

- Append one build entry to {vault}/{subfolder}/_meta/log.md using this format:

```markdown
## [ISO-timestamp] compile | YYYY-MM-DD
- Source: _raw/YYYY-MM-DD/ ([chunk count] chunks, [session count] session(s))
- Concepts created: [count]
- Concepts updated: [count]
- Sessions created: [count]
- Sessions updated: [count]
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
<!-- folded: [[{subfolder}/_meta/folds/{fold-id}]] ({COUNT} entries, {EARLIEST-DATE} to {LATEST-DATE}) -->
```

- Append a fold action entry to `_meta/log.md` after the replacement:

```markdown
## [ISO-timestamp] fold | {fold-id}
- Entries folded: {COUNT} ({EARLIEST-DATE} to {LATEST-DATE})
- Fold page: [[{subfolder}/_meta/folds/{fold-id}]]
```

- Report the fold action in `/mmc` output whenever auto-archive runs.

#### Context

- On every compile, merge the new session context into the existing `context.md` body rather than appending or fragmenting it. Rewrite the body as a single coherent narrative that incorporates new focus, decisions, and threads while discarding anything resolved or stale. Keep the total body under 300 words. Update the `updated` frontmatter timestamp.
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
- Use raw chunk paths like `_raw/YYYY-MM-DD/143022-a1b2c3d4-001.md` for source provenance when session-scoped chunks exist.
- Preserve existing article intent and scope when updating.
- Prefer fewer precise pages over noisy page proliferation.
- Never invent facts that are not grounded in raw chunks or already-existing concept pages.
- Finish only when EXTRACT, TRANSFORM, and LOAD outputs are internally consistent with each other.

## Wikilink Convention

Every `[[wikilink]]` in article bodies must include the `{subfolder}/` prefix followed by the full directory-prefixed path. This ensures Obsidian resolves links within the correct project when multiple subfolders share a vault.

| Target type | Correct | Wrong |
| --- | --- | --- |
| Concept | `[[{subfolder}/concepts/hook-system-architecture]]` | `[[concepts/hook-system-architecture]]` |
| Synthesis | `[[{subfolder}/synthesis/hook-architecture-and-wiring]]` | `[[synthesis/hook-architecture-and-wiring]]` |
| Atlas MOC | `[[{subfolder}/atlas/hooks]]` | `[[atlas/hooks]]` |
| Session | `[[{subfolder}/sessions/2026-05-04-a1b2c3d4]]` | `[[sessions/2026-05-04-a1b2c3d4]]` |
| Raw source (body) | `[[{subfolder}/_raw/YYYY-MM-DD/HHMMSS-sid8-NNN]]` | `[[_raw/YYYY-MM-DD/HHMMSS-sid8-NNN]]` |
| Raw source (legacy) | `[[{subfolder}/_raw/2026-05-04/001]]` (legacy numeric layout — still readable) | `[[_raw/2026-05-04/001]]` |
| Meta fold | `[[{subfolder}/_meta/folds/fold-id]]` | `[[_meta/folds/fold-id]]` |

- YAML `sources:` arrays use plain string paths like `"_raw/2026-05-04/143022-a1b2c3d4-001.md"`, not wikilink brackets. These do not need the subfolder prefix.
