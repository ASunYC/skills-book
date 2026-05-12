---
description: Search, install, update, and build a SQLite wiki for public agent skills.
agent: build
---

# /skills

Use this command to operate Skills Book from OpenCode.

Run from the user's current project directory:

```bash
node ~/.opencode/skills/skills-book/scripts/skills.mjs $ARGUMENTS
```

If the skill is installed in another shared agent directory, locate `scripts/skills.mjs` and run it with the same arguments.

Examples:

```bash
/skills fetch --force
/skills search "testing"
/skills top 10
/skills build-wiki
/skills wiki-query "frontend design"
```
