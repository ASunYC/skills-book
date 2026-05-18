---
description: Search, install, update, and build a SQLite wiki for public agent skills.
---

# Skills Book Command

Use this command when the user types `/skills-book ...`, `skills-book ...`, or asks to operate Skills Book from an agent session.

This command intentionally uses `/skills-book` instead of `/skills` to avoid conflicts with built-in agent CLI commands.

## Execution

Resolve the skill root in this order:

1. The current repository if it contains `scripts/skills.mjs`.
2. `~/.codex/skills/skills-book`
3. `~/.claude/skills/skills-book`
4. `~/.opencode/skills/skills-book`

Then run:

```bash
node <skill-root>/scripts/skills.mjs $ARGUMENTS
```

## Common Usage

```bash
/skills-book fetch --force
/skills-book categories
/skills-book search "testing"
/skills-book top 20
/skills-book info "stripe/reasoning"
/skills-book install "stripe/reasoning"
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
