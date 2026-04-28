---
name: mmc
description: >
  Compile today's daily conversation log into structured knowledge articles
  in the Obsidian vault. Creates concept pages, connection pages, updates
  the knowledge index and build log. Use when you want to process captured
  AI conversations into permanent, searchable knowledge.
argument-hint: "[daily-log-file]"
allowed-tools: "Read Write Edit Glob Grep Bash(obsidian *)"
---

## Objective

Compile one daily conversation log into structured knowledge articles in the Obsidian vault.

## Path Resolution

Read memory-mason.json first and resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Use these paths for all operations:
- Daily logs: {vault}/{subfolder}/daily/
- Knowledge root: {vault}/{subfolder}/knowledge/
- Concepts: {vault}/{subfolder}/knowledge/concepts/
- Connections: {vault}/{subfolder}/knowledge/connections/
- Index: {vault}/{subfolder}/knowledge/index.md
- Build log: {vault}/{subfolder}/knowledge/log.md

## Steps

1. Find the log to compile
- If an argument was provided, use it as the target log file.
- If no argument was provided, use today's daily log: {vault}/{subfolder}/daily/{YYYY-MM-DD}.md.
- Read the selected log file content.
- If the file is missing, fail fast with an explicit error.

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
- Compute a 16-character SHA-256 hex hash of the daily log file content.
- Set the ingested entry for the compiled daily log filename (e.g. "2026-04-26.md"):
  {"hash": "<16-char-hash>", "compiled_at": "<ISO-8601 timestamp>"}
- Set "last_compile" to the current ISO-8601 timestamp.
- Write the updated state to {vault}/{subfolder}/state.json with 2-space JSON indentation.

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
