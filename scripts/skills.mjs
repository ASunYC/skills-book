#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();

const COMMAND_ALIASES = {
  cat: "categories",
  category: "categories",
  ls: "list",
  find: "search",
  detail: "info",
  details: "info",
  get: "info",
  popular: "top",
  agent: "agents",
  agents: "agents",
  "agent-search": "agents",
  "agent-top": "agents",
  "agent-rank": "agents",
  refresh: "fetch",
  combo: "combos",
  combos: "combos",
  "combo-search": "combos",
  rec: "combos",
  recommend: "combos",
  recommendations: "combos",
  graph: "wiki-graph",
  wiki: "build-wiki",
  query: "wiki-query",
  export: "shop-export",
};

const argv = process.argv.slice(2);
let [commandRaw, ...rawArgs] = argv;
let command = normalizeCommand(commandRaw);

if (!command && rawArgs.length > 0) {
  commandRaw = rawArgs.shift();
  command = normalizeCommand(commandRaw);
}

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

const canonicalCommand = COMMAND_ALIASES[command] || command;
const result = spawnSync(process.execPath, [path.join(here, "skills-book.mjs"), canonicalCommand, ...rawArgs], {
  cwd,
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);

function normalizeCommand(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\/?skills-book[:\s-]*/, "");
}

function printHelp() {
  console.log(`
Skills Book command wrapper

Usage:
  skills-book <command> [args]

Agent slash command:
  /skills-book <command> [args]

Commands:
  fetch [--force]          Download and cache the public skills index
  categories               List categories
  list <category>          List skills in a category
  search <query>           Search skills
  top [N]                  Show top skills by GitHub stars
  info <owner/name>        Show skill details
  install <owner/name>     Install a skill
  uninstall <name>         Uninstall a skill
  discover                 Discover new GitHub skills
  agents discover          Build a separate AI agent/tool index
  agents search <query>    Search AI agent/tool repos
  agents top [N]           Show AI agent/tool repo ranking
  add/remove/update        Manage local skills index
  combos [query]           Search recommended skill/tool combos
  combos show <combo-id>   Show combo install steps and workflow
  build-wiki [--limit N] [--db file] [--extract]
                           Build skills.db through llm-wiki-build-skill
  wiki-query <query>       Query via llm-wiki-build-skill
  wiki-graph [--out file]  Export graph JSON via llm-wiki-build-skill
  shop-export <dir>        Export Skills Shop static data

Examples:
  /skills-book fetch --force
  /skills-book search "testing"
  /skills-book top 20
  /skills-book install "stripe/reasoning"
  /skills-book agents discover
  /skills-book agents top 20
  /skills-book agents search "OpenCLI"
  /skills-book combos
  /skills-book recommend security
  /skills-book combos show coding-research-docs-ui
  /skills-book build-wiki
  /skills-book wiki-query "frontend design"
`);
}
