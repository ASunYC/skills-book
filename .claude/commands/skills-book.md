---
description: Search, install, update, and build a SQLite wiki for public agent skills.
argument-hint: "<command> [args]"
---

# /skills-book

Run the Skills Book command wrapper from the current project directory.

Use `$ARGUMENTS` as the command arguments. Prefer:

```bash
node ~/.claude/skills/skills-book/scripts/skills.mjs $ARGUMENTS
```

If the skill is installed somewhere else, locate the repository that contains `scripts/skills.mjs` and run that file instead.

Examples:

```bash
/skills-book fetch --force
/skills-book search "testing"
/skills-book top 20
/skills-book hot 50
/skills-book install "stripe/reasoning"
/skills-book build-wiki
/skills-book wiki-query "frontend design"
```
