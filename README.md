# Skills Book

<div align="center">

<img alt="Version" src="https://img.shields.io/badge/version-0.2.0-blue.svg"> <img alt="Node.js" src="https://img.shields.io/badge/node.js-22+-green.svg"> <img alt="License" src="https://img.shields.io/badge/license-MIT-green.svg">

**Language / 语言**

[English](./README.en-US.md) | [中文](./README.zh-CN.md)

</div>

---

## English

Skills Book is an agent skill marketplace for aggregating high-quality skills from multiple sources. It organizes skills by category, supports browsing, search, GitHub stars ranking, and lets an Agent install or uninstall skills automatically.

- Browse skill categories
- Search skills by name, description, or category
- View TOP rankings by GitHub stars
- View hot rankings by stars and repository freshness
- Install and uninstall skills with Agent commands
- Build a local SQLite Skills Wiki for semantic lookup and graph export

Read the full English documentation: [README.en-US.md](./README.en-US.md)

## 中文

Skills Book 是一个面向 Agent 的技能宝典，用来聚合多个平台的高质量技能，按分类整理，支持浏览、搜索、TOP 排行，并可让 Agent 自动安装或卸载技能。

- 浏览技能分类
- 按名称、描述或分类搜索技能
- 按 GitHub Stars 查看热门排行
- 通过 Agent 命令安装和卸载技能
- 构建本地 SQLite Skills Wiki，支持语义查询和图谱导出

查看完整中文文档：[README.zh-CN.md](./README.zh-CN.md)

---

## Quick Start

```bash
git clone https://github.com/ASunYC/skills-book.git
cd skills-book
node scripts/skills-book.mjs help
```

Agent command examples:

```bash
/skills-book fetch --force
/skills-book categories
/skills-book search "testing"
/skills-book top 20
/skills-book hot 50
/skills-book install "stripe/reasoning"
```

## Links

- Homepage: https://asunyc.github.io/
- Skills Book: https://asunyc.github.io/skills-book/
- Skills Hot: https://asunyc.github.io/skills-hot/
- Skills Shop: https://asunyc.github.io/skills-shop/
- Issues: https://github.com/ASunYC/skills-book/issues
