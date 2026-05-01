---
name: mmc
description: >
  Compile today's daily conversation log into structured knowledge articles
  in the Obsidian vault. Creates concept pages, connection pages, updates
  the knowledge index, build log, hot cache, and source manifest. Use when
  you want to process captured AI conversations into permanent, searchable
  knowledge.
argument-hint: "[daily-log-file]"
allowed-tools: "Read Write Edit Glob Grep Bash(obsidian *)"
---

## Objective

Compile one daily conversation log into structured knowledge articles in the Obsidian vault.

## Path Resolution

Before any other reasoning, read `./memory-mason.json` from the current project root and resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Do not claim config is missing until you have attempted that read.
If `./memory-mason.json` is missing, run one workspace search for `**/memory-mason.json`.
- If exactly one file is found, read it and continue.
- If multiple files are found, report the candidate paths briefly and ask which project root to use.
- If no file is found, fail fast with an explicit error.

Use these paths for all operations:
- Daily logs: {vault}/{subfolder}/daily/
- Knowledge root: {vault}/{subfolder}/knowledge/
- Concepts: {vault}/{subfolder}/knowledge/concepts/
- Connections: {vault}/{subfolder}/knowledge/connections/
- Index: {vault}/{subfolder}/knowledge/index.md
- Build log: {vault}/{subfolder}/knowledge/log.md
- State file: {vault}/{subfolder}/state.json
- Hot cache: {vault}/{subfolder}/hot.md
- Manifest: {vault}/{subfolder}/.manifest.json

## Steps

1. Find and chunk the log to compile
- If an argument was provided, use it as the target log file.
- If no argument was provided, use today's daily log: {vault}/{subfolder}/daily/{YYYY-MM-DD}.md.
If the target resolves to a folder {vault}/{subfolder}/daily/{YYYY-MM-DD}/, read chunks in numeric order: `001.md`, `002.md`, etc. Concatenate their contents in order to form the full log text. Process this concatenated text exactly as if it were a single flat file. Use the date string `YYYY-MM-DD` (not `YYYY-MM-DD.md`) as the state.json ingested key for folder-per-day logs.
- If the file is missing, fail fast with an explicit error.

Chunking protocol (required for files over 50KB):
a. Read the file size. If under 50KB, read full content and proceed to Steps 2 and 3 as before.
b. For large files: parse the file line-by-line while tracking fenced code blocks opened and closed by triple backticks.
c. Only lines outside fenced code blocks may start a top-level block. This avoids false matches from pasted examples such as
   `## Session [ISO timestamp] ...` or copied session headers inside tool output.
d. Top-level blocks are:
   - real transcript capture headers matching `^## Session \[[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z)?\] .+ / .+$`
   - event headers matching `^\*\*\[[0-9]{2}:[0-9]{2}:[0-9]{2}\] [^*]+\*\*$`
   - leading preamble content before the first top-level block
e. Build chunks by grouping consecutive top-level blocks up to roughly 50KB. Do not split a top-level block across chunks.
f. If a single top-level block itself exceeds 100KB, treat it as its own standalone chunk and process it fully without truncation after Steps 2 and 3 are complete.
g. After chunk boundaries are established, continue to Steps 2 and 3.
h. After Steps 2 and 3 are complete, process chunks one at a time:
   - For each chunk: extract 3-7 concepts (apply Step 4 logic per chunk using the current index and existing articles as context)
  - Accumulate created/updated article names across blocks
  - After all blocks: merge/deduplicate concepts (prefer updating existing over creating duplicates)

Per-chunk checkpoint (for incremental /mmc runs):
- Before processing each chunk, check {vault}/{subfolder}/state.json for a
  "chunks" map under the daily log filename entry.
- The chunk key must be deterministic and based on the real chunk boundaries, for example:
  `session-2026-04-30T14:22:01-lines-10500-63299` or `preamble-lines-1-10499`.
- If a chunk entry exists with a hash matching the current chunk content hash
  (first 16 chars of SHA-256), skip that chunk - already compiled.
- After compiling each chunk, write its hash to state.json immediately:
  state.ingested["2026-04-30.md"].chunks["session-2026-04-30T14:22:01-lines-10500-63299"] = { hash: "<16-char>", compiled_at: "<ISO>" }
- The top-level ingested entry hash (Step 8) still represents the full file hash.

Manifest checkpoint (source-to-page lineage, optional but preferred):
- Read {vault}/{subfolder}/.manifest.json if it exists, or start with `{ "sources": {} }`.
- After the full log text is assembled, compute a full-source 16-character SHA-256 hash.
- Use the same source key convention as state.json:
  - flat file -> `YYYY-MM-DD.md`
  - folder-per-day -> `YYYY-MM-DD`
- If the manifest already contains the same source key with the same full-source hash and the user did not
  explicitly ask to force recompilation, stop and report `Already compiled (unchanged).`
- Use `state.json` for runtime checkpoints and chunk hashes. Use `.manifest.json` for source-to-page lineage.

2. Read the current knowledge index
- Read {vault}/{subfolder}/knowledge/index.md if it exists.
- If it does not exist, start with an empty index state.

3. Read existing articles for context
- Glob all files in {vault}/{subfolder}/knowledge/concepts/.
- Glob all files in {vault}/{subfolder}/knowledge/connections/.
- Read existing articles to avoid duplicates and find update targets.

4. Extract concepts and compile
- Identify 3-7 distinct concepts from the daily log that are worth their own article.
- For each concept:
- If it already exists in the knowledge base, update the existing article with new information and add the source to frontmatter.
- If it is new, create a new article.
- Create connection articles when the log reveals non-obvious relationships between 2+ existing concepts.
- Prefer updating existing articles over creating near-duplicates.

5. Article format
- Follow these schemas exactly.

Concept article (knowledge/concepts/{slug}.md):
```markdown
---
title: "Concept Name"
aliases: [alternate-name, abbreviation]
tags: [domain, topic]
sources:
  - "daily/YYYY-MM-DD.md"
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Concept Name

[2-4 sentence core explanation]

## Key Points

- [Bullet points, each self-contained]

## Details

[Deeper explanation, encyclopedia-style paragraphs]

## Related Concepts

- [[concepts/related-concept]] - How it connects

## Sources

- [[daily/YYYY-MM-DD.md]] - What was learned from this log
```

Connection article (knowledge/connections/{slug}.md):
```markdown
---
title: "Connection: X and Y"
connects:
  - "concepts/concept-x"
  - "concepts/concept-y"
sources:
  - "daily/YYYY-MM-DD.md"
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Connection: X and Y

## The Connection

[What links these concepts]

## Key Insight

[The non-obvious relationship discovered]

## Evidence

[Specific examples from conversations]

## Related Concepts

- [[concepts/concept-x]]
- [[concepts/concept-y]]
```

6. Update the knowledge index
- Update {vault}/{subfolder}/knowledge/index.md.
- Add new rows for newly created articles.
- Update existing rows for updated articles.
- Use row format: | [[path/slug]] | One-line summary | source-file | YYYY-MM-DD |
- Ensure the index begins with:

```markdown
# Knowledge Base Index

| Article | Summary | Compiled From | Updated |
|---------|---------|---------------|---------|
```

7. Append to build log
- Append to {vault}/{subfolder}/knowledge/log.md using this format:

```markdown
## [ISO-timestamp] compile | daily-log-filename.md
- Source: daily/YYYY-MM-DD.md
- Articles created: [[concepts/x]], [[concepts/y]]
- Articles updated: [[concepts/z]] (if any)
```

8. Update state.json
- Read {vault}/{subfolder}/state.json if it exists, or start with default state: {"ingested":{}, "last_compile": null, "last_lint": null}
- Compute a 16-character SHA-256 hex hash of the daily log file content. Reuse the full-source hash from the
  manifest checkpoint if you already computed it.
- For folder-per-day logs: compute the hash over the full concatenated content of all chunks (same as if it were a flat file).
- Set the ingested entry for the compiled daily log key. For flat files use filename key `"2026-04-26.md"`. For folder-per-day logs use date key `"2026-04-30"` (no extension):
  {"hash": "<16-char-hash>", "compiled_at": "<ISO-8601 timestamp>"}
- Set "last_compile" to the current ISO-8601 timestamp.
- Write the updated state to {vault}/{subfolder}/state.json with 2-space JSON indentation.

8.4 Update .manifest.json
- Read {vault}/{subfolder}/.manifest.json if it exists, or start with:

```json
{
  "sources": {}
}
```

- Set `sources[sourceKey]` using the same source key chosen for state.json.
- Record:
  - `source_path`: `daily/YYYY-MM-DD.md` for flat files or `daily/YYYY-MM-DD/` for folder-per-day logs
  - `hash`: the 16-character full-source hash
  - `compiled_at`: current ISO timestamp
  - `pages_created`: knowledge-relative page paths created by this compile, such as
    `knowledge/concepts/auth-pattern.md`
  - `pages_updated`: knowledge-relative page paths updated by this compile
- If the source already exists in the manifest, merge and deduplicate `pages_created` and `pages_updated`
  instead of narrowing them.
- Preserve all other source entries.
- Write the updated manifest to {vault}/{subfolder}/.manifest.json with 2-space JSON indentation.

8.5 Update hot.md
- After compiling, write a ~500-word session hot cache to {vault}/{subfolder}/hot.md.
- Format:

```markdown
---
type: meta
title: "Hot Cache"
updated: {ISO-timestamp}
---

## Last Updated
{date}

## Key Recent Facts
- {3-5 bullets summarizing most important things compiled in this session}

## Recent Changes
- Created: {wikilinks to newly created articles, if any}
- Updated: {wikilinks to updated articles, if any}

## Active Threads
- {any open questions or follow-ups visible in the daily log}
```

- Keep hot.md under 500 words. Overwrite completely each time (it's a cache, not a log).
- Use the created/updated article lists from the current compile and, when helpful, the manifest entry you just
  wrote to keep the cache consistent with durable page lineage.

8.6 Decompose oversized flat daily logs
- This step applies only when the source was a flat `.md` file (not already a folder-per-day).
- If the compiled daily log is still over 2MB or 20,000 lines after successful compilation, decompose it inside the vault for Obsidian usability.
- Create chunk files under {vault}/{subfolder}/daily/chunks/{YYYY-MM-DD}/ using stable names such as `part-001.md`, `part-002.md`, and so on.
- Move only already-compiled chunks into those files. Preserve their original text verbatim.
- Rewrite {vault}/{subfolder}/daily/{YYYY-MM-DD}.md as a lightweight index/stub.
- If the source was already a folder-per-day, skip this step - the data is already chunked.

9. Quality standards
- Every article must have complete YAML frontmatter with all required fields.
- Every article must link to at least 2 other articles via [[wikilinks]].
- Key Points section must include 3-5 bullet points minimum.
- Details section must include 2+ paragraphs minimum.
- Related Concepts section must include 2+ entries minimum.
- Sources section must cite the daily log with specific claims extracted.

## Writing Guidelines

- Write in encyclopedia style: factual, clear, and self-contained.
- Use Obsidian wikilinks without .md extensions.
- Keep filenames lowercase with hyphens for slugs.
- Preserve existing article intent and structure when updating.
