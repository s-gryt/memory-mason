---
name: mmq
description: >
  Query the knowledge base. Reads session context first, then the root index,
  then relevant atlas, concept, and synthesis pages, and synthesizes a clear
  answer with [[wikilink]] citations. Use when you want to ask about past
  decisions, patterns, lessons, or technical knowledge captured in previous
  AI conversations. Use the `insights` argument to surface workflow-coaching
  advisories from hook-generated data.
argument-hint: "[question | insights]"
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

Resolve `{vault}` (absolute path) and `{subfolder}` from the matched source; `.env` sources use `MEMORY_MASON_SUBFOLDER` (default: `ai-knowledge`), JSON sources use `subfolder`. If none provide a vault path, state the knowledge base is not initialized.

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

5. Aggregate confidence from cited pages.
- After reading concept pages, collect the `confidence` field from each cited concept's YAML frontmatter. Valid values: `high`, `medium`, `low`.
- Apply lowest-wins semantics: if any cited concept is `low`, overall confidence is `low`; else if any is `medium`, overall confidence is `medium`; else `high`.
- If any cited concept has `status: seedling` or contains a `[!gap]` callout, note it in the answer.
- Append to the answer footer:
  `Confidence: [high|medium|low] (based on N cited concept pages)`
  If any seedling or gap concepts were cited, add: `Note: answer draws on N seedling/gap concept(s): [names].`
- Apply only to cited concept pages. Do not aggregate from atlas or synthesis pages directly unless they themselves cite a concept that contributes to the answer.

6. Synthesize a clear, thorough answer.
- Cite supporting sources with [[wikilinks]] using the `{subfolder}/` prefix: [[{subfolder}/concepts/example-concept]], [[{subfolder}/synthesis/example-tag]], or [[{subfolder}/atlas/example-tag]].
- Use `context.md` only as retrieval assistance. Do not cite `_meta/context.md` as authoritative when a durable page exists.
- Mention raw chunk paths in prose only when you directly inspected them and no durable page exists yet.

7. Handle missing knowledge honestly.
- If the knowledge base does not contain relevant information, say so clearly.
- Suggest running `/mmc` if relevant information appears to exist in `_raw/` but is not compiled into durable pages yet.
- Use {vault}/{subfolder}/_meta/log.md only to clarify recency or whether a compile happened. Do not treat the build log as a primary knowledge source.

## Predefined arguments

Some arguments map to predefined retrieval flows instead of free-form questions. When the argument exactly matches one of these tokens (case-insensitive, whitespace-trimmed), follow the flow defined here. Otherwise treat the argument as a free-form question and run the default `## Steps` flow.

### `insights`

Surface current workflow-coaching advisories from the hook-generated knowledge.

Steps:
1. Read `{vault}/{subfolder}/atlas/workflow-coaching.md`. If the file is missing or empty, respond with: `No workflow-coaching advisories yet. Hooks have not crossed the nag threshold.` and stop.
2. Parse the `## Active Advisories` section.
3. List up to the top 5 entries by `count` descending, then by most recent `last` descending.
4. For each surfaced advisory, render one bullet:
   - `**<count>x** \`<hash16>\` (kind: <kind>) — first: <iso>, last: <iso>` followed by a one-line note describing the workflow signal.
5. Append a footer: `See [[{subfolder}/atlas/workflow-coaching]] for the full list.`
6. Do NOT write back to the vault. This is a read-only retrieval.

Confidence aggregation does NOT apply to `insights` because advisories are not concept pages. Skip the `Confidence:` footer.
