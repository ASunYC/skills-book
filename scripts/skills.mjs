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
  refresh: "fetch",
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
    .replace(/^\/?skills[:\s-]*/, "");
}

function printHelp() {
  console.log(`
Skills Book command wrapper

Usage:
  skills <command> [args]

Agent slash command:
  /skills <command> [args]

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
  add/remove/update        Manage local skills index
  build-wiki [--limit N]   Build skills.db
  wiki-query <query>       Query the Skills Wiki
  wiki-graph [--out file]  Export graph JSON
  shop-export <dir>        Export Skills Shop static data

Examples:
  /skills fetch --force
  /skills search "testing"
  /skills top 20
  /skills install "stripe/reasoning"
  /skills build-wiki
  /skills wiki-query "frontend design"
`);
}
