import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import crypto from "node:crypto";

const CACHE_DIR = join(homedir(), ".claude", "skills-book", "cache");
const CACHE_FILE = join(CACHE_DIR, "skills-index.json");
const DEFAULT_DB_FILE = join(CACHE_DIR, "skills.db");
const DEFAULT_WIKI_ID = "skills-book";
const GH_PROXY = "https://gh-proxy.org";
const CHUNK_SIZE = 6000;
const CHUNK_OVERLAP = 500;
const FETCH_TIMEOUT_MS = 8000;

const LOCATION_COORDS = [
  ["san francisco", 37.7749, -122.4194],
  ["berkeley", 37.8715, -122.273],
  ["new york", 40.7128, -74.006],
  ["nyc", 40.7128, -74.006],
  ["seattle", 47.6062, -122.3321],
  ["los angeles", 34.0522, -118.2437],
  ["austin", 30.2672, -97.7431],
  ["boston", 42.3601, -71.0589],
  ["london", 51.5072, -0.1276],
  ["paris", 48.8566, 2.3522],
  ["berlin", 52.52, 13.405],
  ["amsterdam", 52.3676, 4.9041],
  ["singapore", 1.3521, 103.8198],
  ["tokyo", 35.6762, 139.6503],
  ["beijing", 39.9042, 116.4074],
  ["shanghai", 31.2304, 121.4737],
  ["shenzhen", 22.5431, 114.0579],
  ["hangzhou", 30.2741, 120.1551],
  ["hong kong", 22.3193, 114.1694],
  ["taipei", 25.033, 121.5654],
  ["india", 20.5937, 78.9629],
  ["china", 35.8617, 104.1954],
  ["united states", 39.8283, -98.5795],
  ["usa", 39.8283, -98.5795],
  ["canada", 56.1304, -106.3468],
  ["germany", 51.1657, 10.4515],
  ["france", 46.2276, 2.2137],
  ["japan", 36.2048, 138.2529],
  ["australia", -25.2744, 133.7751],
  ["brazil", -14.235, -51.9253],
];

function log(...args) {
  process.stdout.write(args.join(" ") + "\n");
}

function warn(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

async function loadDatabase() {
  try {
    const { default: Database } = await import("better-sqlite3");
    return Database;
  } catch {
    throw new Error("Missing dependency: run `npm install` in the skills-book project before wiki commands.");
  }
}

async function openDb(dbPath) {
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const Database = await loadDatabase();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  ensureWiki(db);
  return db;
}

function initSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS wikis (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  page_type TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  start_offset INTEGER NOT NULL DEFAULT 0,
  end_offset INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'entity',
  source_id TEXT,
  page_id TEXT,
  confidence REAL NOT NULL DEFAULT 0.5
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_id TEXT,
  page_id TEXT,
  weight REAL NOT NULL DEFAULT 0.5
);
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.5,
  evidence TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repositories (
  full_name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  html_url TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  readme TEXT,
  skill_md TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS authors (
  login TEXT PRIMARY KEY,
  name TEXT,
  avatar_url TEXT,
  html_url TEXT,
  location TEXT,
  lat REAL,
  lon REAL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  url TEXT,
  github_repo TEXT,
  category TEXT,
  source TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  author_login TEXT,
  location_id TEXT,
  readme TEXT,
  readme_html TEXT,
  skill_md TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(wiki_id, page_type);
CREATE INDEX IF NOT EXISTS idx_pages_title ON pages(wiki_id, title);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(wiki_id, source_id);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(wiki_id, name);
CREATE INDEX IF NOT EXISTS idx_topics_name ON topics(wiki_id, name);
CREATE INDEX IF NOT EXISTS idx_relations_pair ON relations(wiki_id, source_id, target_id);
CREATE INDEX IF NOT EXISTS idx_skills_display ON skills(display_name);
CREATE INDEX IF NOT EXISTS idx_skills_repo ON skills(github_repo);
CREATE INDEX IF NOT EXISTS idx_skills_stars ON skills(stars DESC);
CREATE INDEX IF NOT EXISTS idx_locations_coords ON locations(lat, lon);
`);
}

function ensureWiki(db) {
  const now = new Date().toISOString();
  db.prepare(`
INSERT INTO wikis(id, name, description, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
`).run(DEFAULT_WIKI_ID, "Skills Book Wiki", "SQLite LLM Wiki built from public agent skills.", now, now);
}

function readCache() {
  if (!existsSync(CACHE_FILE)) return null;
  return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function slugify(value) {
  return String(value || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";
}

function skillSlug(skill) {
  return slugify(`${skill.owner || "unknown"}-${skill.name || skill.display_name}`);
}

function extractTags(text) {
  const tags = new Set();
  const keywords = [
    "agent", "llm", "frontend", "design", "python", "typescript", "javascript",
    "database", "testing", "security", "docker", "api", "github", "codex", "claude",
  ];
  const lower = String(text || "").toLowerCase();
  for (const keyword of keywords) if (lower.includes(keyword)) tags.add(keyword);
  for (const match of String(text || "").matchAll(/(?:^|\s)#([A-Za-z][A-Za-z0-9_-]{2,})/g)) tags.add(match[1].toLowerCase());
  return [...tags].slice(0, 14);
}

function chunkMarkdown(text, maxChunkSize = CHUNK_SIZE) {
  if (!text) return [""];
  const headingRe = /^(#{1,4})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRe.exec(text)) !== null) {
    headings.push({ level: match[1].length, title: match[2], index: match.index, length: match[0].length });
  }
  if (!headings.length) return chunkText(text, maxChunkSize);
  const chunks = [];
  let current = "";
  for (let i = 0; i < headings.length; i++) {
    const currentHeading = headings[i];
    const nextHeading = headings[i + 1];
    const start = currentHeading.index;
    const end = nextHeading ? nextHeading.index : text.length;
    const section = text.slice(start, end).trim();
    if (!section) continue;
    if (current.length + section.length + 2 <= maxChunkSize) {
      current = current ? `${current}\n\n${section}` : section;
    } else {
      if (current) chunks.push(current);
      current = section.length > maxChunkSize ? "" : section;
      if (section.length > maxChunkSize) chunks.push(...chunkText(section, maxChunkSize));
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : chunkText(text, maxChunkSize);
}

function chunkText(text, maxChunkSize = CHUNK_SIZE) {
  if (text.length <= maxChunkSize) return [text];
  const chunks = [];
  for (let start = 0; start < text.length;) {
    const end = Math.min(text.length, start + maxChunkSize);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += maxChunkSize - CHUNK_OVERLAP;
  }
  return chunks;
}

function countWords(text) {
  const latin = (text.match(/[A-Za-z0-9_]+/g) || []).length;
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  return latin + cjk;
}

function ingestSource(db, { title, sourcePath, sourceType = "markdown", content, pageType = "source", tags = [] }) {
  const now = new Date().toISOString();
  const sourceId = `src:${sha256(`${DEFAULT_WIKI_ID}:${sourcePath}`).slice(0, 24)}`;
  const pageId = `page:${sha256(`${DEFAULT_WIKI_ID}:${sourcePath}:${title}`).slice(0, 24)}`;
  const mergedTags = [...new Set([...tags, ...extractTags(content)])];
  db.prepare(`
INSERT INTO sources(id, wiki_id, title, source_path, source_type, content_hash, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, content_hash=excluded.content_hash, updated_at=excluded.updated_at
`).run(sourceId, DEFAULT_WIKI_ID, title, sourcePath, sourceType, sha256(content), now, now);
  db.prepare(`
INSERT INTO pages(id, wiki_id, source_id, title, path, page_type, content, tags, word_count, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, tags=excluded.tags, word_count=excluded.word_count, updated_at=excluded.updated_at
`).run(pageId, DEFAULT_WIKI_ID, sourceId, title, sourcePath, pageType, content, JSON.stringify(mergedTags), countWords(content), now, now);
  db.prepare("DELETE FROM chunks WHERE wiki_id = ? AND source_id = ?").run(DEFAULT_WIKI_ID, sourceId);
  const insertChunk = db.prepare(`
INSERT INTO chunks(id, wiki_id, source_id, page_id, chunk_index, heading, text, start_offset, end_offset, hash)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  chunkMarkdown(content).forEach((chunk, index) => {
    const heading = chunk.match(/^#{1,4}\s+(.+)$/m)?.[1] || "";
    insertChunk.run(`chunk:${sha256(`${pageId}:${index}:${chunk}`).slice(0, 24)}`, DEFAULT_WIKI_ID, sourceId, pageId, index, heading, chunk, 0, chunk.length, sha256(chunk));
  });
  return { sourceId, pageId };
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url);
  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithRetry(url);
  return response.text();
}

async function fetchWithRetry(url, retries = 2) {
  const headers = {};
  if (process.env.GITHUB_TOKEN && url.startsWith("https://api.github.com/")) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, { headers });
      if (response.ok) return response;
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt === retries) {
        if (url.startsWith("https://api.github.com/") || url.startsWith("https://raw.githubusercontent.com/")) {
          const proxied = `${GH_PROXY}/${url}`;
          const response = await fetchWithTimeout(proxied);
          if (response.ok) return response;
        }
        throw error;
      }
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 600 * (attempt + 1)));
    }
  }
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseTreeUrl(url) {
  const match = String(url || "").match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return {
    repo: `${match[1]}/${match[2]}`,
    branch: match[3],
    dir: match[4].replace(/^\/+|\/+$/g, ""),
  };
}

async function fetchRawCandidates(repo, candidates) {
  for (const candidate of candidates) {
    try {
      const text = await fetchText(`https://raw.githubusercontent.com/${repo}/${candidate.branch}/${candidate.path}`);
      if (text && !text.startsWith("404: Not Found")) return text;
    } catch {}
  }
  return "";
}

async function fetchRepoDocs(skill, skipNetwork) {
  if (skipNetwork || !skill.github_repo) {
    return { readme: fallbackReadme(skill), skillMd: "" };
  }
  const tree = parseTreeUrl(skill.url);
  const branches = [...new Set([tree?.branch, "main", "master"].filter(Boolean))];
  const readmeCandidates = [];
  const skillCandidates = [];
  for (const branch of branches) {
    if (tree?.dir) {
      readmeCandidates.push({ branch, path: `${tree.dir}/README.md` }, { branch, path: `${tree.dir}/readme.md` });
      skillCandidates.push({ branch, path: `${tree.dir}/SKILL.md` });
    }
    readmeCandidates.push({ branch, path: "README.md" }, { branch, path: "readme.md" });
    skillCandidates.push({ branch, path: "SKILL.md" });
  }
  const readme = await fetchRawCandidates(skill.github_repo, readmeCandidates);
  const skillMd = await fetchRawCandidates(skill.github_repo, skillCandidates);
  return {
    readme: readme || fallbackReadme(skill),
    skillMd,
  };
}

async function fetchAuthor(owner, skipNetwork) {
  const fallback = { login: owner, name: owner, avatar_url: "", html_url: `https://github.com/${owner}`, location: "" };
  if (skipNetwork || !owner) return fallback;
  try {
    const data = await fetchJson(`https://api.github.com/users/${owner}`);
    return {
      login: data.login || owner,
      name: data.name || data.login || owner,
      avatar_url: data.avatar_url || "",
      html_url: data.html_url || `https://github.com/${owner}`,
      location: data.location || "",
    };
  } catch {
    return fallback;
  }
}

function fallbackReadme(skill) {
  return `# ${skill.display_name || skill.name}\n\n${skill.description || "No README was available for this skill."}`;
}

function geocodeLocation(location) {
  const normalized = String(location || "").toLowerCase();
  if (!normalized) return null;
  const hit = LOCATION_COORDS.find(([name]) => normalized.includes(name));
  if (!hit) return null;
  return { id: slugify(hit[0]), label: location, lat: hit[1], lon: hit[2] };
}

function writeAuthor(db, author) {
  const coords = geocodeLocation(author.location);
  if (coords) {
    db.prepare(`
INSERT INTO locations(id, label, lat, lon)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET label=excluded.label, lat=excluded.lat, lon=excluded.lon
`).run(coords.id, coords.label, coords.lat, coords.lon);
  }
  db.prepare(`
INSERT INTO authors(login, name, avatar_url, html_url, location, lat, lon, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(login) DO UPDATE SET name=excluded.name, avatar_url=excluded.avatar_url, html_url=excluded.html_url, location=excluded.location, lat=excluded.lat, lon=excluded.lon, updated_at=excluded.updated_at
`).run(author.login, author.name, author.avatar_url, author.html_url, author.location, coords?.lat ?? null, coords?.lon ?? null, new Date().toISOString());
  return coords?.id ?? null;
}

function markdownToHtml(markdown) {
  const escaped = String(markdown || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split(/\r?\n/);
  const html = [];
  let inList = false;
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      html.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(`${line}\n`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    if (!line.trim()) continue;
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  if (inList) html.push("</ul>");
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

function inlineMarkdown(value) {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function upsertRelation(db, sourceId, targetId, relationType, weight, evidence) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const id = `rel:${sha256(`${sourceId}:${targetId}:${relationType}:${evidence}`).slice(0, 24)}`;
  db.prepare(`
INSERT INTO relations(id, wiki_id, source_id, target_id, relation_type, weight, evidence, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET weight=excluded.weight, evidence=excluded.evidence
`).run(id, DEFAULT_WIKI_ID, sourceId, targetId, relationType, weight, evidence, new Date().toISOString());
}

function rebuildRelations(db) {
  db.prepare("DELETE FROM relations WHERE wiki_id = ?").run(DEFAULT_WIKI_ID);
  const skills = db.prepare("SELECT id, display_name, category, author_login, github_repo, location_id FROM skills WHERE wiki_id = ?").all(DEFAULT_WIKI_ID);
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const a = skills[i];
      const b = skills[j];
      if (a.category && a.category === b.category) upsertRelation(db, a.id, b.id, "shared_tag", 0.55, a.category);
      if (a.author_login && a.author_login === b.author_login) upsertRelation(db, a.id, b.id, "source_overlap", 0.75, `author:${a.author_login}`);
      if (a.github_repo && a.github_repo === b.github_repo) upsertRelation(db, a.id, b.id, "source_overlap", 0.8, `repo:${a.github_repo}`);
      if (a.location_id && a.location_id === b.location_id) upsertRelation(db, a.id, b.id, "shared_tag", 0.45, `location:${a.location_id}`);
    }
  }
}

export async function cmdBuildWiki(args = []) {
  const cache = readCache();
  if (!cache?.skills) throw new Error("No skills cache found. Run `node scripts/skills-book.mjs fetch --force` first.");
  const dbPath = option(args, "--db", DEFAULT_DB_FILE);
  const limit = Number(option(args, "--limit", "0"));
  const skipNetwork = hasFlag(args, "--skip-network");
  const db = await openDb(dbPath);
  const skills = Object.values(cache.skills)
    .sort((a, b) => (b.stars || 0) - (a.stars || 0))
    .slice(0, limit > 0 ? limit : undefined);
  log(`Building Skills Wiki: ${skills.length} skills -> ${dbPath}`);
  const insertRepo = db.prepare(`
INSERT INTO repositories(full_name, owner, name, html_url, stars, readme, skill_md, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(full_name) DO UPDATE SET stars=excluded.stars, readme=excluded.readme, skill_md=excluded.skill_md, updated_at=excluded.updated_at
`);
  const insertSkill = db.prepare(`
INSERT INTO skills(id, wiki_id, owner, name, display_name, slug, description, url, github_repo, category, source, stars, author_login, location_id, readme, readme_html, skill_md, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, description=excluded.description, stars=excluded.stars, author_login=excluded.author_login, location_id=excluded.location_id, readme=excluded.readme, readme_html=excluded.readme_html, skill_md=excluded.skill_md, updated_at=excluded.updated_at
`);
  let count = 0;
  for (const skill of skills) {
    const slug = skillSlug(skill);
    const skillId = `skill:${slug}`;
    const owner = skill.owner || skill.github_repo?.split("/")[0] || "unknown";
    const repoName = skill.github_repo?.split("/")[1] || skill.name || slug;
    const [docs, author] = await Promise.all([
      fetchRepoDocs(skill, skipNetwork),
      fetchAuthor(owner, skipNetwork),
    ]);
    const locationId = writeAuthor(db, author);
    const now = new Date().toISOString();
    if (skill.github_repo) {
      insertRepo.run(skill.github_repo, owner, repoName, `https://github.com/${skill.github_repo}`, skill.stars || 0, docs.readme, docs.skillMd, now);
    }
    insertSkill.run(
      skillId,
      DEFAULT_WIKI_ID,
      owner,
      skill.name || repoName,
      skill.display_name || `${owner}/${repoName}`,
      slug,
      skill.description || "",
      skill.url || (skill.github_repo ? `https://github.com/${skill.github_repo}` : ""),
      skill.github_repo || "",
      skill.category || "Uncategorized",
      skill.source || "",
      skill.stars || 0,
      author.login,
      locationId,
      docs.readme,
      markdownToHtml(docs.readme),
      docs.skillMd,
      now,
      now,
    );
    ingestSource(db, {
      title: `${skill.display_name || slug} README`,
      sourcePath: `${slug}/README.md`,
      content: docs.readme,
      tags: [skill.category || "skill", owner],
    });
    if (docs.skillMd) {
      ingestSource(db, {
        title: `${skill.display_name || slug} SKILL`,
        sourcePath: `${slug}/SKILL.md`,
        content: docs.skillMd,
        tags: [skill.category || "skill", owner],
      });
    }
    count++;
    if (count % 25 === 0) log(`  ${count}/${skills.length} skills indexed...`);
  }
  rebuildRelations(db);
  const stats = {
    skills: db.prepare("SELECT COUNT(*) AS n FROM skills").get().n,
    pages: db.prepare("SELECT COUNT(*) AS n FROM pages").get().n,
    chunks: db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n,
    relations: db.prepare("SELECT COUNT(*) AS n FROM relations").get().n,
    locations: db.prepare("SELECT COUNT(*) AS n FROM locations").get().n,
  };
  log(`Done. skills=${stats.skills}, pages=${stats.pages}, chunks=${stats.chunks}, relations=${stats.relations}, locations=${stats.locations}`);
}

export async function cmdWikiQuery(args = []) {
  const query = args.filter((arg) => !arg.startsWith("--") && arg !== option(args, "--db")).join(" ").trim();
  if (!query) throw new Error("Usage: skills-book.mjs wiki-query <query> [--db path]");
  const db = await openDb(option(args, "--db", DEFAULT_DB_FILE));
  const like = `%${query}%`;
  const skills = db.prepare(`
SELECT slug, display_name, description, stars, category, github_repo
FROM skills
WHERE display_name LIKE ? OR description LIKE ? OR category LIKE ? OR readme LIKE ?
ORDER BY stars DESC
LIMIT 10
`).all(like, like, like, like);
  const pages = db.prepare(`
SELECT title, path, substr(content, 1, 220) AS snippet
FROM pages
WHERE title LIKE ? OR content LIKE ?
LIMIT 5
`).all(like, like);
  log(`\nSkills matching "${query}":\n`);
  for (const skill of skills) {
    log(`  ${skill.display_name.padEnd(38)} ${String(skill.stars || 0).padStart(6)}  ${skill.category}`);
    log(`  ${skill.description}`);
  }
  if (pages.length) {
    log(`\nWiki pages:\n`);
    for (const page of pages) log(`  ${page.title} (${page.path})\n  ${page.snippet.replace(/\s+/g, " ")}...`);
  }
}

function graphFromDb(db) {
  const skills = db.prepare("SELECT id, slug, display_name, stars, category, author_login, location_id FROM skills ORDER BY stars DESC").all();
  const edges = db.prepare("SELECT source_id AS source, target_id AS target, relation_type AS relation, weight, evidence FROM relations").all();
  return {
    nodes: skills.map((skill) => ({
      id: skill.id,
      slug: skill.slug,
      name: skill.display_name,
      type: "skill",
      stars: skill.stars,
      category: skill.category,
      author: skill.author_login,
      location: skill.location_id,
      degree: edges.filter((edge) => edge.source === skill.id || edge.target === skill.id).length,
    })),
    edges,
    communities: Object.entries(Object.groupBy(skills, (skill) => skill.category || "Uncategorized")).map(([category, nodes]) => ({
      id: slugify(category),
      label: category,
      nodeIds: nodes.map((node) => node.id),
    })),
    statistics: { totalNodes: skills.length, totalEdges: edges.length },
  };
}

export async function cmdWikiGraph(args = []) {
  const db = await openDb(option(args, "--db", DEFAULT_DB_FILE));
  const graph = graphFromDb(db);
  const out = option(args, "--out", null);
  if (out) {
    const outPath = resolve(out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(graph, null, 2), "utf8");
    log(`Wrote graph: ${outPath}`);
  } else {
    log(JSON.stringify(graph, null, 2));
  }
}

export async function cmdShopExport(args = []) {
  const outDir = args.find((arg) => !arg.startsWith("--")) || option(args, "--out", null);
  if (!outDir) throw new Error("Usage: skills-book.mjs shop-export <output-dir> [--db path]");
  const db = await openDb(option(args, "--db", DEFAULT_DB_FILE));
  const dataRoot = resolve(outDir);
  const skillDir = join(dataRoot, "skills-shop", "skills");
  mkdirSync(skillDir, { recursive: true });
  const rows = db.prepare(`
SELECT s.*, a.name AS author_name, a.avatar_url, a.html_url AS author_url, a.location AS author_location,
       l.label AS location_label, l.lat, l.lon
FROM skills s
LEFT JOIN authors a ON a.login = s.author_login
LEFT JOIN locations l ON l.id = s.location_id
ORDER BY s.stars DESC
`).all();
  const relatedBySkill = new Map();
  for (const edge of db.prepare("SELECT source_id, target_id, relation_type, weight, evidence FROM relations ORDER BY weight DESC").all()) {
    for (const [source, target] of [[edge.source_id, edge.target_id], [edge.target_id, edge.source_id]]) {
      if (!relatedBySkill.has(source)) relatedBySkill.set(source, []);
      relatedBySkill.get(source).push({ id: target, relation: edge.relation_type, weight: edge.weight, evidence: edge.evidence });
    }
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const locations = new Map();
  const skills = [];
  for (const row of rows) {
    const skill = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      stars: row.stars,
      category: row.category,
      source: row.source,
      url: row.url,
      githubRepo: row.github_repo,
      readme: row.readme || fallbackReadme(row),
      readmeHtml: row.readme_html || markdownToHtml(row.readme || fallbackReadme(row)),
      skillMd: row.skill_md,
      updatedAt: row.updated_at,
      author: {
        login: row.author_login,
        name: row.author_name || row.author_login,
        avatarUrl: row.avatar_url,
        profileUrl: row.author_url,
        location: row.author_location,
      },
      location: row.lat != null && row.lon != null ? {
        id: row.location_id,
        label: row.location_label || row.author_location,
        lat: row.lat,
        lon: row.lon,
      } : null,
      related: (relatedBySkill.get(row.id) || [])
        .map((item) => byId.get(item.id) && ({
          slug: byId.get(item.id).slug,
          displayName: byId.get(item.id).display_name,
          stars: byId.get(item.id).stars,
          relation: item.relation,
          evidence: item.evidence,
        }))
        .filter(Boolean)
        .slice(0, 8),
    };
    skills.push(skill);
    writeFileSync(join(skillDir, `${skill.slug}.json`), JSON.stringify(skill, null, 2), "utf8");
    if (skill.location) {
      const key = `${skill.location.lat.toFixed(4)},${skill.location.lon.toFixed(4)}`;
      if (!locations.has(key)) {
        locations.set(key, { ...skill.location, key, skills: [] });
      }
      locations.get(key).skills.push({
        slug: skill.slug,
        displayName: skill.displayName,
        stars: skill.stars,
        category: skill.category,
        description: skill.description,
      });
    }
  }
  const mapLocations = [...locations.values()].map((location) => {
    location.skills.sort((a, b) => (b.stars || 0) - (a.stars || 0));
    return { ...location, topSkill: location.skills[0], skillCount: location.skills.length };
  }).sort((a, b) => (b.topSkill?.stars || 0) - (a.topSkill?.stars || 0));
  const mapPayload = {
    generatedAt: new Date().toISOString(),
    totalSkills: skills.length,
    mappedSkills: mapLocations.reduce((sum, location) => sum + location.skills.length, 0),
    locations: mapLocations,
  };
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(join(dataRoot, "skills-shop-map.json"), JSON.stringify(mapPayload, null, 2), "utf8");
  writeFileSync(join(dataRoot, "skills-shop", "graph.json"), JSON.stringify(graphFromDb(db), null, 2), "utf8");
  log(`Exported Skills Shop data: ${dataRoot}`);
  log(`  skills=${skills.length}, mappedLocations=${mapLocations.length}`);
}
