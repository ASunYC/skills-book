# Skills Book — Agent Skill Marketplace

一个让智能体像翻"功法大全"一样的技能宝典。

从多个社区维护的 awesome-agent-skills 仓库中，自动搜刮、去重、分类、排行，
并通过简单命令查看、安装、卸载技能。

## 核心特性

- **多源聚合**：覆盖以下两个主要 awesome-agent-skills 仓库
  - `VoltAgent/awesome-agent-skills`（500+ 精选技能，质量把关严格）
  - `heilcheng/awesome-agent-skills`（中文社区维护，含教程、工具合集）
- **自动去重**：同一技能（以 owner/repo 为准）只保留一条
- **分类归一化**：不同来源的分类名称自动映射合并
- **自动更新**：支持手动或定时刷新技能索引
- **TOP 排行**：按 GitHub Stars 排序展示
- **安装 / 卸载**：让 Agent 自动完成技能安装与删除

## 安装

将本目录复制到 `~/.claude/skills/skills-book/` 即可：

```bash
# Windows (PowerShell)
cp -Recurse skills-book $env:USERPROFILE/.claude/skills/skills-book

# macOS / Linux
cp -r skills-book ~/.claude/skills/skills-book
```

安装后，在 Claude Code 中即可使用 `/skills-book` 命令调用此技能。

## 可用命令

| 命令 | 示例 | 说明 |
|------|------|------|
| `fetch` | `skills-book.mjs fetch --force` | 下载并缓存技能索引 |
| `categories` | `skills-book.mjs categories` | 列出所有分类及技能数量 |
| `list` | `skills-book.mjs list "Python"` | 查看指定分类下的技能 |
| `search` | `skills-book.mjs search "testing"` | 按关键词搜索技能 |
| `top` | `skills-book.mjs top 10` | 按 GitHub Stars 排行 |
| `info` | `skills-book.mjs info "stripe/reasoning"` | 查看单个技能详情 |
| `install` | `skills-book.mjs install "stripe/reasoning"` | 安装技能到 Claude Code |
| `uninstall` | `skills-book.mjs uninstall "reasoning"` | 从 Claude Code 卸载技能 |
| `update` | `skills-book.mjs update` | 强制刷新全部数据 |

## 快速开始

```bash
# 首次使用：拉取技能索引
node scripts/skills-book.mjs fetch --force

# 浏览分类
node scripts/skills-book.mjs categories

# 搜索技能
node scripts/skills-book.mjs search "testing"

# 查看热门排行
node scripts/skills-book.mjs top 10

# 安装一个喜欢的技能
node scripts/skills-book.mjs install "stripe/reasoning"
```

## 技术说明

- 零外部依赖，仅需 Node.js 22+（原生 fetch API）
- 技能索引缓存于 `~/.claude/skills-book/cache/`
- 安装的技能存放于 `~/.claude/skills/`
- GitHub API 速率限制：未认证 60 次/小时，设置 `GITHUB_TOKEN` 后提升至 5000 次/小时

## 项目结构

```
skills-book/
├── SKILL.md                # Claude Code 技能定义文件
├── README.md               # 项目说明
└── scripts/
    └── skills-book.mjs     # 零依赖 CLI 脚本
```
