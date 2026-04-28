# Memory Mason

Memory Mason is a cross-LLM Obsidian sync package.
It combines hook-based capture with reusable KB skills so you can keep one knowledge base across Claude Code, GitHub Copilot, Codex, Gemini CLI, Cursor, Windsurf, Cline, and other Agent Skills hosts.

## Install

- Claude Code: `claude plugin marketplace add s-gryt/memory-mason && claude plugin install memory-mason@memory-mason`
- Codex: clone this repo into your Codex plugins directory, open `/plugins`, search `Memory Mason`, then install it.
- Gemini CLI: `gemini extensions install https://github.com/s-gryt/memory-mason`
- GitHub Copilot: `npx skills add s-gryt/memory-mason -a github-copilot --all`
- Cursor: `npx skills add s-gryt/memory-mason -a cursor --all`
- Windsurf: `npx skills add s-gryt/memory-mason -a windsurf --all`
- Cline: `npx skills add s-gryt/memory-mason -a cline --all`
- Any other Agent Skills host: `npx skills add s-gryt/memory-mason --all`

`npx skills` installs skills only. It does not install GitHub Copilot hooks.

It discovers source skills from [skills](skills) in this repository and installs them into agent-specific skill locations. The source repo itself does not need `.github/skills/` for `npx skills add` to work.

For continuous capture in Copilot, keep [.github/hooks](.github/hooks) in the workspace or copy those hook files into `~/.copilot/hooks`.

If you want a user-level install that points at this clone with absolute paths, run:

```bash
node hooks/install-copilot-hooks.js
```

Remove it with:

```bash
node hooks/uninstall-copilot-hooks.js
```

## Runtime Model

- Hooks append session activity into `{vault}/{subfolder}/daily/YYYY-MM-DD.md`.
- `/mmc` turns daily logs into knowledge articles under `{vault}/{subfolder}/knowledge/`.
- `/mmq` answers questions from the compiled KB with `[[wikilink]]` citations.
- `/mml` reports KB quality issues.
- `/mms` shows KB status and compilation coverage.

No separate API key is required. Hooks write through the Obsidian CLI when available and fall back to direct filesystem writes.

## Config

Copy `memory-mason.example.json` to `memory-mason.json` at the project root:

```json
{
  "vaultPath": "~/ObsidianVault",
  "subfolder": "ai-knowledge"
}
```

You can also set `MEMORY_MASON_VAULT_PATH` to override `vaultPath`.
If neither the config file nor the environment variable is present, hooks fail fast instead of writing into the repo directory.

## Vault Layout

```text
{vault}/{subfolder}/
├── daily/
│   └── 2026-04-26.md
├── knowledge/
│   ├── index.md
│   ├── log.md
│   ├── concepts/
│   ├── connections/
│   └── qa/
└── state.json
```

## Commands

- `/mmc`
- `/mmq [question]`
- `/mml`
- `/mms`

## Platform Notes

- Claude Code uses [.claude-plugin/plugin.json](.claude-plugin/plugin.json) and [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json).
- Codex uses [.agents/plugins/marketplace.json](.agents/plugins/marketplace.json) and [plugins/memory-mason](plugins/memory-mason).
- Gemini CLI uses [gemini-extension.json](gemini-extension.json) and [GEMINI.md](GEMINI.md).
- GitHub Copilot uses [AGENTS.md](AGENTS.md), [.github/hooks](.github/hooks), and [.github/copilot-instructions.md](.github/copilot-instructions.md). Skill installation for Copilot comes from `npx skills add`, not from checked-in `.github/skills/` copies.
- Cursor, Windsurf, and other Agent Skills hosts read from [skills](skills) and the synced rule copies.

## Hook Coverage

- Claude Code: session start, post-tool-use, pre-compact, session end.
- GitHub Copilot VS Code: session start, post-tool-use, pre-compact, stop.
- GitHub Copilot CLI: session start, post-tool-use, session end.
- Codex: session start, post-tool-use, stop.

Copilot CLI ignores session-start output, so KB context comes from [.github/copilot-instructions.md](.github/copilot-instructions.md) instead of hook-returned text.

## Development

```bash
cd hooks
npm install
npm test
npm run coverage
```

`npm run coverage` enforces `100%` line, statement, function, and branch coverage for shared hook logic under `hooks/lib/`. Hook entry scripts are covered by direct behavior tests in `hooks/__tests__/entrypoints.test.js`.

## License

MIT. See [LICENSE](LICENSE).
