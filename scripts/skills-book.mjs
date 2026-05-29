#!/usr/bin/env node
// Skills Book CLI — Aggregate, browse, search, install/uninstall agent skills
// Zero external dependencies. Requires Node.js 22+ (for native fetch).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync, copyFileSync } from "fs";
import { join, dirname, basename } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { cmdCombos, printComboHighlights } from "./combo-skills.mjs";
import { DISCOVERY_VERIFICATION, filterDiscoveredSkills, repoHasMetadataSkillSignal } from "./discovery-filter.mjs";
import { cmdBuildWiki, cmdShopExport, cmdWikiGraph, cmdWikiQuery } from "./wiki-commands.mjs";

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_DIR = join(homedir(), ".claude", "skills-book", "cache");
const CACHE_FILE = join(CACHE_DIR, "skills-index.json");
const MANUAL_SKILLS_FILE = join(CACHE_DIR, "manual-skills.json");
const AGENTS_CACHE_FILE = join(CACHE_DIR, "agents-index.json");
const SKILLS_INSTALL_DIR = join(homedir(), ".claude", "skills");
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const STARS_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONCURRENT_API = 30; // GitHub API rate limit safety

const SOURCES = {
  voltagent: {
    key: "voltagent",
    repo: "VoltAgent/awesome-agent-skills",
    raw_url: "https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/README.md",
  },
  heilcheng: {
    key: "heilcheng",
    repo: "heilcheng/awesome-agent-skills",
    raw_url: "https://raw.githubusercontent.com/heilcheng/awesome-agent-skills/main/README.md",
  },
  everythingskill: {
    key: "everythingskill",
    repo: "iwanderleo/everythingskill.net",
    raw_url: "https://raw.githubusercontent.com/iwanderleo/everythingskill.net/main/app/data/skills.json",
  },
  personaDistill: {
    key: "persona-distill",
    repo: "xixu-me/awesome-persona-distill-skills",
    raw_url: "https://raw.githubusercontent.com/xixu-me/awesome-persona-distill-skills/main/README.md",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(...args) {
  process.stdout.write(args.join(" ") + "\n");
}

function logErr(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function readCache() {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(data) {
  ensureCacheDir();
  writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function readManualSkills(options = {}) {
  if (!existsSync(MANUAL_SKILLS_FILE)) return {};
  try {
    const skills = JSON.parse(readFileSync(MANUAL_SKILLS_FILE, "utf8"));
    if (options.includeUnverifiedDiscoveries) return skills;
    return filterDiscoveredSkills(skills);
  } catch {
    return {};
  }
}

function writeManualSkills(skills) {
  ensureCacheDir();
  writeFileSync(MANUAL_SKILLS_FILE, JSON.stringify(skills, null, 2), "utf8");
}

function readAgentsCache() {
  if (!existsSync(AGENTS_CACHE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(AGENTS_CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeAgentsCache(data) {
  ensureCacheDir();
  writeFileSync(AGENTS_CACHE_FILE, JSON.stringify(data, null, 2), "utf8");
}

const GH_PROXY = "https://gh-proxy.org";
const GH_API_TEST = "https://api.github.com/rate_limit";

// Session-level: detect once whether direct GitHub access works
let _ghAccessible = null;

async function isGitHubAccessible() {
  if (_ghAccessible !== null) return _ghAccessible;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(GH_API_TEST, { signal: controller.signal });
    clearTimeout(timer);
    _ghAccessible = res.ok;
  } catch {
    _ghAccessible = false;
  }
  return _ghAccessible;
}

// If direct access fails, wrap URL with proxy
function maybeProxyUrl(url) {
  if (url.startsWith("https://api.github.com/") || url.startsWith("https://raw.githubusercontent.com/")) {
    return `${GH_PROXY}/${url}`;
  }
  return url;
}

async function fetchWithRetry(url, retries = 3) {
  const directOk = await isGitHubAccessible();
  const isGitHubUrl = url.startsWith("https://api.github.com/") || url.startsWith("https://raw.githubusercontent.com/");

  // If GitHub is accessible, go direct
  if (directOk || !isGitHubUrl) {
    for (let i = 0; i < retries; i++) {
      try {
        const headers = {};
        const token = process.env.GITHUB_TOKEN;
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(url, { headers });
        if (res.status === 403) {
          const remaining = res.headers.get("x-ratelimit-remaining");
          if (remaining === "0") throw new Error("rate_limited");
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (e) {
        if (e.message === "rate_limited") throw e;
        if (i === retries - 1) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      }
    }
  }

  // Direct failed, try proxy
  const proxiedUrl = maybeProxyUrl(url);
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(proxiedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

function extractRepoFromUrl(url) {
  // Match github.com/owner/repo patterns
  const m = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!m) return null;
  // Strip trailing paths like /tree/main/...
  return m[1].split("/").slice(0, 2).join("/");
}

function extractOwnerNameFromUrl(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

function repoKeyFromRepo(repo) {
  const parts = String(repo || "").split("/");
  if (parts.length < 2) return null;
  return `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
}

function skillKey(skill) {
  return repoKeyFromRepo(skill.github_repo) || `${String(skill.owner || "unknown").toLowerCase()}/${String(skill.name || skill.display_name || "unknown").toLowerCase()}`;
}

function mergeSkill(allSkills, skill) {
  const key = skillKey(skill);
  const existing = allSkills[key];
  if (!existing) {
    allSkills[key] = skill;
    return true;
  }
  existing.sources = [...new Set([...(existing.sources || [existing.source].filter(Boolean)), skill.source].filter(Boolean))];
  if ((!existing.description || existing.description.length < 16) && skill.description) existing.description = skill.description;
  if ((!existing.category || existing.category === "Unknown") && skill.category) existing.category = skill.category;
  if (!existing.github_repo && skill.github_repo) existing.github_repo = skill.github_repo;
  if (!existing.url && skill.url) existing.url = skill.url;
  if (!existing.added_at && skill.added_at) existing.added_at = skill.added_at;
  if (!existing.updated_at && skill.updated_at) existing.updated_at = skill.updated_at;
  if (!existing.readme_locales && skill.readme_locales) existing.readme_locales = skill.readme_locales;
  return false;
}

function findSkillMd(dir) {
  // First check root
  if (existsSync(join(dir, "SKILL.md"))) return join(dir, "SKILL.md");

  // Search subdirectories (depth 2)
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        const nested = join(fullPath, "SKILL.md");
        if (existsSync(nested)) return nested;
        // Go one level deeper
        try {
          const subEntries = readdirSync(fullPath);
          for (const sub of subEntries) {
            if (sub.startsWith(".")) continue;
            const subPath = join(fullPath, sub);
            if (statSync(subPath).isDirectory()) {
              const deep = join(subPath, "SKILL.md");
              if (existsSync(deep)) return deep;
            }
          }
        } catch {}
      }
    }
  } catch {}
  return null;
}

function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (entry === ".git") continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// ─── Parsing: VoltAgent README ───────────────────────────────────────────────

function parseVoltagentReadme(markdown) {
  const skills = [];
  const lines = markdown.split("\n");

  let currentCategory = "Unknown";
  let inDetails = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // H3 headings (category)
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match && !line.includes("Table of Contents")) {
      let cat = h3Match[1].trim();
      // Handle <details> category headers
      const detailsMatch = cat.match(/<[^>]*><\/?h3[^>]*>(.*?)<\/h3>/i);
      if (detailsMatch) cat = detailsMatch[1].trim();
      // Strip <summary> tags
      cat = cat.replace(/<\/?summary>/gi, "").replace(/<\/?details>/gi, "").trim();
      // Strip HTML tags
      cat = cat.replace(/<[^>]+>/g, "").trim();
      if (cat) currentCategory = cat;
      continue;
    }

    // <details> blocks with category in summary
    const detailsOpen = line.match(/<details[^>]*>/i);
    if (detailsOpen) {
      inDetails = true;
      // Check for category in same line or next few lines
      const h3InDetails = line.match(/<h3[^>]*>(.*?)<\/h3>/i);
      if (h3InDetails) {
        currentCategory = h3InDetails[1].replace(/<[^>]+>/g, "").trim();
      }
      continue;
    }

    const detailsClose = line.match(/<\/details>/i);
    if (detailsClose) {
      inDetails = false;
      continue;
    }

    // Skill entry: - **[owner/name](url)** - description
    const bulletMatch = line.match(/^-\s+\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*[-–—]\s*(.+)$/);
    if (bulletMatch) {
      const [, displayName, url, description] = bulletMatch;
      // displayName is "owner/name" or "owner/Name-With-Dashes"
      const parts = displayName.split("/");
      if (parts.length >= 2) {
        const owner = parts[0].toLowerCase();
        const name = parts.slice(1).join("/").toLowerCase();
        const githubRepo = extractRepoFromUrl(url);

        skills.push({
          owner,
          name,
          display_name: displayName,
          description: description.trim(),
          url,
          github_repo: githubRepo,
          category: currentCategory,
          source: "voltagent",
        });
      }
    }
  }

  return skills;
}

// ─── Parsing: Heilcheng README ───────────────────────────────────────────────

function parseHeilchengReadme(markdown) {
  const skills = [];
  const lines = markdown.split("\n");

  let currentCategory = "Unknown";
  let currentVendor = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // H3 headings
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      currentCategory = h3Match[1].replace(/<[^>]+>/g, "").trim();
      currentVendor = "";
      continue;
    }

    // H4 headings (vendor sub-sections)
    const h4Match = line.match(/^####\s+(.+)$/);
    if (h4Match) {
      currentVendor = h4Match[1].trim();
      currentCategory = currentVendor;
      continue;
    }

    // Bullet list entry: - [name](url) - description  OR  - [owner/name](url) - description
    const bulletMatch = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)\s*[-–—]\s*(.+)$/);
    if (bulletMatch) {
      const [, nameText, url, description] = bulletMatch;
      let owner = "";
      let name = "";

      // Check if nameText contains "/"
      if (nameText.includes("/")) {
        const parts = nameText.split("/");
        owner = parts[0].toLowerCase();
        name = parts.slice(1).join("/").toLowerCase();
      } else {
        // Try to extract owner from URL
        const urlInfo = extractOwnerNameFromUrl(url);
        if (urlInfo) {
          owner = urlInfo.owner.toLowerCase();
          name = urlInfo.name.toLowerCase();
        } else {
          // Fallback: use vendor as owner
          owner = currentVendor.replace(/skills\s+by\s+/i, "").trim().toLowerCase() || "unknown";
          name = nameText.toLowerCase().replace(/\s+/g, "-");
        }
      }

      const githubRepo = extractRepoFromUrl(url);

      skills.push({
        owner,
        name,
        display_name: `${owner}/${name}`,
        description: description.trim(),
        url,
        github_repo: githubRepo,
        category: currentCategory,
        source: "heilcheng",
      });
      continue;
    }

    // Markdown table row: | [name](url) | description |
    const tableMatch = line.match(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|$/);
    if (tableMatch && !line.match(/^\|[\s-|:]+\|$/)) {
      // Skip separator rows
      const [, nameText, url, description] = tableMatch;
      let owner = "";
      let name = "";

      if (nameText.includes("/")) {
        const parts = nameText.split("/");
        owner = parts[0].toLowerCase();
        name = parts.slice(1).join("/").toLowerCase();
      } else {
        const urlInfo = extractOwnerNameFromUrl(url);
        if (urlInfo) {
          owner = urlInfo.owner.toLowerCase();
          name = urlInfo.name.toLowerCase();
        } else {
          owner = currentVendor.replace(/skills\s+by\s+/i, "").trim().toLowerCase() || "unknown";
          name = nameText.toLowerCase().replace(/\s+/g, "-");
        }
      }

      const githubRepo = extractRepoFromUrl(url);

      skills.push({
        owner,
        name,
        display_name: `${owner}/${name}`,
        description: description.trim(),
        url,
        github_repo: githubRepo,
        category: currentCategory,
        source: "heilcheng",
      });
    }
  }

  return skills;
}

function parseEverythingskillDataset(jsonText) {
  const data = JSON.parse(jsonText);
  const categoryLabels = new Map((data.categories || []).map((category) => [category.key, category.label || category.key]));
  const skills = [];
  for (const item of data.skills || []) {
    const repo = extractRepoFromUrl(item.github || "");
    if (!repo) continue;
    const [owner, repoName] = repo.split("/");
    const categoryLabel = categoryLabels.get(item.category) || item.category || "Uncategorized";
    skills.push({
      owner: owner.toLowerCase(),
      name: String(item.slug || repoName || item.name || "skill").toLowerCase(),
      display_name: repo,
      description: item.summary || item.description || item.summaryZh || item.descriptionZh || "",
      url: item.github,
      github_repo: repo,
      category: `EverythingSkill / ${categoryLabel}`,
      source: "everythingskill",
      stars: item.stars,
      added_at: item.addedAt,
      updated_at: item.updatedAt || data.lastSyncedAt,
      readme_locales: item.readmeLocales || [],
      github_status: item.githubStatus || null,
      tags: item.tags || [],
    });
  }
  return skills;
}

function parsePersonaDistillReadme(markdown) {
  const skills = [];
  const seen = new Set();
  const lines = markdown.split("\n");
  const repoRegex = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\.git)?/g;
  for (const rawLine of lines) {
    let match;
    while ((match = repoRegex.exec(rawLine)) !== null) {
      const repo = match[1].replace(/\/$/, "");
      if (repo === SOURCES.personaDistill.repo || seen.has(repo.toLowerCase())) continue;
      seen.add(repo.toLowerCase());
      const [owner, repoName] = repo.split("/");
      const cleanLine = rawLine
        .replace(/<[^>]+>/g, " ")
        .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/[`*_>#|-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      skills.push({
        owner: owner.toLowerCase(),
        name: repoName.toLowerCase(),
        display_name: repo,
        description: cleanLine || `Persona-distilled skill repository from ${repo}.`,
        url: `https://github.com/${repo}`,
        github_repo: repo,
        category: "Persona Distill Skills",
        source: "persona-distill",
      });
    }
  }
  return skills;
}

// ─── Fetch & Merge ───────────────────────────────────────────────────────────

async function fetchSource(source) {
  log(`  Fetching ${source.repo}...`);
  const res = await fetchWithRetry(source.raw_url);
  const markdown = await res.text();
  return markdown;
}

async function fetchStars(repos) {
  const cacheFile = join(CACHE_DIR, "stars-cache.json");
  const starCache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const now = Date.now();
  const uncached = [];

  for (const repo of repos) {
    const entry = starCache[repo];
    if (!entry || now - entry.fetched_at > STARS_TTL || entry.forks == null || entry.pushed_at == null) {
      uncached.push(repo);
    }
  }

  if (uncached.length > 0) {
    log(`  Fetching stars for ${uncached.length} repos...`);

    let rateLimited = false;
    let successCount = 0;

    for (let i = 0; i < uncached.length; i += MAX_CONCURRENT_API) {
      if (rateLimited) break;

      const batch = uncached.slice(i, i + MAX_CONCURRENT_API);
      const results = await Promise.allSettled(
        batch.map(async (repo) => {
          const res = await fetchWithRetry(`https://api.github.com/repos/${repo}`);
          // Check rate limit header
          const remaining = parseInt(res.headers.get("x-ratelimit-remaining") || "0", 10);
          if (remaining <= 5) rateLimited = true;
          const data = await res.json();
          return {
            repo,
            stars: data.stargazers_count || 0,
            forks: data.forks_count || 0,
            watchers: data.subscribers_count || 0,
            open_issues: data.open_issues_count || 0,
            default_branch: data.default_branch || "",
            pushed_at: data.pushed_at || "",
            updated_at: data.updated_at || "",
            archived: Boolean(data.archived),
            disabled: Boolean(data.disabled),
            html_url: data.html_url || `https://github.com/${repo}`,
            fetched_at: now,
          };
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === "fulfilled") {
          starCache[result.value.repo] = result.value;
          successCount++;
        } else if (batch[j]) {
          const existing = starCache[batch[j]];
          starCache[batch[j]] = existing
            ? { ...existing, fetched_at: now, fetch_error: result.reason?.message || "fetch_failed" }
            : { stars: null, fetched_at: now, fetch_error: result.reason?.message || "fetch_failed" };
        }
      }

      // Small delay between batches
      if (i + MAX_CONCURRENT_API < uncached.length && !rateLimited) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    writeFileSync(cacheFile, JSON.stringify(starCache, null, 2), "utf8");

    if (rateLimited) {
      log(`  Rate limited after ${successCount} repos. Set GITHUB_TOKEN for full results.`);
    }
  }

  return starCache;
}

async function cmdFetch(args) {
  const force = args.includes("--force");
  const cache = readCache();

  if (!force && cache && cache.updated_at && Date.now() - new Date(cache.updated_at).getTime() < CACHE_TTL) {
    log(`Cache is fresh (updated ${cache.updated_at}). Use --force to re-fetch.`);
    return;
  }

  log("Fetching skills from GitHub...");
  ensureCacheDir();

  const allSkills = {};
  const sources = {};

  // Parse VoltAgent (primary)
  try {
    const markdown = await fetchSource(SOURCES.voltagent);
    const skills = parseVoltagentReadme(markdown);
    for (const skill of skills) {
      mergeSkill(allSkills, skill);
    }
    sources.voltagent = {
      repo: SOURCES.voltagent.repo,
      fetched_at: new Date().toISOString(),
      skill_count: skills.length,
    };
    log(`  Parsed ${skills.length} skills from VoltAgent`);
  } catch (e) {
    logErr(`  Failed to fetch VoltAgent: ${e.message}`);
  }

  // Parse Heilcheng (supplement)
  try {
    const markdown = await fetchSource(SOURCES.heilcheng);
    const skills = parseHeilchengReadme(markdown);
    let added = 0;
    for (const skill of skills) {
      if (mergeSkill(allSkills, skill)) added++;
    }
    sources.heilcheng = {
      repo: SOURCES.heilcheng.repo,
      fetched_at: new Date().toISOString(),
      skill_count: skills.length,
      added_count: added,
    };
    log(`  Parsed ${skills.length} skills from heilcheng (${added} new)`);
  } catch (e) {
    logErr(`  Failed to fetch heilcheng: ${e.message}`);
  }

  // Parse EverythingSkill.net canonical dataset (active public skills, daily synced upstream)
  try {
    const jsonText = await fetchSource(SOURCES.everythingskill);
    const skills = parseEverythingskillDataset(jsonText);
    let added = 0;
    for (const skill of skills) {
      if (mergeSkill(allSkills, skill)) added++;
    }
    sources.everythingskill = {
      repo: SOURCES.everythingskill.repo,
      fetched_at: new Date().toISOString(),
      skill_count: skills.length,
      added_count: added,
    };
    log(`  Parsed ${skills.length} skills from EverythingSkill (${added} new)`);
  } catch (e) {
    logErr(`  Failed to fetch EverythingSkill: ${e.message}`);
  }

  // Parse the persona distillation awesome list tracked by EverythingSkill.
  try {
    const markdown = await fetchSource(SOURCES.personaDistill);
    const skills = parsePersonaDistillReadme(markdown);
    let added = 0;
    for (const skill of skills) {
      if (mergeSkill(allSkills, skill)) added++;
    }
    sources.personaDistill = {
      repo: SOURCES.personaDistill.repo,
      fetched_at: new Date().toISOString(),
      skill_count: skills.length,
      added_count: added,
    };
    log(`  Parsed ${skills.length} skills from persona distill list (${added} new)`);
  } catch (e) {
    logErr(`  Failed to fetch persona distill list: ${e.message}`);
  }

  // Fetch stars for all unique repos
  const repos = new Set();
  for (const skill of Object.values(allSkills)) {
    if (skill.github_repo) repos.add(skill.github_repo);
  }

  const starCache = await fetchStars([...repos]);

  // Apply star counts
  for (const skill of Object.values(allSkills)) {
    if (skill.github_repo && starCache[skill.github_repo]) {
      const repoMeta = starCache[skill.github_repo];
      if (repoMeta.stars != null) skill.stars = repoMeta.stars;
      skill.repo_meta = {
        forks: repoMeta.forks || 0,
        watchers: repoMeta.watchers || 0,
        open_issues: repoMeta.open_issues || 0,
        pushed_at: repoMeta.pushed_at || "",
        updated_at: repoMeta.updated_at || "",
        archived: Boolean(repoMeta.archived),
        disabled: Boolean(repoMeta.disabled),
        fetched_at: repoMeta.fetched_at ? new Date(repoMeta.fetched_at).toISOString() : new Date().toISOString(),
        fetch_error: repoMeta.fetch_error || null,
      };
      if (!skill.updated_at && repoMeta.pushed_at) skill.updated_at = repoMeta.pushed_at;
    }
  }

  // Merge manual skills (persisted across fetches)
  const manualSkills = readManualSkills();
  for (const [key, skill] of Object.entries(manualSkills)) {
    allSkills[key] = skill;
  }

  const data = {
    version: 1,
    updated_at: new Date().toISOString(),
    sources,
    skills: allSkills,
    total_count: Object.keys(allSkills).length,
  };

  writeCache(data);
  log(`\nDone! ${data.total_count} unique skills cached.`);
}

// ─── Query Commands ──────────────────────────────────────────────────────────

function ensureCache() {
  const cache = readCache();
  if (!cache || !cache.skills || Object.keys(cache.skills).length === 0) {
    log("No cache found. Running fetch first...");
    return null;
  }
  cache.skills = filterDiscoveredSkills(cache.skills);
  // Merge manual skills into cache for queries
  const manual = readManualSkills();
  for (const [key, skill] of Object.entries(manual)) {
    if (!cache.skills[key]) {
      cache.skills[key] = skill;
    }
  }
  return cache;
}

function cmdCategories() {
  const cache = ensureCache();
  if (!cache) return;

  const categories = {};
  for (const skill of Object.values(cache.skills)) {
    const cat = skill.category || "Uncategorized";
    categories[cat] = (categories[cat] || 0) + 1;
  }

  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);

  log(`\nCategories (${sorted.length} total, ${cache.total_count} skills):\n`);
  for (const [cat, count] of sorted) {
    const bar = "█".repeat(Math.min(Math.floor(count / 10), 30)) || "▏";
    log(`  ${cat.padEnd(35)} ${String(count).padStart(4)}  ${bar}`);
  }
  log("");
}

function cmdList(category) {
  const cache = ensureCache();
  if (!cache) return;
  if (!category) {
    logErr("Usage: skills-book.mjs list <category>");
    logErr("Run 'skills-book.mjs categories' to see available categories.");
    return;
  }

  // Case-insensitive match
  const catLower = category.toLowerCase();
  const matched = Object.entries(cache.skills)
    .filter(([, s]) => s.category.toLowerCase().includes(catLower))
    .sort((a, b) => a[1].display_name.localeCompare(b[1].display_name));

  if (matched.length === 0) {
    log(`No skills found for category "${category}".`);
    return;
  }

  log(`\nSkills in "${matched[0][1].category}" (${matched.length}):\n`);
  for (const [key, skill] of matched) {
    const starStr = skill.stars != null ? `★${skill.stars.toLocaleString()}` : "—";
    const urlStr = skill.github_repo ? `https://github.com/${skill.github_repo}` : skill.url || "";
    const author = skill.owner || "";
    const name = skill.name || skill.display_name;
    const descWithUrl = urlStr ? `${skill.description} (${urlStr})` : skill.description;
    log(`  ${name.padEnd(30)} ${author.padEnd(20)} ${starStr.padStart(8)}  ${descWithUrl}`);
    log("");
  }
}

function cmdSearch(query) {
  const cache = ensureCache();
  if (!cache) return;
  if (!query) {
    logErr("Usage: skills-book.mjs search <query>");
    return;
  }

  const q = query.toLowerCase();
  const results = Object.entries(cache.skills)
    .filter(([, s]) => {
      return (
        s.display_name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      // Exact name match first, then stars
      const aName = a[1].display_name.toLowerCase().includes(q);
      const bName = b[1].display_name.toLowerCase().includes(q);
      if (aName && !bName) return -1;
      if (!aName && bName) return 1;
      return (b[1].stars || 0) - (a[1].stars || 0);
    });

  if (results.length === 0) {
    log(`No skills found for "${query}".`);
    return;
  }

  log(`\nSearch results for "${query}" (${results.length}):\n`);
  for (const [key, skill] of results.slice(0, 50)) {
    const starStr = skill.stars != null ? `★${skill.stars.toLocaleString()}` : "—";
    const urlStr = skill.github_repo ? `https://github.com/${skill.github_repo}` : skill.url || "";
    const author = skill.owner || "";
    const name = skill.name || skill.display_name;
    const descWithUrl = urlStr ? `${skill.description} (${urlStr})` : skill.description;
    log(`  ${name.padEnd(30)} ${author.padEnd(20)} ${starStr.padStart(8)}  ${descWithUrl}`);
    log("");
  }
  if (results.length > 50) {
    log(`  ... and ${results.length - 50} more results`);
  }
  log("");
}

function cmdTop(n = 20) {
  const cache = ensureCache();
  if (!cache) return;

  const withStars = Object.entries(cache.skills)
    .filter(([, s]) => s.stars != null && s.stars > 0)
    .sort((a, b) => b[1].stars - a[1].stars)
    .slice(0, n);

  if (withStars.length === 0) {
    log("No star data available. Run 'skills-book.mjs fetch --force' first.");
    return;
  }

  log(`\nTop ${withStars.length} Skills by GitHub Stars:\n`);
  log(`  #   ${"Skill".padEnd(42)} ${"Stars".padStart(8)}  Category`);
  log(`  ${"─".repeat(80)}`);

  for (let i = 0; i < withStars.length; i++) {
    const [, skill] = withStars[i];
    log(`  ${(i + 1).toString().padStart(2)}  ${skill.display_name.padEnd(42)} ★${skill.stars.toLocaleString().padStart(6)}  ${skill.category}`);
  }
  log("");
}

function daysSince(value) {
  if (!value) return 365;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 365;
  return Math.max(0, (Date.now() - time) / (24 * 60 * 60 * 1000));
}

function hotScore(skill) {
  const stars = Number(skill.stars || 0);
  const forks = Number(skill.repo_meta?.forks || 0);
  const recencyBoost = Math.max(0, 30 - daysSince(skill.repo_meta?.pushed_at || skill.updated_at)) * 4;
  const archivedPenalty = skill.repo_meta?.archived || skill.github_status === 404 ? 0.5 : 1;
  return Math.round((stars + forks * 2 + recencyBoost) * archivedPenalty);
}

function cmdHot(n = 50) {
  const cache = ensureCache();
  if (!cache) return;

  const ranked = Object.entries(cache.skills)
    .filter(([, s]) => Number(s.stars || 0) > 0 && s.github_status !== 404 && !s.repo_meta?.disabled)
    .map(([key, skill]) => [key, { ...skill, hot_score: hotScore(skill) }])
    .sort((a, b) => {
      const scoreDelta = b[1].hot_score - a[1].hot_score;
      if (scoreDelta !== 0) return scoreDelta;
      return Number(b[1].stars || 0) - Number(a[1].stars || 0);
    })
    .slice(0, n);

  if (!ranked.length) {
    log("No hot ranking data available. Run 'skills-book.mjs fetch --force' first.");
    return;
  }

  log(`\nHot ${ranked.length} Skills (stars + repo freshness):\n`);
  log(`  #   ${"Skill".padEnd(42)} ${"Hot".padStart(8)} ${"Stars".padStart(8)}  Updated`);
  log(`  ${"-".repeat(86)}`);
  ranked.forEach(([, skill], index) => {
    const updated = (skill.repo_meta?.pushed_at || skill.updated_at || "").slice(0, 10) || "-";
    log(`  ${String(index + 1).padStart(2)}  ${String(skill.display_name).padEnd(42)} ${String(skill.hot_score).padStart(8)} ${String(skill.stars || 0).padStart(8)}  ${updated}`);
  });
  log("");
}

function cmdInfo(key) {
  const cache = ensureCache();
  if (!cache) return;
  if (!key) {
    logErr("Usage: skills-book.mjs info <owner/name>");
    return;
  }

  const normalizedKey = key.toLowerCase();
  const skill = cache.skills[normalizedKey];

  if (!skill) {
    // Try fuzzy match
    const fuzzy = Object.entries(cache.skills)
      .filter(([, s]) => s.name.includes(key.toLowerCase()) || s.display_name.toLowerCase().includes(key.toLowerCase()))
      .slice(0, 3);

    log(`Skill "${key}" not found.`);
    if (fuzzy.length > 0) {
      log("Did you mean:");
      for (const [, s] of fuzzy) {
        log(`  ${s.display_name}`);
      }
    }
    return;
  }

  log(`\n  Skill: ${skill.display_name}`);
  log(`  Category: ${skill.category}`);
  log(`  Description: ${skill.description}`);
  log(`  URL: ${skill.url}`);
  if (skill.github_repo) log(`  GitHub Repo: ${skill.github_repo}`);
  if (skill.stars != null) log(`  Stars: ${skill.stars.toLocaleString()}`);
  log(`  Source: ${skill.source}`);

  // Check if installed
  const installPath = join(SKILLS_INSTALL_DIR, skill.name);
  if (existsSync(installPath)) {
    log(`  Installed: Yes (${installPath})`);
  } else {
    log(`  Installed: No`);
  }
  log("");
}

// ─── Install / Uninstall ─────────────────────────────────────────────────────

function cmdInstall(key) {
  const cache = ensureCache();
  if (!cache) return;
  if (!key) {
    logErr("Usage: skills-book.mjs install <owner/name>");
    return;
  }

  const normalizedKey = key.toLowerCase();
  const skill = cache.skills[normalizedKey];

  if (!skill) {
    log(`Skill "${key}" not found in index. Try searching first.`);
    return;
  }

  const installDir = join(SKILLS_INSTALL_DIR, skill.name);
  if (existsSync(installDir)) {
    log(`Skill "${skill.name}" is already installed at ${installDir}`);
    return;
  }

  if (!existsSync(SKILLS_INSTALL_DIR)) {
    mkdirSync(SKILLS_INSTALL_DIR, { recursive: true });
  }

  // Try to install from GitHub
  if (skill.github_repo) {
    log(`Installing ${skill.display_name}...`);
    try {
      const repoUrl = `https://github.com/${skill.github_repo}.git`;
      const tmpDir = join(CACHE_DIR, `_tmp_install_${skill.name}`);

      // Clone to a temp directory first
      execSync(`git clone --depth 1 "${repoUrl}" "${tmpDir}"`, { stdio: "pipe" });

      // Find SKILL.md in the cloned repo
      let skillMdPath = findSkillMd(tmpDir);

      if (!skillMdPath) {
        rmSync(tmpDir, { recursive: true, force: true });
        logErr(`  No SKILL.md found in ${skill.github_repo}`);
        return;
      }

      // If SKILL.md is not at root, install from its subdirectory
      const skillDir = dirname(skillMdPath);
      const srcDir = skillDir === tmpDir ? tmpDir : skillDir;

      mkdirSync(installDir, { recursive: true });
      copyDirSync(srcDir, installDir);
      rmSync(tmpDir, { recursive: true, force: true });

      log(`  Installed to ${installDir}`);
      log("  You can now use this skill in Claude Code.");
    } catch (e) {
      logErr(`  Failed to clone: ${e.message}`);
      rmSync(installDir, { recursive: true, force: true });
      // Clean up temp dir if it exists
      const tmpDir = join(CACHE_DIR, `_tmp_install_${skill.name}`);
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  } else {
    // Try fetching the SKILL.md directly from the URL
    log(`Installing ${skill.display_name} from URL...`);
    log(`  This skill is not hosted on GitHub. You may need to install it manually.`);
    log(`  URL: ${skill.url}`);
  }
}

function cmdUninstall(name) {
  if (!name) {
    logErr("Usage: skills-book.mjs uninstall <skill-name>");
    return;
  }

  const installDir = join(SKILLS_INSTALL_DIR, name);
  if (!existsSync(installDir)) {
    log(`Skill "${name}" is not installed.`);
    return;
  }

  try {
    rmSync(installDir, { recursive: true, force: true });
    log(`Uninstalled "${name}" from ${installDir}`);
  } catch (e) {
    logErr(`  Failed to uninstall: ${e.message}`);
  }
}

// ─── Discover Skills from GitHub ─────────────────────────────────────────────

async function searchGitHubRepos(query, sort = "stars", perPage = 100) {
  log(`  Searching repos: "${query}"...`);
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&per_page=${perPage}`;
  const res = await fetchWithRetry(url);
  return (await res.json()).items || [];
}

async function searchGitHubCode(query, perPage = 100) {
  log(`  Searching code: "${query}"...`);
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${perPage}`;
  try {
    const res = await fetchWithRetry(url);
    return (await res.json()).items || [];
  } catch {
    // Code search often returns errors without token, skip gracefully
    return [];
  }
}

function repoHasDiscoverCandidateSignal(repo) {
  return repoHasMetadataSkillSignal(repo);
}

async function githubRootHasSkillEntry(repo) {
  if (!repo?.full_name) return false;
  const branches = [...new Set([repo.default_branch, "main", "master"].filter(Boolean))];
  const directOk = await isGitHubAccessible();
  const headers = {};
  if (directOk && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  for (const branch of branches) {
    const url = `https://api.github.com/repos/${repo.full_name}/contents?ref=${encodeURIComponent(branch)}`;
    const requestUrl = directOk ? url : maybeProxyUrl(url);
    try {
      const res = await fetch(requestUrl, { headers });
      if (res.ok) {
        const entries = await res.json();
        return Array.isArray(entries) && entries.some((entry) => {
          const name = String(entry.name || "").toLowerCase();
          return (entry.type === "file" && name === "skill.md") || (entry.type === "dir" && name === "skills");
        });
      }
      if (res.status === 403) throw new Error("rate_limited");
    } catch (e) {
      if (e.message === "rate_limited") throw e;
      return false;
    }
  }
  return false;
}

async function repoMatchesDiscoverFilter(repo) {
  if (repoHasDiscoverCandidateSignal(repo)) return DISCOVERY_VERIFICATION.metadataSkillSignal;
  if (await githubRootHasSkillEntry(repo)) return DISCOVERY_VERIFICATION.rootSkillEntry;
  return "";
}

function discoveredSkillFromRepo(repo, source, discoveryVerified = DISCOVERY_VERIFICATION.metadataSkillSignal) {
  return {
    owner: repo.owner.login.toLowerCase(),
    name: repo.name.toLowerCase(),
    display_name: `${repo.owner.login}/${repo.name}`,
    description: repo.description || "No description",
    url: repo.html_url,
    github_repo: repo.full_name,
    category: "Discovered",
    source,
    discovery_verified: discoveryVerified,
    stars: repo.stargazers_count,
  };
}

const AGENT_TOPIC_QUERIES = [
  "topic:ai-agent",
  "topic:ai-agents",
  "topic:ai-tools",
];

function repoHasAgentSignal(repo) {
  const description = String(repo.description || "").toLowerCase();
  const name = String(repo.name || "").toLowerCase();
  const fullName = String(repo.full_name || "").toLowerCase();
  const topics = (repo.topics || []).map((topic) => String(topic || "").toLowerCase());

  return (
    name.includes("agent") ||
    fullName.includes("agent") ||
    description.includes("agent") ||
    topics.some((topic) => topic.includes("agent"))
  );
}

function agentFromRepo(repo, source) {
  return {
    owner: repo.owner.login.toLowerCase(),
    name: repo.name.toLowerCase(),
    display_name: `${repo.owner.login}/${repo.name}`,
    description: repo.description || "No description",
    url: repo.html_url,
    github_repo: repo.full_name,
    topics: repo.topics || [],
    source,
    stars: repo.stargazers_count || 0,
    updated_at: repo.updated_at || null,
  };
}

function ensureAgentsCache() {
  const cache = readAgentsCache();
  if (!cache || !cache.agents || Object.keys(cache.agents).length === 0) {
    log("No agent cache found. Run `skills-book.mjs agents discover` first.");
    return null;
  }
  return cache;
}

async function cmdAgents(args = []) {
  const action = (args[0] || "top").toLowerCase();
  const rest = args.slice(1);

  if (["discover", "fetch", "update", "refresh"].includes(action)) {
    await cmdAgentsDiscover();
    return;
  }

  if (["search", "find"].includes(action)) {
    cmdAgentsSearch(rest.join(" "));
    return;
  }

  if (["top", "rank", "ranking", "list"].includes(action)) {
    cmdAgentsTop(parseInt(rest[0], 10) || 20);
    return;
  }

  cmdAgentsSearch(args.join(" "));
}

async function cmdAgentsDiscover() {
  log("Discovering AI agents from GitHub...\n");
  const agents = {};

  for (const query of AGENT_TOPIC_QUERIES) {
    try {
      const repos = await searchGitHubRepos(query);
      for (const repo of repos) {
        if (!repoHasAgentSignal(repo)) continue;
        const key = `${repo.owner.login}/${repo.name}`.toLowerCase();
        agents[key] = agentFromRepo(repo, `discover:${query}`);
      }
    } catch (e) {
      logErr(`  Skipped "${query}": ${e.message}`);
    }
  }

  const data = {
    version: 1,
    updated_at: new Date().toISOString(),
    sources: AGENT_TOPIC_QUERIES,
    total_count: Object.keys(agents).length,
    agents,
  };
  writeAgentsCache(data);

  log(`\nDone! ${data.total_count} AI agent/tool repos cached separately.`);
  cmdAgentsTop(20, data);
}

function cmdAgentsSearch(query) {
  const cache = ensureAgentsCache();
  if (!cache) return;
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    cmdAgentsTop(20, cache);
    return;
  }

  const results = Object.entries(cache.agents)
    .filter(([, agent]) => [
      agent.display_name,
      agent.name,
      agent.owner,
      agent.description,
      agent.github_repo,
      ...(agent.topics || []),
    ].some((value) => String(value || "").toLowerCase().includes(q)))
    .sort((a, b) => (b[1].stars || 0) - (a[1].stars || 0));

  if (!results.length) {
    log(`No agents found for "${query}".`);
    return;
  }

  log(`\nAgent search results for "${query}" (${results.length}):\n`);
  printAgentRows(results.slice(0, 50));
  if (results.length > 50) log(`  ... and ${results.length - 50} more results`);
  log("");
}

function cmdAgentsTop(n = 20, cache = null) {
  const data = cache || ensureAgentsCache();
  if (!data) return;
  const results = Object.entries(data.agents)
    .sort((a, b) => (b[1].stars || 0) - (a[1].stars || 0))
    .slice(0, n);

  log(`\nTop ${results.length} AI Agent Repos by GitHub Stars:\n`);
  printAgentRows(results);
  log("");
}

function printAgentRows(rows) {
  for (const [, agent] of rows) {
    const starStr = `★${(agent.stars || 0).toLocaleString()}`;
    const urlStr = agent.github_repo ? `https://github.com/${agent.github_repo}` : agent.url || "";
    const descWithUrl = urlStr ? `${agent.description} (${urlStr})` : agent.description;
    log(`  ${agent.name.padEnd(32)} ${agent.owner.padEnd(18)} ${starStr.padStart(9)}  ${descWithUrl}`);
    log("");
  }
}

async function cmdDiscover(args) {
  log("Discovering skills from GitHub...\n");

  const cache = readCache() || { skills: {} };
  const manual = readManualSkills();

  // Merge existing into one set for dedup
  const existing = new Set();
  for (const key of Object.keys(cache.skills || {})) existing.add(key);
  for (const key of Object.keys(manual)) existing.add(key);

  const newSkills = {};

  // ── 1. Search by topics ──
  log("1. Searching by topics...");
  const topicQueries = [
    "topic:agent-skill",
    "topic:claude-code",
    "topic:ai-skill",
    "topic:agent-tool",
    "topic:ai-agent-tool",
  ];

  for (const q of topicQueries) {
    try {
      const repos = await searchGitHubRepos(q);
      for (const repo of repos) {
        const key = `${repo.owner.login}/${repo.name}`.toLowerCase();
        if (existing.has(key) || newSkills[key]) continue;
        const discoveryVerified = await repoMatchesDiscoverFilter(repo);
        if (!discoveryVerified) continue;
        newSkills[key] = discoveredSkillFromRepo(repo, "discover:topic", discoveryVerified);
      }
    } catch (e) {
      logErr(`  Skipped "${q}": ${e.message}`);
    }
  }
  log(`  Found ${Object.keys(newSkills).length} new from topics\n`);

  // ── 2. Search for SKILL.md files ──
  log("2. Searching for SKILL.md files...");
  const codeQueries = [
    "filename:SKILL.md+fork:false",
    "filename:SKILL.md+awesome-agent",
    "SKILL.md+claude+fork:false",
  ];

  for (const q of codeQueries) {
    try {
      const items = await searchGitHubCode(q);
      for (const item of items) {
        // item.repository is the full repo object
        const repo = item.repository;
        const key = `${repo.owner.login}/${repo.name}`.toLowerCase();
        if (existing.has(key) || newSkills[key]) continue;
        newSkills[key] = discoveredSkillFromRepo(repo, "discover:code", DISCOVERY_VERIFICATION.codeSearchSkillEntry);
      }
    } catch (e) {
      logErr(`  Skipped "${q}": ${e.message}`);
    }
  }
  log(`  Found ${Object.keys(newSkills).length} total so far\n`);

  // ── 3. Search by keywords ──
  log("3. Searching by keywords...");
  const keywordQueries = [
    "claude agent skill",
    "ai agent skills",
    "awesome-agent-skills",
    "claude-code skill",
    "codex skill",
    "AI coding skill",
  ];

  for (const q of keywordQueries) {
    try {
      const repos = await searchGitHubRepos(q);
      for (const repo of repos) {
        const key = `${repo.owner.login}/${repo.name}`.toLowerCase();
        if (existing.has(key) || newSkills[key]) continue;
        const discoveryVerified = await repoMatchesDiscoverFilter(repo);
        if (!discoveryVerified) continue;
        newSkills[key] = discoveredSkillFromRepo(repo, "discover:keyword", discoveryVerified);
      }
    } catch (e) {
      logErr(`  Skipped "${q}": ${e.message}`);
    }
  }

  // ── Merge into manual skills ──
  if (Object.keys(newSkills).length === 0) {
    log("\nNo new skills found.");
    return;
  }

  log(`\nFound ${Object.keys(newSkills).length} new skills:\n`);
  const sorted = Object.entries(newSkills).sort((a, b) => (b[1].stars || 0) - (a[1].stars || 0));
  for (const [key, skill] of sorted.slice(0, 30)) {
    const starStr = skill.stars ? `★${skill.stars.toLocaleString()}` : "—";
    log(`  ${skill.display_name.padEnd(42)} ${starStr.padStart(8)}  ${skill.description}`);
  }
  if (sorted.length > 30) {
    log(`  ... and ${sorted.length - 30} more`);
  }

  // Merge into manual skills for persistence
  for (const [key, skill] of Object.entries(newSkills)) {
    manual[key] = skill;
  }
  writeManualSkills(manual);
  log(`\nAdded ${Object.keys(newSkills).length} skills to cache.`);
}

// ─── Manual Skills ───────────────────────────────────────────────────────────

function cmdAdd(args) {
  // Expected: add owner name description url [category]
  if (args.length < 4) {
    logErr("Usage: skills-book.mjs add <owner> <name> <description> <url> [category]");
    logErr("Example: add alchaincyf huashu-design \"HTML design skill\" https://github.com/alchaincyf/huashu-design");
    return;
  }
  const [owner, name, ...rest] = args;
  const url = rest.pop();
  const description = rest.join(" ");
  const category = args[5] || "Community Skills";

  const key = `${owner.toLowerCase()}/${name.toLowerCase()}`;
  const manual = readManualSkills();
  manual[key] = {
    owner: owner.toLowerCase(),
    name: name.toLowerCase(),
    display_name: key,
    description,
    url,
    github_repo: `alchaincyf/huashu-design` === key ? key : null,
    category,
    source: "manual",
    stars: null,
  };

  // Auto-detect github_repo
  const repo = extractRepoFromUrl(url);
  if (repo) manual[key].github_repo = repo;

  writeManualSkills(manual);
  log(`Added ${key} to manual skills. It will persist across fetches.`);
}

function cmdRemove(key) {
  if (!key) {
    logErr("Usage: skills-book.mjs remove <owner/name>");
    return;
  }
  const normalizedKey = key.toLowerCase();
  const manual = readManualSkills({ includeUnverifiedDiscoveries: true });
  if (!manual[normalizedKey]) {
    log(`"${normalizedKey}" is not a manually added skill.`);
    return;
  }
  delete manual[normalizedKey];
  writeManualSkills(manual);
  log(`Removed ${normalizedKey} from manual skills.`);
}

// ─── Update ──────────────────────────────────────────────────────────────────

async function cmdUpdate() {
  log("Updating skills index...\n");
  await cmdFetch(["--force"]);
  log("");
  await cmdDiscover([]);
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp() {
  log(`
Skills Book — Agent Skill Marketplace

Usage: skills-book.mjs <command> [args]
Agent wrapper: /skills-book <command> [args]

Commands:
  fetch [--force]          Download & cache skills from GitHub
  categories               List all categories with skill counts
  list <category>          Show skills in a category
  search <query>           Search skills by name, description, or category
  top [N]                  Top N skills by GitHub stars (default: 20)
  hot [N]                  Hot skills by stars plus repository freshness
  info <owner/name>        Detailed info for a skill
  install <owner/name>     Install a skill to ~/.claude/skills/
  uninstall <name>         Remove a skill from ~/.claude/skills/
  add <owner> <name> <desc> <url>  Manually add a skill (persists across fetches)
  remove <owner/name>      Remove a manually added skill
  discover                 Search GitHub for new skills via topics, code, and keywords
  agents discover          Build a separate AI agent/tool index
  agents search <query>    Search the separate AI agent/tool index
  agents top [N]           Rank AI agent/tool repos by GitHub stars
  update                   Re-fetch all skills and refresh cache
  combos [query]           Search built-in recommended skill/tool combos
  combos show <combo-id>   Show install steps and workflow for a combo
  build-wiki [--limit N] [--db file] [--extract]
                           Build SQLite skills.db through llm-wiki-build-skill
  wiki-query <query>       Search the Skills Wiki through llm-wiki-build-skill
  wiki-graph [--out file]  Export graph JSON through llm-wiki-build-skill
  shop-export <dir>        Export Skills Shop static data for ASunYC.github.io
  help                     Show this help message

Examples:
  skills-book.mjs fetch --force
  skills-book.mjs categories
  skills-book.mjs list "Python Skills"
  skills-book.mjs search "testing"
  skills-book.mjs top 10
  skills-book.mjs hot 50
  skills-book.mjs info "stripe/reasoning"
  skills-book.mjs install "stripe/reasoning"
  skills-book.mjs uninstall "reasoning"
  skills-book.mjs agents discover
  skills-book.mjs agents top 20
  skills-book.mjs agents search "OpenCLI"
  skills-book.mjs combos
  skills-book.mjs recommend security
  skills-book.mjs combos show coding-research-docs-ui
  skills-book.mjs build-wiki
  skills-book.mjs wiki-query "frontend design"
  skills-book.mjs shop-export ../ASunYC.github.io/docs/public/data
`);
  printComboHighlights();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  switch (command) {
    case "fetch":
      await cmdFetch(args.slice(1));
      break;
    case "categories":
      cmdCategories();
      break;
    case "list":
      cmdList(args[1]);
      break;
    case "search":
      cmdSearch(args.slice(1).join(" "));
      break;
    case "top":
      cmdTop(parseInt(args[1]) || 20);
      break;
    case "hot":
      cmdHot(parseInt(args[1]) || 50);
      break;
    case "info":
      cmdInfo(args[1]);
      break;
    case "install":
      cmdInstall(args[1]);
      break;
    case "uninstall":
      cmdUninstall(args[1]);
      break;
  case "add":
      cmdAdd(args.slice(1));
      break;
    case "remove":
      cmdRemove(args[1]);
      break;
    case "discover":
      await cmdDiscover(args.slice(1));
      break;
    case "agents":
    case "agent":
      await cmdAgents(args.slice(1));
      break;
    case "update":
      await cmdUpdate();
      break;
    case "combos":
    case "combo":
    case "combo-search":
    case "rec":
    case "recommend":
    case "recommendations":
      cmdCombos(args.slice(1));
      break;
    case "build-wiki":
      await cmdBuildWiki(args.slice(1));
      break;
    case "wiki-query":
      await cmdWikiQuery(args.slice(1));
      break;
    case "wiki-graph":
      await cmdWikiGraph(args.slice(1));
      break;
    case "shop-export":
      await cmdShopExport(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      if (!command) {
        printHelp();
      } else {
        logErr(`Unknown command: ${command}`);
        logErr("Run 'skills-book.mjs help' for usage.");
        process.exit(1);
      }
  }
}

main().catch((e) => {
  logErr(`Error: ${e.message}`);
  process.exit(1);
});
