# Skills Book

> 让 Claude Code 像翻"功法大全"一样的技能宝典，1500+ 技能一键搜索、安装、卸载

<div align="center">

<img alt="Version" src="https://img.shields.io/badge/version-0.1.0-blue.svg"> <img alt="Node.js" src="https://img.shields.io/badge/node.js-22+-green.svg"> <img alt="Zero Dependencies" src="https://img.shields.io/badge/dependencies-zero-orange.svg"> <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green.svg">

**创作者**: [ASunYC](https://github.com/ASunYC)

[效果演示](#-效果演示) • [项目简介](#-项目简介) • [功能特性](#-功能特性) • [一键安装](#-一键安装) • [使用指南](#-使用指南) • [命令行](#-命令行) • [常见问题](#-常见问题) • [更新日志](#-更新日志)

</div>

---

## 🎬 效果演示

<div align="center">

<!-- 在这里放置效果演示视频 -->
<!-- 替换为你自己的视频链接 -->

*Skills Book 效果演示 - 从搜索到安装一键完成*

</div>

---

## 📖 项目简介

Skills Book 是一个聚合多源 awesome-agent-skills 仓库的技能管理工具，能够：

- 🔍 **实时搜索 GitHub**，按 topic、文件名、关键词挖掘未被收录的新技能
- 📦 **多源自动聚合**，覆盖 VoltAgent 和 heilcheng 两大精选仓库
- 🔄 **智能去重分类**，同一技能只保留一条，自动合并分类
- ⭐ **Stars 排行榜**，按 GitHub 热度排序展示
- 🚀 **一键安装卸载**，让 Agent 自动完成技能安装与删除

### 🎯 设计理念

**零依赖命令行**
- 纯 Node.js 22+ 原生 fetch API，无需 npm install
- 一键执行，无需复杂配置
- 适合 Claude Code Agent 自动调用

**智能代理支持**
- 自动检测 GitHub 连通性
- 国内网络自动切换至 gh-proxy 代理
- 不通就走代理，通的走直连

---

## ✨ 功能特性

### 🎯 核心能力

- 📦 **多源聚合** - 同时拉取 VoltAgent + heilcheng 两大仓库
- 🔍 **实时挖掘** - 按 topic、SKILL.md 文件名、关键词搜索 GitHub
- 🔄 **智能去重** - 按 owner/repo 去重，合并重复条目
- 📂 **分类归一** - 自动合并不同来源的分类名称
- ⭐ **Stars 排行** - 按 GitHub 热度排序，实时更新
- 🚀 **一键安装** - 自动克隆技能到 Claude Code 目录
- 🗑️ **一键卸载** - 安全移除已安装的技能
- 💾 **持久缓存** - 手动添加的技能永久保留，不被刷新覆盖

### 🛠️ 技术亮点

- ✅ 零外部依赖，仅需 Node.js 22+（原生 fetch API）
- ✅ 自动代理 fallback（gh-proxy.org）
- ✅ GitHub API 速率限制保护（未认证 60 次/小时，认证后 5000 次/小时）
- ✅ 模块化设计，易于扩展新数据源

---

## 🚀 一键安装

### 方法一：Claude Code 自动安装（推荐）

**只需复制以下提示词，发送给 Claude Code，它会自动完成全部安装！**

```
请帮我安装 Skills Book：

1. 克隆项目并进入目录：
   git clone https://github.com/ASunYC/skills-book.git
   cd skills-book

2. 安装到 Claude Code 技能目录：
   cp -r . ~/.claude/skills/skills-book

3. 验证安装：
   node ~/.claude/skills/skills-book/scripts/skills-book.mjs help

完成后，告诉我如何使用 Skills Book 搜索和安装技能。
```

**使用说明**：
1. 确保已安装 Node.js 22+
2. 确保已安装 Claude Code
3. 复制上面的提示词发送给 Claude Code
4. Claude Code 会自动执行所有安装步骤

### 方法二：手动安装

#### 1. 克隆项目

```bash
git clone https://github.com/ASunYC/skills-book.git
cd skills-book
```

#### 2. 安装到技能目录

```bash
# macOS / Linux
cp -r . ~/.claude/skills/skills-book

# Windows (PowerShell)
cp -Recurse . $env:USERPROFILE/.claude/skills/skills-book
```

#### 3. 验证安装

```bash
node ~/.claude/skills/skills-book/scripts/skills-book.mjs help
```

应该显示帮助信息，表示安装成功。

---

## 💡 使用指南

### 快速开始

```bash
# 首次使用：拉取技能索引
node scripts/skills-book.mjs fetch --force

# 浏览分类
node scripts/skills-book.mjs categories

# 搜索技能
node scripts/skills-book.mjs search "testing"

# 查看热门排行
node scripts/skills-book.mjs top 10

# 安装一个技能
node scripts/skills-book.mjs install "stripe/reasoning"
```

### 搜索技能

```bash
# 按关键词搜索
node scripts/skills-book.mjs search "ppt"
node scripts/skills-book.mjs search "docker"
node scripts/skills-book.mjs search "spring boot"
```

### 查看分类

```bash
# 列出所有分类
node scripts/skills-book.mjs categories

# 查看指定分类下的技能
node scripts/skills-book.mjs list "Python Skills"
```

### 技能管理

```bash
# 安装技能
node scripts/skills-book.mjs install "op7418/nanobanana-ppt-skills"

# 卸载技能
node scripts/skills-book.mjs uninstall "nanobanana-ppt-skills"

# 查看技能详情
node scripts/skills-book.mjs info "alchaincyf/huashu-design"
```

---

## ⌨️ 命令行

### 基础命令

| 命令 | 示例 | 说明 |
|------|------|------|
| `fetch` | `skills-book.mjs fetch --force` | 从源仓库拉取并缓存技能索引 |
| `categories` | `skills-book.mjs categories` | 列出所有分类及技能数量 |
| `list` | `skills-book.mjs list "Python"` | 查看指定分类下的技能 |
| `search` | `skills-book.mjs search "testing"` | 按关键词搜索技能 |
| `top` | `skills-book.mjs top 10` | 按 GitHub Stars 排行 |
| `info` | `skills-book.mjs info "owner/name"` | 查看单个技能详情 |
| `install` | `skills-book.mjs install "owner/name"` | 安装技能到 Claude Code |
| `uninstall` | `skills-book.mjs uninstall "name"` | 从 Claude Code 卸载技能 |

### 管理命令

| 命令 | 示例 | 说明 |
|------|------|------|
| `add` | `skills-book.mjs add owner name desc url` | 手动添加技能（持久化） |
| `remove` | `skills-book.mjs remove "owner/name"` | 移除手动添加的技能 |
| `update` | `skills-book.mjs update` | 全量刷新 + 实时挖掘 |

### / 命令

在 Claude Code 中直接输入：

- `/skills-fetch` — 一步完成全量刷新（源仓库拉取 + GitHub 实时挖掘）

---

## 📚 项目结构

```
skills-book/
├── README.md                      # 本文件
├── SKILL.md                       # Claude Code 技能定义文件
├── scripts/
│   └── skills-book.mjs            # 零依赖 CLI 脚本
└── .gitignore                     # Git 忽略规则

运行时缓存（自动生成）：
~/.claude/skills-book/
└── cache/
    ├── skills-index.json          # 技能索引缓存
    ├── stars-cache.json           # Stars 数量缓存
    └── manual-skills.json         # 手动添加的技能（持久化）
```

---

## 🔧 配置选项

### 代理配置

脚本会自动检测 GitHub 连通性：

1. **首次请求**：调用 `api.github.com/rate_limit` 测试连通性（5 秒超时）
2. **连通**：所有请求直连
3. **不通**：自动切换至 `https://gh-proxy.org` 代理
4. **非 GitHub 请求**：始终直连

### API 密钥（可选）

设置 `GITHUB_TOKEN` 环境变量可提高 API 速率限制：

```bash
# macOS / Linux
export GITHUB_TOKEN="your-github-token"

# Windows (PowerShell)
$env:GITHUB_TOKEN="your-github-token"
```

| 配置 | 速率限制 |
|------|----------|
| 无 Token | 60 次/小时 |
| 有 Token | 5,000 次/小时 |

### 缓存配置

| 缓存项 | TTL | 说明 |
|--------|-----|------|
| 技能索引 | 1 小时 | 超过 1 小时自动刷新 |
| Stars 数量 | 24 小时 | 仅更新过期数据 |
| 手动添加技能 | 永久 | 不被 fetch 覆盖 |

---

## ❓ 常见问题

### Q: 为什么搜索不到某些技能？

**A**: Skills Book 收录了两个主要仓库的技能。如果某个技能不在收录范围内，可以：

```bash
# 从 GitHub 实时挖掘新技能
node scripts/skills-book.mjs discover
```

### Q: 安装技能失败怎么办？

**A**: 检查以下几点：
1. 网络连接是否正常（GitHub 是否可访问）
2. 是否有 git 命令行工具
3. 目标仓库是否仍然存在

### Q: 手动添加的技能会被刷新覆盖吗？

**A**: 不会。手动添加的技能存储在 `manual-skills.json` 中，与源仓库索引独立，不会被 `fetch` 覆盖。

### Q: 如何添加自定义技能？

**A**: 使用 `add` 命令：

```bash
node scripts/skills-book.mjs add alchaincyf huashu-design "HTML设计技能" https://github.com/alchaincyf/huashu-design "Community Skills"
```

### Q: 可以在其他 AI 工具中使用吗？

**A**: 可以。Skills Book 是标准 Node.js 脚本，可以在任何支持 Node.js 22+ 的环境中使用。

---

## 📝 更新日志

### v0.1.0 (2026-05-07)

- ✨ 首次发布
- 📦 支持 VoltAgent + heilcheng 双源聚合
- 🔍 支持 GitHub 实时挖掘（topic、文件名、关键词）
- ⭐ 支持 Stars 排行榜
- 🚀 支持一键安装/卸载
- 💾 支持手动添加技能（持久化）
- 🌐 支持自动代理 fallback
- ⌨️ 支持 Claude Code / 命令

---

## 🤝 贡献指南

欢迎贡献！你可以：

### 添加新数据源

1. Fork 本项目
2. 在 `scripts/skills-book.mjs` 中添加新源解析逻辑
3. 测试生成效果
4. 提交 Pull Request

### 报告问题

在 [GitHub Issues](https://github.com/ASunYC/skills-book/issues) 提交问题，请包含：
- 错误信息
- 操作步骤
- 系统环境

---

## 📄 许可证

MIT License

Copyright (c) 2026 ASunYC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 🙏 致谢

- **VoltAgent Team** - 维护 awesome-agent-skills 精选仓库
- **heilcheng** - 维护中文社区 awesome-agent-skills 仓库
- **gh-proxy** - 提供 GitHub 代理服务
- **开源社区** - 提供的各种工具和灵感

---

## 📞 联系方式

- **创作者**: ASunYC
- **GitHub**: [ASunYC](https://github.com/ASunYC)
- **Issues**: [GitHub Issues](https://github.com/ASunYC/skills-book/issues)

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给一个 Star！**

Made with ❤️ by ASunYC | Powered by Node.js & GitHub API

</div>
