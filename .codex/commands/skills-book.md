---
description: Search, install, update, and build a SQLite wiki for public agent skills.
---

# /skills-book

Use this command to operate Skills Book from Codex.

Run from the user's current project directory:

```bash
node ~/.codex/skills/skills-book/scripts/skills.mjs $ARGUMENTS
```

If the skill is installed under another agent directory, use that path instead:

```bash
node ~/.claude/skills/skills-book/scripts/skills.mjs $ARGUMENTS
node ~/.opencode/skills/skills-book/scripts/skills.mjs $ARGUMENTS
```

Supported commands include `fetch`, `categories`, `list`, `search`, `top`, `hot`, `info`, `install`, `uninstall`, `discover`, `build-wiki`, `wiki-query`, `wiki-graph`, and `shop-export`.
