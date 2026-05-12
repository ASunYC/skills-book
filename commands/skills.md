---
description: Search, install, update, and build a SQLite wiki for public agent skills.
---

# Skills Command

Use this command when the user types `/skills ...`, `skills ...`, or asks to operate Skills Book from an agent session.

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
/skills fetch --force
/skills categories
/skills search "testing"
/skills top 20
/skills info "stripe/reasoning"
/skills install "stripe/reasoning"
/skills build-wiki
/skills wiki-query "frontend design"
/skills wiki-graph
/skills shop-export ../ASunYC.github.io/docs/public/data
```
