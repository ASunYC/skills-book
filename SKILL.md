---
name: skills-book
description: Aggregate, browse, search, and install agent skills from awesome-agent-skills repositories. Lists categories, searches by keyword, ranks by GitHub stars, and installs/uninstalls skills automatically.
origin: local
---

# Skills Book — Agent Skill Marketplace

Browse, search, and install Claude Code skills from the community-maintained awesome-agent-skills repositories.

## Trigger

Use this skill when the user wants to:
- Browse available agent skills by category
- Search for a specific skill by name or description
- Find the most popular skills by GitHub stars
- Install or uninstall a skill
- Update the skills index

## How It Works

This skill aggregates skills from two sources:
- **VoltAgent/awesome-agent-skills** (~935 skills) — curated, quality-gated
- **heilcheng/awesome-agent-skills** (~240 skills) — Chinese community + global

Skills are deduplicated by `owner/name`, categorized, and cached locally.

## Available Commands

All commands are run via:
```
node <this_dir>/scripts/skills-book.mjs <command> [args]
```

### 1. Fetch & Cache

Download skills from GitHub and build the local index:
```
node <this_dir>/scripts/skills-book.mjs fetch
node <this_dir>/scripts/skills-book.mjs fetch --force   # Force refresh
```

Cache is auto-refreshed if older than 1 hour.

### 2. List Categories

Show all categories with skill counts:
```
node <this_dir>/scripts/skills-book.mjs categories
```

### 3. List Skills by Category

Show all skills in a specific category:
```
node <this_dir>/scripts/skills-book.mjs list "Python Skills"
node <this_dir>/scripts/skills-book.mjs list "Official"
```

### 4. Search

Search across skill names, descriptions, and categories:
```
node <this_dir>/scripts/skills-book.mjs search "testing"
node <this_dir>/scripts/skills-book.mjs search "docker"
node <this_dir>/scripts/skills-book.mjs search "spring boot"
```

### 5. Top Skills by Stars

Show the most popular skills ranked by GitHub stars:
```
node <this_dir>/scripts/skills-book.mjs top        # Top 20
node <this_dir>/scripts/skills-book.mjs top 50     # Top 50
```

### 6. Skill Details

Get detailed info for a specific skill:
```
node <this_dir>/scripts/skills-book.mjs info "stripe/reasoning"
node <this_dir>/scripts/skills-book.mjs info "context-compression"
```

### 7. Install a Skill

Automatically clone a skill to `~/.claude/skills/`:
```
node <this_dir>/scripts/skills-book.mjs install "stripe/reasoning"
node <this_dir>/scripts/skills-book.mjs install "microsoft/devskim"
```

The script finds the skill in the index, clones its GitHub repo, and copies the SKILL.md to the skills directory.

### 8. Uninstall a Skill

Remove a skill from `~/.claude/skills/`:
```
node <this_dir>/scripts/skills-book.mjs uninstall "reasoning"
```

### 9. Update Index

Force re-fetch all skills from GitHub:
```
node <this_dir>/scripts/skills-book.mjs update
```

## Quick Start Workflow

```bash
# First time: fetch all skills
node <this_dir>/scripts/skills-book.mjs fetch --force

# Browse what's available
node <this_dir>/scripts/skills-book.mjs categories

# Search for something specific
node <this_dir>/scripts/skills-book.mjs search "testing"

# See what's popular
node <this_dir>/scripts/skills-book.mjs top 10

# Install a skill you like
node <this_dir>/scripts/skills-book.mjs install "stripe/reasoning"
```

## Notes

- **Star counts** are fetched via GitHub API and cached for 24 hours. Set `GITHUB_TOKEN` env var for higher API rate limits (5000/hr vs 60/hr).
- **Install** requires `git` to be available on the system.
- Skills are cached in `~/.claude/skills-book/cache/`.
- Installed skills go to `~/.claude/skills/`.
