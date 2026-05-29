---
description: Search, install, update, and build a SQLite wiki for public agent skills.
agent: build
---

# /skills-book

Use this command to operate Skills Book from OpenCode.

Run from the user's current project directory:

```bash
node ~/.opencode/skills/skills-book/scripts/skills.mjs $ARGUMENTS
```

If the skill is installed in another shared agent directory, locate `scripts/skills.mjs` and run it with the same arguments.

Examples:

```bash
/skills-book fetch --force
/skills-book search "testing"
/skills-book top 10
/skills-book hot 50
/skills-book build-wiki
/skills-book wiki-query "frontend design"
```
