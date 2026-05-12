import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import crypto from "node:crypto";

const CACHE_DIR = join(homedir(), ".claude", "skills-book", "cache");
const CACHE_FILE = join(CACHE_DIR, "skills-index.json");
const CONFIG_FILE = join(CACHE_DIR, "config.json");
const DEFAULT_DB_FILE = join(CACHE_DIR, "skills.db");
const DEFAULT_WIKI_ID = "default";
const DOCS_DIR = join(CACHE_DIR, "wiki-docs");
const GH_PROXY = "https://gh-proxy.org";
const FETCH_TIMEOUT_MS = 8000;
const LLM_WIKI_REPO = "https://github.com/ASunYC/llm-wiki-build-skill.git";
const LLM_WIKI_SKILL_NAME = "llm-wiki-build-skill";

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
  process.stdout.write(`${args.join(" ")}\n`);
}

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function ensureCacheDir() {
  mkdirSync(CACHE_DIR, { recursive: true });
}

function readCache() {
  if (!existsSync(CACHE_FILE)) return null;
  return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
}

function readConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  ensureCacheDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

async function resolveDbPath(args, { save = true } = {}) {
  const explicit = option(args, "--db", null);
  if (explicit) {
    const dbPath = resolve(explicit);
    if (save) writeConfig({ ...readConfig(), skillsDbPath: dbPath });
    return dbPath;
  }
  const config = readConfig();
  if (config.skillsDbPath) return config.skillsDbPath;
  const envPath = process.env.SKILLS_BOOK_DB;
  if (envPath) {
    const dbPath = resolve(envPath);
    if (save) writeConfig({ ...config, skillsDbPath: dbPath });
    return dbPath;
  }
  const defaultPath = DEFAULT_DB_FILE;
  let dbPath = defaultPath;
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`首次构建 Skills Wiki，请输入 skills.db 存储路径（默认 ${defaultPath}）：`);
    rl.close();
    if (answer.trim()) dbPath = resolve(answer.trim());
  } else {
    log(`首次构建 Skills Wiki，使用默认数据库路径：${defaultPath}`);
  }
  if (save) writeConfig({ ...config, skillsDbPath: dbPath });
  return dbPath;
}

function resolveLlmWikiSkill() {
  for (const candidate of llmWikiCandidates()) {
    if (isLlmWikiSkill(candidate)) return candidate;
  }
  return installLlmWikiSkill();
}

function llmWikiCandidates() {
  return [
    process.env.SKILLS_BOOK_LLM_WIKI_PATH,
    join(homedir(), ".claude", "skills", LLM_WIKI_SKILL_NAME),
    join(homedir(), ".codex", "skills", LLM_WIKI_SKILL_NAME),
    join(homedir(), ".opencode", "skills", LLM_WIKI_SKILL_NAME),
    resolve(process.cwd(), "..", LLM_WIKI_SKILL_NAME),
    resolve(process.cwd(), LLM_WIKI_SKILL_NAME),
  ].filter(Boolean);
}

function isLlmWikiSkill(dir) {
  return existsSync(join(dir, "SKILL.md")) && existsSync(join(dir, "scripts", "llm-wiki.mjs"));
}

function installLlmWikiSkill() {
  const root = chooseAgentSkillRoot();
  const target = join(root, LLM_WIKI_SKILL_NAME);
  if (existsSync(target) && !isLlmWikiSkill(target)) {
    throw new Error(`llm-wiki-build-skill install target already exists but is not valid: ${target}`);
  }
  if (!existsSync(target)) {
    mkdirSync(root, { recursive: true });
    log(`未检测到 llm-wiki-build-skill，正在安装到 Agent 技能目录：${target}`);
    run("git", ["clone", "--depth", "1", LLM_WIKI_REPO, target], { cwd: root });
  }
  if (!existsSync(join(target, "node_modules", "better-sqlite3"))) {
    log("正在安装 llm-wiki-build-skill 依赖...");
    run("npm", ["install"], { cwd: target });
  }
  return target;
}

function chooseAgentSkillRoot() {
  const roots = [
    process.env.CLAUDE_SKILLS_DIR,
    process.env.CODEX_SKILLS_DIR,
    process.env.OPENCODE_SKILLS_DIR,
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".codex", "skills"),
    join(homedir(), ".opencode", "skills"),
  ].filter(Boolean);
  return roots.find((root) => existsSync(root)) || join(homedir(), ".claude", "skills");
}

function run(command, args, { cwd = process.cwd(), stdio = "inherit" } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio,
    shell: process.platform === "win32" && ["git", "npm"].includes(command),
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
  return result;
}

function runLlmWiki(skillDir, args, options = {}) {
  const script = join(skillDir, "scripts", "llm-wiki.mjs");
  run(process.execPath, [script, ...args], options);
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
  if (!existsSync(dbPath)) throw new Error(`Skills Wiki database not found: ${dbPath}. Run build-wiki first.`);
  const Database = await loadDatabase();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
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

function writeSkillDocs(root, skill, docs) {
  const slug = skillSlug(skill);
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), docs.readme || fallbackReadme(skill), "utf8");
  if (docs.skillMd) writeFileSync(join(dir, "SKILL.md"), docs.skillMd, "utf8");
}

function resetDocsDir() {
  const resolved = resolve(DOCS_DIR);
  const cacheRoot = resolve(CACHE_DIR);
  if (!resolved.startsWith(cacheRoot)) throw new Error(`Refusing to clear docs outside cache: ${resolved}`);
  rmSync(resolved, { recursive: true, force: true });
  mkdirSync(resolved, { recursive: true });
  return resolved;
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

function upsertRelation(db, sourceId, targetId, relationType, weight, evidence) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const id = `rel:${sha256(`${sourceId}:${targetId}:${relationType}:${evidence}`).slice(0, 24)}`;
  const now = new Date().toISOString();
  db.prepare(`
INSERT INTO relations(id, wiki_id, source_id, target_id, relation_type, weight, evidence, confidence, evidence_details, properties, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET weight=excluded.weight, evidence=excluded.evidence, updated_at=excluded.updated_at
`).run(id, DEFAULT_WIKI_ID, sourceId, targetId, relationType, weight, evidence, "INFERRED", "[]", "{}", now, now);
}

function rebuildRelations(db) {
  db.prepare("DELETE FROM relations WHERE wiki_id = ? AND source_id LIKE 'skill:%' AND target_id LIKE 'skill:%'").run(DEFAULT_WIKI_ID);
  const skills = db.prepare("SELECT id, category, author_login, github_repo, location_id FROM skills WHERE wiki_id = ?").all(DEFAULT_WIKI_ID);
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

function graphFromSkillsDb(db) {
  const skills = db.prepare("SELECT id, slug, display_name, stars, category, author_login, location_id FROM skills ORDER BY stars DESC").all();
  const edges = db.prepare("SELECT source_id AS source, target_id AS target, relation_type AS relation, weight, evidence FROM relations WHERE source_id LIKE 'skill:%' AND target_id LIKE 'skill:%'").all();
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

export async function cmdBuildWiki(args = []) {
  const cache = readCache();
  if (!cache?.skills) throw new Error("No skills cache found. Run `node scripts/skills-book.mjs fetch --force` first.");
  const dbPath = await resolveDbPath(args);
  const limit = Number(option(args, "--limit", "0"));
  const skipNetwork = hasFlag(args, "--skip-network");
  const extract = hasFlag(args, "--extract");
  const llmWikiDir = resolveLlmWikiSkill();
  const docsRoot = resetDocsDir();
  const skills = Object.values(cache.skills)
    .sort((a, b) => (b.stars || 0) - (a.stars || 0))
    .slice(0, limit > 0 ? limit : undefined);

  log(`Building Skills Wiki through llm-wiki-build-skill: ${skills.length} skills -> ${dbPath}`);
  runLlmWiki(llmWikiDir, ["init", dbPath, "--name", "Skills Book Wiki", "--description", "SQLite LLM Wiki built from public agent skills."]);

  const records = [];
  let count = 0;
  for (const skill of skills) {
    const owner = skill.owner || skill.github_repo?.split("/")[0] || "unknown";
    const [docs, author] = await Promise.all([
      fetchRepoDocs(skill, skipNetwork),
      fetchAuthor(owner, skipNetwork),
    ]);
    writeSkillDocs(docsRoot, skill, docs);
    records.push({ skill, docs, author });
    count++;
    if (count % 25 === 0) log(`  ${count}/${skills.length} skill documents prepared...`);
  }

  runLlmWiki(llmWikiDir, ["ingest", dbPath, docsRoot]);
  if (extract) runLlmWiki(llmWikiDir, ["extract", dbPath, "--depth", option(args, "--depth", "standard")]);

  const db = await openDb(dbPath);
  const insertRepo = db.prepare(`
INSERT INTO repositories(full_name, owner, name, html_url, stars, readme, skill_md, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(full_name) DO UPDATE SET stars=excluded.stars, readme=excluded.readme, skill_md=excluded.skill_md, updated_at=excluded.updated_at
`);
  const insertSkill = db.prepare(`
INSERT INTO skills(id, wiki_id, owner, name, display_name, slug, description, url, github_repo, category, source, stars, author_login, location_id, readme, skill_md, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, description=excluded.description, stars=excluded.stars, author_login=excluded.author_login, location_id=excluded.location_id, readme=excluded.readme, skill_md=excluded.skill_md, updated_at=excluded.updated_at
`);
  for (const { skill, docs, author } of records) {
    const slug = skillSlug(skill);
    const skillId = `skill:${slug}`;
    const owner = skill.owner || skill.github_repo?.split("/")[0] || "unknown";
    const repoName = skill.github_repo?.split("/")[1] || skill.name || slug;
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
      docs.skillMd,
      now,
      now,
    );
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
  const dbPath = await resolveDbPath(args, { save: false });
  const query = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--db" && args[index - 1] !== "--limit").join(" ").trim();
  if (!query) throw new Error("Usage: skills-book.mjs wiki-query <query> [--db path]");
  const llmWikiDir = resolveLlmWikiSkill();
  runLlmWiki(llmWikiDir, ["query", dbPath, query, "--limit", option(args, "--limit", "12")]);
}

export async function cmdWikiGraph(args = []) {
  const dbPath = await resolveDbPath(args, { save: false });
  const llmWikiDir = resolveLlmWikiSkill();
  const out = option(args, "--out", null);
  const commandArgs = out ? ["graph", dbPath, "--out", out] : ["graph", dbPath];
  runLlmWiki(llmWikiDir, commandArgs);
}

export async function cmdShopExport(args = []) {
  const outDir = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--db") || option(args, "--out", null);
  if (!outDir) throw new Error("Usage: skills-book.mjs shop-export <output-dir> [--db path]");
  const db = await openDb(await resolveDbPath(args, { save: false }));
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
  for (const edge of db.prepare("SELECT source_id, target_id, relation_type, weight, evidence FROM relations WHERE source_id LIKE 'skill:%' AND target_id LIKE 'skill:%' ORDER BY weight DESC").all()) {
    for (const [source, target] of [[edge.source_id, edge.target_id], [edge.target_id, edge.source_id]]) {
      if (!relatedBySkill.has(source)) relatedBySkill.set(source, []);
      relatedBySkill.get(source).push({ id: target, relation: edge.relation_type, weight: edge.weight, evidence: edge.evidence });
    }
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const locations = new Map();
  const skills = [];
  for (const row of rows) {
    const readme = row.readme || fallbackReadme(row);
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
      readme,
      readmeHtml: markdownToHtml(readme),
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
      if (!locations.has(key)) locations.set(key, { ...skill.location, key, skills: [] });
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
  writeFileSync(join(dataRoot, "skills-shop", "graph.json"), JSON.stringify(graphFromSkillsDb(db), null, 2), "utf8");
  log(`Exported Skills Shop data: ${dataRoot}`);
  log(`  skills=${skills.length}, mappedLocations=${mapLocations.length}`);
}
