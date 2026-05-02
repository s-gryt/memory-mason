---
name: mmq
description: >
  Query the knowledge base. Reads hot cache first, then the index, then
  relevant articles, and synthesizes a clear answer with [[wikilink]]
  citations. Use when you want to ask about past decisions, patterns,
  lessons, or technical knowledge captured in previous AI conversations.
argument-hint: "[question]"
allowed-tools: "Read Glob Grep"
---

## Objective

Answer a knowledge-base question using index-guided retrieval and cite sources with [[wikilinks]].

## Path Resolution

Before any other reasoning, resolve vault config in this priority order:
1. Process environment variable `MEMORY_MASON_VAULT_PATH`
2. Project `./.env`
3. Project `./memory-mason.json`
4. Global `~/.memory-mason/.env`
5. Global `~/.memory-mason/config.json`

Resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Use the source that provides the vault path.

Subfolder rules:
- If the vault path comes from an `.env` file, use `MEMORY_MASON_SUBFOLDER` from that same file when present, otherwise default to `ai-knowledge`.
- If the vault path comes from `memory-mason.json` or `~/.memory-mason/config.json`, use its `subfolder`.
- If the vault path comes from process env `MEMORY_MASON_VAULT_PATH`, first try project `./memory-mason.json` `subfolder`, then project `./.env` `MEMORY_MASON_SUBFOLDER`, then default to `ai-knowledge`.

Do not claim config is missing until you have attempted all five locations above. If none provide a vault path, state that the knowledge base is not initialized because no supported Memory Mason config source was found.

Use these paths:
- Hot cache: {vault}/{subfolder}/hot.md
- Index: {vault}/{subfolder}/knowledge/index.md
- Concepts: {vault}/{subfolder}/knowledge/concepts/
- Connections: {vault}/{subfolder}/knowledge/connections/
- Q&A: {vault}/{subfolder}/knowledge/qa/
- Build log: {vault}/{subfolder}/knowledge/log.md

## Steps

1. Read {vault}/{subfolder}/hot.md if it exists.
- Treat hot.md as a fast cache of recent context, not a replacement for the knowledge base.
- If hot.md directly answers the question with enough precision, answer immediately.
- If hot.md is relevant but incomplete, extract likely article names, topics, and follow-up questions from it,
  then continue.

2. Read {vault}/{subfolder}/knowledge/index.md.
- This is the primary retrieval mechanism after the hot cache.
- If it is missing, state that the knowledge base is not initialized.

3. Read the index table carefully.
- Identify 3-10 articles most relevant to the user question.
- Prefer pages explicitly mentioned in hot.md when they are relevant to the question.

4. Read selected articles in full.
- Pull complete article context before answering.

5. Synthesize a clear, thorough answer.
- Cite supporting sources with [[wikilinks]] (for example: [[concepts/example-article]]).
- Use [[hot]] only when the answer truly comes from the cache and no better article citation exists.

6. Handle missing knowledge honestly.
- If the knowledge base does not contain relevant information, say so clearly.
- Suggest running /mmc if there are uncompiled daily logs.

## Optional: File Back Behavior

Only perform this section if the user explicitly asks to file the answer.

1. Create a Q&A article at {vault}/{subfolder}/knowledge/qa/{question-slug}.md using:

```markdown
---
title: "Q: Original Question"
question: "The exact question asked"
consulted:
  - "concepts/article-1"
filed: YYYY-MM-DD
---

# Q: Original Question

## Answer

[Synthesized answer with [[wikilinks]] to sources]

## Sources Consulted

- [[concepts/article-1]] - Relevant because...

## Follow-Up Questions

- [related question worth exploring]
```

2. Update {vault}/{subfolder}/knowledge/index.md with a new row for the Q&A article.

3. Append to {vault}/{subfolder}/knowledge/log.md with:

```markdown
## [ISO-timestamp] query (filed) | question-slug
- Question: [question text]
- Consulted: [[list of articles read]]
- Filed to: [[qa/article-name]]
```

## Answering Guidelines

- Prefer precision over broad speculation.
- Keep the final answer directly tied to cited knowledge articles.
- Use hot.md to accelerate retrieval, not to skip article reads when the answer requires durable citations.
- Use concise, clear language and explicit reasoning.
