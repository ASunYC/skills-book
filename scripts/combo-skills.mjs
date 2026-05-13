import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const COMBOS_FILE = join(here, "..", "data", "combo-skills.json");

function log(...args) {
  process.stdout.write(`${args.join(" ")}\n`);
}

export function loadComboCatalog() {
  return JSON.parse(readFileSync(COMBOS_FILE, "utf8"));
}

export function loadCombos() {
  return loadComboCatalog().combos || [];
}

export function comboCategories() {
  const catalog = loadComboCatalog();
  return new Map((catalog.categories || []).map((category) => [category.id, category]));
}

export function comboSlug(combo) {
  return String(combo.id || combo.title || "combo")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "combo";
}

function categoryLabel(categoryId) {
  return comboCategories().get(categoryId)?.name || categoryId || "Uncategorized";
}

function matchesCombo(combo, query) {
  const q = String(query || "").toLowerCase();
  if (!q) return true;
  return [
    combo.id,
    combo.title,
    combo.category,
    combo.summary,
    ...(combo.components || []).map((item) => `${item.name} ${item.type} ${item.description}`),
  ].some((value) => String(value || "").toLowerCase().includes(q));
}

export function comboToMarkdown(combo) {
  const lines = [
    `# ${combo.title}`,
    "",
    `> ${combo.summary || ""}`,
    "",
    `- Category: ${categoryLabel(combo.category)}`,
    `- Audience: ${combo.audience || "Agent CLI users"}`,
    `- Combo ID: ${combo.id}`,
    "",
    "## Components",
    "",
  ];

  for (const component of combo.components || []) {
    lines.push(`### ${component.name}`);
    lines.push("");
    lines.push(`- Type: ${component.type || "Tool"}`);
    if (String(component.install || "").includes("\n")) {
      lines.push("- Install:");
      lines.push("");
      lines.push("```bash");
      lines.push(component.install || "");
      lines.push("```");
    } else {
      lines.push(`- Install: \`${component.install || ""}\``);
    }
    lines.push(`- Purpose: ${component.description || ""}`);
    if (component.why) lines.push(`- Why it helps: ${component.why}`);
    for (const note of component.notes || []) lines.push(`- Note: ${note}`);
    lines.push("");
  }

  if (combo.workflow?.length) {
    lines.push("## Recommended Workflow");
    lines.push("");
    combo.workflow.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    lines.push("");
  }

  if (combo.prompt) {
    lines.push("## Agent Prompt");
    lines.push("");
    lines.push("```text");
    lines.push(combo.prompt);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

export function comboAsSkill(combo) {
  const slug = comboSlug(combo);
  return {
    id: `skill:combo-${slug}`,
    owner: "skills-book",
    name: slug,
    display_name: combo.title,
    slug: `combo-${slug}`,
    description: combo.summary || "",
    url: `skills-book://combo/${slug}`,
    github_repo: "",
    category: `Combo Skills / ${categoryLabel(combo.category)}`,
    source: "built-in-combo",
    stars: 0,
    author_login: "skills-book",
    readme: comboToMarkdown(combo),
    skill_md: "",
  };
}

export function combosAsSkills() {
  return loadCombos().map(comboAsSkill);
}

export function writeComboDocs(root) {
  const comboRoot = join(root, "_combo-skills");
  mkdirSync(comboRoot, { recursive: true });
  const written = [];
  for (const combo of loadCombos()) {
    const dir = join(comboRoot, comboSlug(combo));
    mkdirSync(dir, { recursive: true });
    const readme = comboToMarkdown(combo);
    const file = join(dir, "README.md");
    writeFileSync(file, readme, "utf8");
    written.push({ combo, file, readme });
  }
  return written;
}

export function comboExportPayload() {
  const categories = [...comboCategories().values()];
  const combos = loadCombos().map((combo) => ({
    ...combo,
    slug: `combo-${comboSlug(combo)}`,
    categoryName: categoryLabel(combo.category),
    readme: comboToMarkdown(combo),
  }));
  return {
    generatedAt: new Date().toISOString(),
    categories,
    combos,
  };
}

export function printComboHighlights({ limit = 3 } = {}) {
  const combos = loadCombos().slice(0, limit);
  if (!combos.length) return;
  log("Recommended skill/tool combos:");
  for (const combo of combos) {
    const names = (combo.components || []).map((item) => item.name).join(" + ");
    log(`  ${categoryLabel(combo.category)} / ${combo.title}`);
    log(`    ${names}`);
    log(`    ${combo.summary}`);
    log(`    Details: skills-book.mjs combos show ${combo.id}`);
  }
}

function printComboList(combos) {
  if (!combos.length) {
    log("No matching skill/tool combos found.");
    return;
  }
  const categories = comboCategories();
  const grouped = Map.groupBy(combos, (combo) => combo.category || "uncategorized");
  for (const [categoryId, items] of grouped) {
    const category = categories.get(categoryId);
    log(`\n${category?.name || categoryId}`);
    if (category?.description) log(`  ${category.description}`);
    for (const combo of items) {
      const names = (combo.components || []).map((item) => item.name).join(" + ");
      log(`  - ${combo.title} (${combo.id})`);
      log(`    ${names}`);
      log(`    ${combo.summary || ""}`);
    }
  }
  log("\nDetails: skills-book.mjs combos show <combo-id>");
}

function printComboDetail(combo) {
  log(`\n${combo.title}`);
  log(`Category: ${categoryLabel(combo.category)}`);
  log(`ID: ${combo.id}`);
  log(`Summary: ${combo.summary || ""}`);
  if (combo.audience) log(`Audience: ${combo.audience}`);

  log("\nInstall and purpose:");
  for (const [index, component] of (combo.components || []).entries()) {
    log(`${index + 1}. ${component.name} (${component.type || "Tool"})`);
    const installLines = String(component.install || "").split("\n");
    log(`   Install: ${installLines[0] || ""}`);
    for (const line of installLines.slice(1)) log(`         ${line}`);
    log(`   Purpose: ${component.description || ""}`);
    if (component.why) log(`   Why it helps: ${component.why}`);
    for (const note of component.notes || []) log(`   Note: ${note}`);
  }

  if (combo.workflow?.length) {
    log("\nRecommended workflow:");
    combo.workflow.forEach((step, index) => log(`  ${index + 1}. ${step}`));
  }
  if (combo.prompt) {
    log("\nAgent prompt:");
    log(combo.prompt);
  }
}

export function cmdCombos(args = []) {
  const [action, ...rest] = args;
  const combos = loadCombos();

  if (!action || action === "list" || action === "categories") {
    const query = rest.join(" ").trim();
    printComboList(query ? combos.filter((combo) => matchesCombo(combo, query)) : combos);
    return;
  }

  if (action === "show" || action === "info" || action === "detail") {
    const id = rest.join(" ").trim();
    const combo = combos.find((item) => item.id === id || comboSlug(item) === id || item.title === id);
    if (!combo) throw new Error(`Combo not found: ${id}`);
    printComboDetail(combo);
    return;
  }

  const filtered = combos.filter((combo) => combo.category === action || matchesCombo(combo, [action, ...rest].join(" ")));
  printComboList(filtered);
}

export function hasComboData() {
  return existsSync(COMBOS_FILE);
}
