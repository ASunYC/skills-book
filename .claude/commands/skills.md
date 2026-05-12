---
description: Search, install, update, and build a SQLite wiki for public agent skills.
argument-hint: "<command> [args]"
---

# /skills

Run the Skills Book command wrapper from the current project directory.

Use `$ARGUMENTS` as the command arguments. Prefer:

```bash
node ~/.claude/skills/skills-book/scripts/skills.mjs $ARGUMENTS
```

If the skill is installed somewhere else, locate the repository that contains `scripts/skills.mjs` and run that file instead.

Examples:

```bash
/skills fetch --force
/skills search "testing"
/skills top 20
/skills install "stripe/reasoning"
/skills build-wiki
/skills wiki-query "frontend design"
```
