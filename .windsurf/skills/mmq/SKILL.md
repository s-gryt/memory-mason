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
- Atlas bases: {vault}/{subfolder}/atlas/bases/
- Concepts: {vault}/{subfolder}/concepts/
- Synthesis: {vault}/{subfolder}/synthesis/
- Sessions: {vault}/{subfolder}/sessions/
- Raw captures: {vault}/{subfolder}/_raw/

## Steps

1. Read {vault}/{subfolder}/_meta/context.md if it exists.
- Treat `context.md` as a fast cache of recent context, not a replacement for the knowledge base.
- If `context.md` directly answers the question with enough precision, answer immediately.
- If `context.md` is relevant but incomplete, extract likely page names, tags, dates, and follow-up questions from it, then continue.

2. Read {vault}/{subfolder}/index.md.
- This is the primary guided retrieval mechanism after the session context.
- If it is missing, state that the knowledge base is not initialized.

3. Read the index table carefully.
- Identify 3-10 pages most relevant to the user question.
- Prefer pages explicitly mentioned in `context.md` when they are relevant.
- Use atlas pages for broad topic questions, synthesis pages for cross-cutting pattern questions, concept pages for specific definition, workflow, or decision questions, and session pages for temporal or episodic questions.

4. If index selection yields insufficient coverage, run a grep stage.
- Search `concepts/`, `synthesis/`, `atlas/`, and `sessions/` for the query keywords (case-insensitive). Also check `aliases:` and `tags:` frontmatter fields for keyword matches.
- Add any newly identified relevant pages to the reading list. Prefer concept and synthesis pages over session pages for durable factual questions.

4a. For temporal questions ("what did I do last week", "what happened on YYYY-MM-DD", "recent activity"), read the sessions tier.
- Glob `{vault}/{subfolder}/sessions/` for notes matching the relevant date range (filter by the `date` frontmatter field).
- Use `atlas/bases/sessions-timeline.base` as a structural guide to understand sort order, but read the actual session `.md` files for content.
- Cite session notes in the answer. Confidence aggregation does not apply to session notes.

5. Read selected pages in full.
- Pull complete article context before answering.
- If the answer depends on source provenance or freshness, read {vault}/{subfolder}/_meta/manifest.json to see which `_raw/YYYY-MM-DD/` sources were compiled.
- If needed, inspect specific raw chunk files directly (both legacy `_raw/YYYY-MM-DD/NNN.md` and session-scoped `_raw/YYYY-MM-DD/HHMMSS-{sid8}-NNN.md`) instead of assuming the vault is current.

6. Aggregate confidence from cited pages.
- After reading concept pages, collect the `confidence` field from each cited concept's YAML frontmatter. Valid values: `high`, `medium`, `low`.
- Apply lowest-wins semantics: if any cited concept is `low`, overall confidence is `low`; else if any is `medium`, overall confidence is `medium`; else `high`.
- If any cited concept has `status: seedling` or contains a `[!gap]` callout, note it in the answer.
- Append to the answer footer:
  `Confidence: [high|medium|low] (based on N cited concept pages)`
  If any seedling or gap concepts were cited, add: `Note: answer draws on N seedling/gap concept(s): [names].`
- Apply only to cited concept pages. Do not aggregate from atlas, synthesis, or session pages.

7. Synthesize a clear, thorough answer.
- Cite supporting sources with [[wikilinks]] using the `{subfolder}/` prefix: [[{subfolder}/concepts/example-concept]], [[{subfolder}/synthesis/example-tag]], [[{subfolder}/atlas/example-tag]], or [[{subfolder}/sessions/YYYY-MM-DD-{sid8}]].
- Use `context.md` only as retrieval assistance. Do not cite `_meta/context.md` as authoritative when a durable page exists.
- Mention raw chunk paths in prose only when you directly inspected them and no durable page exists yet.

8. Handle missing knowledge honestly.
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
   - `**<count>x** \`<hash16>\` (kind: <kind>) — first: <iso>, last: <iso>` followed by a one-line note describing the workflow signal. If the advisory has a `snippet`, append it: `— "<snippet>"`. Omit the trailing snippet segment entirely when absent (older advisories predate this field).
5. Append a footer: `See [[{subfolder}/atlas/workflow-coaching]] for the full list.`
6. Do NOT write back to the vault. This is a read-only retrieval.

#### Candidate skills

After the advisory list, append a `### Candidate skills` subsection. Populate it from the same `## Active Advisories` data:

- Include every advisory whose `kind` is not `prompt-repeat`.
- Include every `prompt-repeat` advisory whose `count` is 5 or more.
- Phrase each entry as a recommendation rather than a raw signal, and branch the phrasing by `kind`:
  - `prompt-repeat` — a repeated prompt pattern suggests automation or a dedicated skill could eliminate the manual repetition.
  - `error-repeat` — a recurring error suggests the underlying bug or misconfiguration should be fixed, not turned into a skill.
- Render one bullet per candidate:
  - `**<count>x** \`<hash16>\` (kind: <kind>) — <one-line recommendation>` (e.g. "Recurring task: consider creating a skill or automation for this workflow." for `prompt-repeat`; "Recurring error: investigate and fix the underlying cause." for `error-repeat`). If the advisory has a `snippet`, append it in quotes so the recommendation is actionable: `— "<snippet>"`. Omit when absent.
- If no advisories meet the inclusion criteria, omit the subsection entirely.
- Keep the existing advisory list format unchanged above this subsection.

Confidence aggregation does NOT apply to `insights` because advisories are not concept pages. Skip the `Confidence:` footer.
