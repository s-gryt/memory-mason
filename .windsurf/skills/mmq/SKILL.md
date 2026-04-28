---
name: mmq
description: >
  Query the knowledge base. Reads the index, identifies relevant articles,
  synthesizes a clear answer with [[wikilink]] citations. Use when you want
  to ask about past decisions, patterns, lessons, or technical knowledge
  captured in previous AI conversations.
argument-hint: "[question]"
allowed-tools: "Read Glob Grep"
---

## Objective

Answer a knowledge-base question using index-guided retrieval and cite sources with [[wikilinks]].

## Path Resolution

Before any other reasoning, read `./memory-mason.json` from the current project root and resolve:
- {vault}: absolute path to the Obsidian vault
- {subfolder}: plugin-managed subfolder inside the vault

Do not claim config is missing until you have attempted that read.
If `./memory-mason.json` is missing, run one workspace search for `**/memory-mason.json`.
- If exactly one file is found, read it and continue.
- If multiple files are found, report the candidate paths briefly and ask which project root to use.
- If no file is found, state that the knowledge base is not initialized.

Use these paths:
- Index: {vault}/{subfolder}/knowledge/index.md
- Concepts: {vault}/{subfolder}/knowledge/concepts/
- Connections: {vault}/{subfolder}/knowledge/connections/
- Q&A: {vault}/{subfolder}/knowledge/qa/
- Build log: {vault}/{subfolder}/knowledge/log.md

## Steps

1. Read {vault}/{subfolder}/knowledge/index.md.
- This is the primary retrieval mechanism.
- If it is missing, state that the knowledge base is not initialized.

2. Read the index table carefully.
- Identify 3-10 articles most relevant to the user question.

3. Read selected articles in full.
- Pull complete article context before answering.

4. Synthesize a clear, thorough answer.
- Cite supporting sources with [[wikilinks]] (for example: [[concepts/example-article]]).

5. Handle missing knowledge honestly.
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
- Use concise, clear language and explicit reasoning.
