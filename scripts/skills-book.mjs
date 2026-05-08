#!/usr/bin/env node
// Skills Book CLI — Aggregate, browse, search, install/uninstall agent skills
// Zero external dependencies. Requires Node.js 22+ (for native fetch).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync, copyFileSync } from "fs";
import { join, dirname, basename } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_DIR = join(homedir(), ".claude", "skills-book", "cache");
const CACHE_FILE = join(CACHE_DIR, "skills-index.json");
const MANUAL_SKILLS_FILE = join(CACHE_DIR, "manual-skills.json");
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

function readManualSkills() {
  if (!existsSync(MANUAL_SKILLS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(MANUAL_SKILLS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeManualSkills(skills) {
  ensureCacheDir();
  writeFileSync(MANUAL_SKILLS_FILE, JSON.stringify(skills, null, 2), "utf8");
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
    if (!entry || now - entry.fetched_at > STARS_TTL) {
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
          return { repo, stars: data.stargazers_count || 0 };
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === "fulfilled") {
          starCache[result.value.repo] = {
            stars: result.value.stars,
            fetched_at: now,
          };
          successCount++;
        } else if (batch[j]) {
          // On failure, set 0 stars so we don't retry forever
          starCache[batch[j]] = { stars: 0, fetched_at: now };
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
      const key = `${skill.owner}/${skill.name}`;
      allSkills[key] = skill;
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
      const key = `${skill.owner}/${skill.name}`;
      if (!allSkills[key]) {
        allSkills[key] = skill;
        added++;
      }
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

  // Fetch stars for all unique repos
  const repos = new Set();
  for (const skill of Object.values(allSkills)) {
    if (skill.github_repo) repos.add(skill.github_repo);
  }

  const starCache = await fetchStars([...repos]);

  // Apply star counts
  for (const skill of Object.values(allSkills)) {
    if (skill.github_repo && starCache[skill.github_repo]) {
      skill.stars = starCache[skill.github_repo].stars;
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
        newSkills[key] = {
          owner: repo.owner.login.toLowerCase(),
          name: repo.name.toLowerCase(),
          display_name: `${repo.owner.login}/${repo.name}`,
          description: repo.description || "No description",
          url: repo.html_url,
          github_repo: repo.full_name,
          category: "Discovered",
          source: "discover:topic",
          stars: repo.stargazers_count,
        };
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
        newSkills[key] = {
          owner: repo.owner.login.toLowerCase(),
          name: repo.name.toLowerCase(),
          display_name: `${repo.owner.login}/${repo.name}`,
          description: repo.description || "No description",
          url: repo.html_url,
          github_repo: repo.full_name,
          category: "Discovered",
          source: "discover:code",
          stars: repo.stargazers_count,
        };
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
        // Filter: must have SKILL.md in repo or description mentions skill/agent
        const hasSkillKeyword =
          (repo.description || "").toLowerCase().includes("skill") ||
          (repo.description || "").toLowerCase().includes("agent") ||
          (repo.topics || []).some((t) => t.includes("skill") || t.includes("agent"));
        if (!hasSkillKeyword) continue;
        newSkills[key] = {
          owner: repo.owner.login.toLowerCase(),
          name: repo.name.toLowerCase(),
          display_name: `${repo.owner.login}/${repo.name}`,
          description: repo.description || "No description",
          url: repo.html_url,
          github_repo: repo.full_name,
          category: "Discovered",
          source: "discover:keyword",
          stars: repo.stargazers_count,
        };
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
  const manual = readManualSkills();
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
  log("Updating skills index...");
  await cmdFetch(["--force"]);
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp() {
  log(`
Skills Book — Agent Skill Marketplace

Usage: skills-book.mjs <command> [args]

Commands:
  fetch [--force]          Download & cache skills from GitHub
  categories               List all categories with skill counts
  list <category>          Show skills in a category
  search <query>           Search skills by name, description, or category
  top [N]                  Top N skills by GitHub stars (default: 20)
  info <owner/name>        Detailed info for a skill
  install <owner/name>     Install a skill to ~/.claude/skills/
  uninstall <name>         Remove a skill from ~/.claude/skills/
  add <owner> <name> <desc> <url>  Manually add a skill (persists across fetches)
  remove <owner/name>      Remove a manually added skill
  discover                 Search GitHub for new skills via topics, code, and keywords
  update                   Re-fetch all skills and refresh cache
  help                     Show this help message

Examples:
  skills-book.mjs fetch --force
  skills-book.mjs categories
  skills-book.mjs list "Python Skills"
  skills-book.mjs search "testing"
  skills-book.mjs top 10
  skills-book.mjs info "stripe/reasoning"
  skills-book.mjs install "stripe/reasoning"
  skills-book.mjs uninstall "reasoning"
`);
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
    case "update":
      await cmdUpdate();
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
