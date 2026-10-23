import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { Widget } from "./catalog.js";
import { addWidget, findEtsRoot, type AddResult } from "./importer.js";

/**
 * Ready-made pages (templates/*.ets) built from catalog widgets. Each one compiles as-is once its
 * widgets are added; add_template writes the page, adds the widgets and registers the route.
 */
export interface Template {
  id: string;
  file: string;
  title: string;
  platform: string;
  description: string;
  tags: string[];
  widgets: string[];
}

let index: Template[] | null = null;

export function allTemplates(): Template[] {
  index ??= (JSON.parse(readFileSync(new URL("../templates/index.json", import.meta.url), "utf8")) as { templates: Template[] })
    .templates;
  return index;
}

export function templateCode(t: Template): string {
  return readFileSync(new URL(`../templates/${t.file}`, import.meta.url), "utf8");
}

/** By id, title or page struct name, ignoring case and spaces/dashes. */
export function findTemplate(key: string): Template | undefined {
  const k = key.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const norm = (s: string) => s.toLowerCase().replace(/[\s_&/-]+/g, "");
  return allTemplates().find((t) => norm(t.id) === k || norm(t.title) === k || norm(basename(t.file, ".ets")) === k);
}

export function searchTemplates(opts: { query?: string; platform?: string }): Template[] {
  const terms = (opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const platform = opts.platform?.toLowerCase();
  const scored: { t: Template; score: number }[] = [];
  for (const t of allTemplates()) {
    if (platform && t.platform.toLowerCase() !== platform) continue;
    let score = 0;
    for (const term of terms) {
      const s =
        (t.id.includes(term) || t.title.toLowerCase().includes(term) ? 5 : 0) +
        (t.tags.some((x) => x.includes(term)) ? 3 : 0) +
        (t.widgets.some((w) => w.toLowerCase().includes(term)) ? 2 : 0) +
        (t.description.toLowerCase().includes(term) ? 1 : 0);
      if (s === 0) {
        score = -1;
        break;
      }
      score += s;
    }
    if (score >= 0) scored.push({ t, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.t);
}

/** `pages/Fitness` style route of [file] relative to its ets root. */
function routeOf(etsRoot: string, file: string): string {
  const rel = relative(etsRoot, file).split(sep).join("/");
  return rel.slice(0, rel.length - extname(rel).length);
}

/** Struct name for a page file: `my_fitness-page.ets` → `MyFitnessPage`. */
export function structNameFor(file: string): string | null {
  const name = basename(file, extname(file))
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
  return /^[A-Za-z_]\w*$/.test(name) ? name : null;
}

/** Adds [route] to the module's main_pages.json. */
function registerRoute(etsRoot: string, route: string): "added" | "present" | "no-profile" {
  const profile = join(dirname(etsRoot), "resources", "base", "profile", "main_pages.json");
  if (!existsSync(profile)) return "no-profile";
  const text = readFileSync(profile, "utf8");
  let json: { src?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    return "no-profile";
  }
  const src = Array.isArray(json.src) ? (json.src as string[]) : [];
  if (src.includes(route)) return "present";
  json.src = [...src, route];
  writeFileSync(profile, JSON.stringify(json, null, 2) + "\n");
  return "added";
}

export interface TemplateResult {
  pageFile: string;
  /** created | unchanged | replaced */
  pageStatus: "created" | "unchanged" | "replaced";
  structName: string;
  route: string;
  routeStatus: "added" | "present" | "no-profile";
  widgets: { name: string; result: AddResult }[];
}

/**
 * Writes [template]'s page to [targetFile] (struct renamed after the file), adds every widget it
 * uses with add_widget's rules, and registers the page in main_pages.json.
 */
export function addTemplate(
  template: Template,
  widgets: Widget[],
  targetFile: string,
  overwrite: boolean,
  find: (widgets: Widget[], name: string) => Widget | undefined,
): TemplateResult {
  if (!targetFile.endsWith(".ets")) throw new Error("target_file must be an .ets file.");
  const etsRoot = findEtsRoot(targetFile);
  if (!etsRoot) throw new Error("target_file must be inside a HarmonyOS module's src/main/ets folder.");

  // Resolve everything before writing anything.
  const needed = template.widgets.map((name) => {
    const w = find(widgets, name);
    if (!w || !w.info) throw new Error(`Template widget ${name} is not in the catalog right now; try again later.`);
    return w;
  });

  const original = templateCode(template);
  const fromName = basename(template.file, ".ets");
  const structName = structNameFor(targetFile) ?? fromName;
  const code = original.replace(new RegExp(`\\bstruct ${fromName}\\b`), `struct ${structName}`);

  let pageStatus: TemplateResult["pageStatus"];
  if (!existsSync(targetFile)) {
    mkdirSync(dirname(targetFile), { recursive: true });
    writeFileSync(targetFile, code);
    pageStatus = "created";
  } else {
    const current = readFileSync(targetFile, "utf8");
    // add_template run again: the page already holds this template (plus the imports it added).
    const withoutImports = current.replace(/^import\b[\s\S]*?['"][^'"\n]+['"];?\n/gm, "");
    if (withoutImports.trim() === code.trim()) {
      pageStatus = "unchanged";
    } else if (overwrite) {
      writeFileSync(targetFile, code);
      pageStatus = "replaced";
    } else {
      throw new Error(`${targetFile} already exists. Pass overwrite: true to replace it, or choose a new file name.`);
    }
  }

  const added = needed.map((w) => ({ name: w.info!.name, result: addWidget(w, targetFile, false) }));
  const route = routeOf(etsRoot, targetFile);
  return { pageFile: targetFile, pageStatus, structName, route, routeStatus: registerRoute(etsRoot, route), widgets: added };
}

/** The page's @State fields, so the caller knows what to wire without reading the file. */
export function stateFields(code: string): string[] {
  return [...code.matchAll(/@State\s+(\w+)\s*:\s*([^=\n]+?)\s*=\s*([^\n]+)/g)].map(([, n, t, v]) => `${n}: ${t.trim()} = ${v.trim()}`);
}
