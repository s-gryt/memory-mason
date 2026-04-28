# Memory Mason

![Memory Mason cover](img/cover.png)

Memory Mason captures AI conversation context and syncs it into an Obsidian knowledge base.

## Install

- Claude Code: `claude plugin marketplace add s-gryt/memory-mason && claude plugin install memory-mason@memory-mason`
- Codex: clone this repo into your Codex plugins directory, open `/plugins`, search for `Memory Mason`, then install it.
- Gemini CLI: `gemini extensions install https://github.com/s-gryt/memory-mason`
- Cursor: `npx skills add s-gryt/memory-mason -a cursor --all`
- Windsurf: `npx skills add s-gryt/memory-mason -a windsurf --all`
- GitHub Copilot: `npx skills add s-gryt/memory-mason -a github-copilot --all`
- Cline: `npx skills add s-gryt/memory-mason -a cline --all`
- Any other Agent Skills host: `npx skills add s-gryt/memory-mason --all`

`npx skills` installs public KB skills only. For continuous capture in GitHub Copilot, keep [.github/hooks](.github/hooks) in the workspace or copy those hook definitions into `~/.copilot/hooks`.

Packaging model: [skills](skills) is source of truth for `npx skills add` installs across Cursor, Windsurf, Cline, GitHub Copilot, and other Agent Skills hosts. [hooks](hooks) powers Claude plugin runtime hooks. [.github/hooks](.github/hooks) is only GitHub Copilot hook wiring for continuous capture and is not part of shared skill installation.

For a user-level Copilot hook install that points at this clone with absolute paths, run `node hooks/install-copilot-hooks.js`. Remove it with `node hooks/uninstall-copilot-hooks.js`.

`npx skills add` discovers the source skills from [skills](skills) in this repository, then installs them into the target agent's own skills location. The source repo does not need `.github/skills/` for that install flow.

## Commands

- `/mmc`: compile a daily log into structured KB articles.
- `/mmq`: answer from the compiled KB with wikilink citations.
- `/mml`: run KB health checks.
- `/mms`: show KB status.

## Config

Copy `memory-mason.example.json` to `memory-mason.json` at the project root, or set `MEMORY_MASON_VAULT_PATH`.

```json
{
  "vaultPath": "~/ObsidianVault",
  "subfolder": "ai-knowledge"
}
```

## Packaging Surfaces

- [.claude-plugin](.claude-plugin) publishes the Claude Code marketplace package.
- [.agents/plugins/marketplace.json](.agents/plugins/marketplace.json) exposes the Codex plugin entry.
- [gemini-extension.json](gemini-extension.json) and [GEMINI.md](GEMINI.md) provide Gemini CLI extension metadata and context.
- [skills](skills) is the source of truth for the cross-agent KB skills.
- [hooks](hooks) contains the runtime capture scripts.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) runs hook coverage before syncing generated artifacts.
- [CLAUDE.md](CLAUDE.md) documents source-of-truth files and release maintenance.

See [docs/README.md](docs/README.md) for platform-specific setup details.

## License

MIT. See [LICENSE](LICENSE).
