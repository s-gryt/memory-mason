---
name: mmq
description: >
  Query the knowledge base. Reads session context first, then the root index,
  then relevant atlas, concept, and synthesis pages, and synthesizes a clear
  answer with [[wikilink]] citations. Use when you want to ask about past
  decisions, patterns, lessons, or technical knowledge captured in previous
  AI conversations.
argument-hint: "[question]"
allowed-tools: "Read Glob Grep"
---

## Objective

Answer a knowledge-base question using index-guided retrieval and cite sources with [[wikilinks]].

This command is operational only. Do not write `/mmq`, `/memory-mason:mmq`, or their execution chatter back into the vault.

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

Do not claim config is missing until you have attempted all four locations above. If none provide a vault path, state that the knowledge base is not initialized because no supported Memory Mason config source was found.

Use these paths:
- Session context: {vault}/{subfolder}/_meta/context.md
- Manifest: {vault}/{subfolder}/_meta/manifest.json
- Build log: {vault}/{subfolder}/_meta/log.md
- Index: {vault}/{subfolder}/index.md
- Atlas: {vault}/{subfolder}/atlas/
- Concepts: {vault}/{subfolder}/concepts/
- Synthesis: {vault}/{subfolder}/synthesis/
- Raw captures: {vault}/{subfolder}/_raw/

## Steps

1. Read {vault}/{subfolder}/_meta/context.md if it exists.
- Treat `context.md` as a fast cache of recent context, not a replacement for the knowledge base.
- If `context.md` directly answers the question with enough precision, answer immediately.
- If `context.md` is relevant but incomplete, extract likely page names, tags, dates, and follow-up questions from it, then continue.

2. Read {vault}/{subfolder}/index.md.
- This is the primary retrieval mechanism after the session context.
- If it is missing, state that the knowledge base is not initialized.

3. Read the index table carefully.
- Identify 3-10 pages most relevant to the user question.
- Prefer pages explicitly mentioned in `context.md` when they are relevant.
- Use atlas pages for broad topic questions, synthesis pages for cross-cutting pattern questions, and concept pages for specific definition, workflow, or decision questions.

4. Read selected pages in full.
- Pull complete article context before answering.
- If the answer depends on source provenance or freshness, read {vault}/{subfolder}/_meta/manifest.json to see which `_raw/YYYY-MM-DD/` sources were compiled.
- If needed, inspect specific `_raw/YYYY-MM-DD/NNN.md` chunks directly instead of assuming the vault is current.

5. Synthesize a clear, thorough answer.
- Cite supporting sources with [[wikilinks]] using the `{subfolder}/` prefix: [[{subfolder}/concepts/example-concept]], [[{subfolder}/synthesis/example-tag]], or [[{subfolder}/atlas/example-tag]].
- Use `context.md` only as retrieval assistance. Do not cite `_meta/context.md` as authoritative when a durable page exists.
- Mention raw chunk paths in prose only when you directly inspected them and no durable page exists yet.

6. Handle missing knowledge honestly.
- If the knowledge base does not contain relevant information, say so clearly.
- Suggest running `/mmc` if relevant information appears to exist in `_raw/` but is not compiled into durable pages yet.
- Use {vault}/{subfolder}/_meta/log.md only to clarify recency or whether a compile happened. Do not treat the build log as a primary knowledge source.

## Filing Behavior

- Vault Architecture v2 does not define a dedicated filed Q&A location.
- Do not create a filed-answer page unless the user explicitly provides a destination path outside this skill.

## Answering Guidelines

- Prefer precision over broad speculation.
- Keep the final answer directly tied to cited durable pages.
- Use `_meta/context.md` to accelerate retrieval, not to skip article reads when the answer requires durable citations.
- Use concise, clear language and explicit reasoning.
