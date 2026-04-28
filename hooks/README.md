# Hooks

Memory Mason hooks capture prompts, tool output, and session summaries into an Obsidian vault.

## Config

Hooks resolve config in this order:

1. `MEMORY_MASON_VAULT_PATH`
2. `memory-mason.json`

If neither is present, hooks fail fast.

Example config:

```json
{
  "vaultPath": "~/ObsidianVault",
  "subfolder": "ai-knowledge"
}
```

## Hook files

- `session-start.js` — injects KB context from compiled index and recent daily log entries
- `user-prompt-submit.js` — appends raw user prompts to daily logs
- `post-tool-use.js` — appends tool results after meaningful tool calls
- `pre-compact.js` — captures transcript excerpts before compaction
- `session-end.js` — captures transcript excerpts at session end / stop

## Platform mappings

- Claude Code plugin uses `hooks/hooks.json`
- Repo-local Codex setup uses `.codex/hooks.json`
- GitHub Copilot can use `.github/hooks/` in a workspace or `~/.copilot/hooks`

## Copilot user-level install

Install user-level Copilot hook files that point at this clone with absolute paths:

```bash
node hooks/install-copilot-hooks.js
```

Remove them later with:

```bash
node hooks/uninstall-copilot-hooks.js
```

## Tests

```bash
cd hooks
npm test
npm run coverage
```

`npm run coverage` enforces `100%` line, statement, function, and branch coverage for shared logic in `lib/`. Entry scripts are validated by direct behavioral tests in `__tests__/entrypoints.test.js`.
