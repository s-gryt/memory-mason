# Memory Mason

![Memory Mason cover](img/cover.png)

Memory Mason captures AI conversation context and syncs it into an Obsidian knowledge base.

[![GitHub stars](https://img.shields.io/github/stars/s-gryt/memory-mason?style=flat&color=e8734a)](https://github.com/s-gryt/memory-mason/stargazers)
[![CI](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/s-gryt/memory-mason/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-8B5CF6)](https://code.claude.com/docs/en/discover-plugins)

## Install

- Claude Code: `claude plugin marketplace add s-gryt/memory-mason && claude plugin install memory-mason@memory-mason`
- Codex: clone this repo into your Codex plugins directory, open `/plugins`, search for `Memory Mason`, then install it.
- Gemini CLI: `gemini extensions install https://github.com/s-gryt/memory-mason`
- Cursor: `npx skills add s-gryt/memory-mason -a cursor -s '*' -y`
- Windsurf: `npx skills add s-gryt/memory-mason -a windsurf -s '*' -y`
- GitHub Copilot: `npx skills add s-gryt/memory-mason -a github-copilot -s '*' -y`
- Cline: `npx skills add s-gryt/memory-mason -a cline -s '*' -y`
- Any other Agent Skills host: `npx skills add s-gryt/memory-mason`

`npx skills` installs public KB skills only. For continuous capture in GitHub Copilot, keep [.github/hooks](.github/hooks) in the workspace or copy those hook definitions into `~/.copilot/hooks`.

Use `npx skills add s-gryt/memory-mason --all` only if you intentionally want every Memory Mason skill installed into every supported agent.

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
