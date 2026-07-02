# Skills Book

> An agent skill marketplace for browsing, searching, ranking, installing, and uninstalling high-quality skills from multiple sources.

<div align="center">

<img alt="Version" src="https://img.shields.io/badge/version-0.2.0-blue.svg"> <img alt="Node.js" src="https://img.shields.io/badge/node.js-22+-green.svg"> <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg">

**Author**: [ASunYC](https://github.com/ASunYC)

[中文](./README.zh-CN.md) | [Language Home](./README.md)

</div>

---

## Overview

Skills Book aggregates public agent skills from curated `awesome-agent-skills` repositories and turns them into a searchable, installable local skill index.

It helps you:

- Browse skills by normalized category
- Search skills by name, description, category, and keyword
- Rank popular skills by GitHub stars
- Track hot skills with GitHub stars plus repository freshness
- Install skills into an Agent skill directory
- Uninstall installed skills safely
- Discover new skill repositories from GitHub
- Build a local SQLite Skills Wiki for semantic lookup, querying, and graph export
- Export static data for the Skills Book / Skills Shop website

## Demo Links

- Homepage: https://asunyc.github.io/
- Skills Book page: https://asunyc.github.io/skills-book/
- Skills Hot page: https://asunyc.github.io/skills-hot/
- Skills Shop page: https://asunyc.github.io/skills-shop/

## Design Goals

Skills Book is designed to be simple for Agents to call automatically:

- Node.js 22+ runtime
- Direct command-line usage
- Agent slash-command wrapper
- Local persistent cache
- GitHub API token support for higher rate limits
- Proxy fallback for GitHub access when direct connectivity fails

## Agent Command

Skills Book provides one command entry for Claude Code, Codex, and OpenCode. The command is named `/skills-book` to avoid conflicts with built-in `/skills` commands.

```bash
/skills-book fetch --force
/skills-book categories
/skills-book search "testing"
/skills-book top 20
/skills-book hot 50
/skills-book info "stripe/reasoning"
/skills-book install "stripe/reasoning"
/skills-book uninstall "reasoning"
/skills-book agents discover
/skills-book agents top 20
/skills-book agents search "OpenCLI"
/skills-book combos
/skills-book recommend security
/skills-book combos show coding-research-docs-ui
/skills-book build-wiki
/skills-book wiki-query "frontend design"
/skills-book wiki-graph
/skills-book shop-export ../ASunYC.github.io/docs/public/data
```

Equivalent direct CLI usage:

```bash
node scripts/skills.mjs <command> [args]
```

Command definitions are included in:

- `commands/skills-book.md`
- `.claude/commands/skills-book.md`
- `.codex/commands/skills-book.md`
- `.opencode/commands/skills-book.md`

## LLM Wiki Integration

When building the Skills Wiki, Skills Book checks whether `llm-wiki-build-skill` is installed locally. If it is missing, Skills Book installs it into the Agent skill directory and then uses it to initialize, ingest, query, and export the SQLite wiki.

The first `build-wiki` run asks for a `skills.db` storage path. In non-interactive environments, the default path is:

```bash
~/.claude/skills-book/cache/skills.db
```

You can also pass the database path explicitly:

```bash
/skills-book build-wiki --db ./skills.db
/skills-book build-wiki --db ./skills.db --extract
/skills-book wiki-query "frontend design" --db ./skills.db
```

## Recommended Combos

Skills Book includes built-in recommended skill/tool combos for common workflows. Combos do not need to come only from GitHub skill repositories. They are written into `skills.db` during `build-wiki` and exported through `shop-export`.

```bash
# View all recommended combos
/skills-book combos
/skills-book combos coding

# Show install steps, rationale, and workflow for a combo
/skills-book combos show coding-research-docs-ui
```

Current built-in coding combo:

| Combo | Tools | Use Case |
|---|---|---|
| Coding Research Stack | Firecrawl + Context7 + UI UX Pro Max | Search the web for fresh information, fetch current official docs, then polish frontend delivery. |

Install commands for this combo:

```bash
npx -y firecrawl-cli@latest init --all --browser
npx ctx7@latest setup
npm install -g uipro-cli
uipro init --ai codex
```

## Features

### Core Capabilities

- **Multi-source aggregation**: pulls skills from curated public repositories
- **EverythingSkill-compatible coverage**: imports the public EverythingSkill canonical dataset and the persona distillation awesome list, then deduplicates them with broader Skills Book sources
- **GitHub discovery**: searches topics, `SKILL.md` files, and keywords to find new skill repositories
- **Deduplication**: merges duplicate entries by `owner/repo`
- **Category normalization**: unifies similar category names from different sources
- **Stars ranking**: sorts skills by GitHub popularity
- **Hot ranking**: combines GitHub stars with repository freshness metadata for the `Skills Hot` website page
- **One-command install**: clones skills into the Agent skill directory
- **Safe uninstall**: removes installed skills by name
- **Persistent cache**: preserves manually added skills across refreshes
- **Recommended combos**: groups related skills and tools for practical workflows
- **Agent index**: maintains a separate index for AI agent/tool repositories
- **Skills Wiki**: builds a SQLite knowledge base for search, query, and graph export

### Technical Highlights

- Node.js 22+ native runtime
- Modular command implementation
- GitHub API rate-limit awareness
- Optional `GITHUB_TOKEN` support
- Automatic GitHub proxy fallback
- Static export for website integration

## Installation

### Option 1: Ask an Agent to Install It

Copy this prompt into Claude Code, Codex, or another capable coding Agent:

```text
Please install Skills Book:

1. Clone the project and enter the directory:
   git clone https://github.com/ASunYC/skills-book.git
   cd skills-book

2. Install it into the Claude Code skills directory:
   cp -r . ~/.claude/skills/skills-book

3. Verify the installation:
   node ~/.claude/skills/skills-book/scripts/skills-book.mjs help

After installation, tell me how to search and install skills with Skills Book.
```

### Option 2: Manual Installation

Clone the repository:

```bash
git clone https://github.com/ASunYC/skills-book.git
cd skills-book
```

Install it into your skill directory:

```bash
# macOS / Linux
cp -r . ~/.claude/skills/skills-book

# Windows PowerShell
Copy-Item -Recurse . $env:USERPROFILE/.claude/skills/skills-book
```

Verify the installation:

```bash
node ~/.claude/skills/skills-book/scripts/skills-book.mjs help
```

## Usage

### Quick Start

```bash
# First run: fetch the skills index
node scripts/skills-book.mjs fetch --force

# Browse categories
node scripts/skills-book.mjs categories

# Search skills
node scripts/skills-book.mjs search "testing"

# View popular skills
node scripts/skills-book.mjs top 10

# Install a skill
node scripts/skills-book.mjs install "stripe/reasoning"
```

### Search Skills

```bash
node scripts/skills-book.mjs search "ppt"
node scripts/skills-book.mjs search "docker"
node scripts/skills-book.mjs search "spring boot"
```

### Browse Categories

```bash
node scripts/skills-book.mjs categories
node scripts/skills-book.mjs list "Python Skills"
```

### Manage Skills

```bash
node scripts/skills-book.mjs install "op7418/nanobanana-ppt-skills"
node scripts/skills-book.mjs uninstall "nanobanana-ppt-skills"
node scripts/skills-book.mjs info "alchaincyf/huashu-design"
```

### Agent Repository Index

Agent/tool repositories are stored in a separate index, so they do not pollute normal skill search, categories, or TOP rankings.

```bash
node scripts/skills-book.mjs agents discover
node scripts/skills-book.mjs agents top 20
node scripts/skills-book.mjs agents search "OpenCLI"
```

## Commands

### Basic Commands

| Command | Example | Description |
|---|---|---|
| `fetch` | `skills-book.mjs fetch --force` | Fetch and cache the skills index |
| `categories` | `skills-book.mjs categories` | List all categories and skill counts |
| `list` | `skills-book.mjs list "Python"` | Show skills in a category |
| `search` | `skills-book.mjs search "testing"` | Search skills by keyword |
| `top` | `skills-book.mjs top 10` | Rank skills by GitHub stars |
| `hot` | `skills-book.mjs hot 50` | Rank hot skills by stars plus repo freshness |
| `info` | `skills-book.mjs info "owner/name"` | Show skill details |
| `install` | `skills-book.mjs install "owner/name"` | Install a skill |
| `uninstall` | `skills-book.mjs uninstall "name"` | Uninstall a skill |

### Management Commands

| Command | Example | Description |
|---|---|---|
| `add` | `skills-book.mjs add owner name desc url` | Manually add a skill |
| `remove` | `skills-book.mjs remove "owner/name"` | Remove a manually added skill |
| `discover` | `skills-book.mjs discover` | Search GitHub for new skills |
| `update` | `skills-book.mjs update` | Refresh all skills and cache |

### Wiki and Export Commands

| Command | Example | Description |
|---|---|---|
| `build-wiki` | `skills-book.mjs build-wiki --db ./skills.db` | Build the SQLite Skills Wiki |
| `wiki-query` | `skills-book.mjs wiki-query "frontend design"` | Query the Skills Wiki |
| `wiki-graph` | `skills-book.mjs wiki-graph --out graph.json` | Export wiki graph JSON |
| `shop-export` | `skills-book.mjs shop-export ../site/data` | Export Skills Shop, Skills Hot, graph, and combo website data |

## Project Structure

```text
skills-book/
├── README.md                      # Language selector
├── README.en-US.md                # English documentation
├── README.zh-CN.md                # Chinese documentation
├── SKILL.md                       # Agent skill definition
├── commands/                      # Slash command definitions
├── scripts/
│   ├── skills-book.mjs            # Main CLI
│   ├── skills.mjs                 # Agent command wrapper
│   ├── combo-skills.mjs           # Recommended combo data
│   └── wiki-commands.mjs          # Skills Wiki integration
└── data/                          # Static data sources
```

Runtime cache is generated under:

```text
~/.claude/skills-book/cache/
├── skills-index.json
├── stars-cache.json
├── manual-skills.json
└── skills.db
```

## Configuration

### GitHub Token

Set `GITHUB_TOKEN` to increase GitHub API rate limits:

```bash
# macOS / Linux
export GITHUB_TOKEN="your-github-token"

# Windows PowerShell
$env:GITHUB_TOKEN="your-github-token"
```

| Configuration | Rate Limit |
|---|---|
| No token | 60 requests/hour |
| With token | 5,000 requests/hour |

### Cache

| Cache | TTL | Notes |
|---|---|---|
| Skills index | 1 hour | Refreshes automatically when expired |
| Stars cache | 24 hours | Updates only stale data |
| Manual skills | Permanent | Preserved across `fetch` |

## FAQ

### Why can I not find a specific skill?

Skills Book starts from curated public sources. If a skill is not indexed yet, run GitHub discovery:

```bash
node scripts/skills-book.mjs discover
```

### What should I check if installation fails?

Check that:

- GitHub is reachable from your network
- `git` is installed
- The target repository still exists
- Your Agent skill directory is writable

### Will manually added skills be overwritten?

No. Manually added skills are stored separately in `manual-skills.json` and are preserved across `fetch` and `update`.

### Can I use it outside Claude Code?

Yes. Skills Book is a standard Node.js CLI and can run in any Node.js 22+ environment. Claude Code, Codex, and OpenCode can use the bundled command wrappers.

## Changelog

### v0.2.0

- Added Agent command wrappers for Claude Code, Codex, and OpenCode
- Added Skills Wiki integration through `llm-wiki-build-skill`
- Added recommended skill/tool combos
- Added separate AI agent/tool repository index
- Added static data export for Skills Book / Skills Shop pages

### v0.1.0

- Initial release
- Added multi-source skill aggregation
- Added GitHub discovery
- Added stars ranking
- Added one-command install and uninstall
- Added persistent manual skills
- Added GitHub proxy fallback

## Contributing

Contributions are welcome.

You can help by:

- Adding new data sources
- Improving category normalization
- Reporting broken repositories
- Improving command wrappers
- Adding useful recommended combos
- Improving documentation

Please open an issue or pull request on GitHub:

https://github.com/ASunYC/skills-book/issues

## License

MIT License

Copyright (c) 2026 ASunYC

See [LICENSE](./LICENSE) for details.

## Acknowledgements

- **VoltAgent Team** for maintaining a curated `awesome-agent-skills` repository
- **heilcheng** for maintaining a Chinese community `awesome-agent-skills` repository
- **gh-proxy** for GitHub proxy support
- **Open-source community** for tools, ideas, and public skills

---

<div align="center">

**If Skills Book helps you, a GitHub Star is appreciated.**

Made by ASunYC | Powered by Node.js and GitHub API

</div>
