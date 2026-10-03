import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { callText, ensureExported } from "./parser.js";
import type { Widget } from "./catalog.js";

const COMPONENTS_DIR = "components";

/** `<module>/src/main/ets` containing [file], or null when it is not inside an ArkTS module. */
export function findEtsRoot(file: string): string | null {
  let dir = dirname(file);
  while (true) {
    const parent = dirname(dir);
    if (basename(dir) === "ets" && basename(parent) === "main" && basename(dirname(parent)) === "src") return dir;
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Module path for an import, e.g. `../components/Foo` (no extension, always starts with `.`). */
export function importPath(fromFile: string, targetFile: string): string {
  let rel = relative(dirname(fromFile), targetFile).split(sep).join("/");
  rel = rel.slice(0, rel.length - extname(rel).length);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

const sameCode = (a: string, b: string) => a.replace(/\r\n?/g, "\n").trim() === b.replace(/\r\n?/g, "\n").trim();

/** Adds the import after the file's last top-level import, unless the name is imported already. */
export function addImport(text: string, name: string, path: string): { text: string; added: boolean } {
  if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*}\\s*from`).test(text)) return { text, added: false };
  const statement = `import { ${name} } from '${path}'`;
  // Up to the first quoted module path, so a multi-line `import {\n a\n} from 'x'` counts as one.
  const imports = [...text.matchAll(/^import\b[\s\S]*?['"][^'"\n]+['"];?/gm)];
  const last = imports.at(-1);
  if (last) {
    const at = last.index! + last[0].length;
    return { text: `${text.slice(0, at)}\n${statement}${text.slice(at)}`, added: true };
  }
  return { text: `${statement}\n${text.startsWith("\n") ? "" : "\n"}${text}`, added: true };
}

export interface AddResult {
  componentFile: string;
  /** created | unchanged (identical file existed) | kept (different file existed, not overwritten) | replaced */
  fileStatus: "created" | "unchanged" | "kept" | "replaced";
  importStatement: string;
  /** added | present (already imported) | not-written (target file does not exist yet) */
  importStatus: "added" | "present" | "not-written";
  call: string;
  missingResources: string[];
}

/**
 * Saves [widget]'s component as `<module>/src/main/ets/components/<Name>.ets` and imports it into
 * [targetFile] (an .ets file inside that module). Mirrors the IDE plugin's "Add to code".
 */
export function addWidget(widget: Widget, targetFile: string, overwrite: boolean): AddResult {
  const info = widget.info;
  if (!info) throw new Error(`"${widget.title}" is a plain snippet, not a @Component struct; use get_widget and paste its code.`);
  if (!targetFile.endsWith(".ets")) throw new Error("target_file must be an .ets file.");
  const etsRoot = findEtsRoot(targetFile);
  if (!etsRoot) throw new Error("target_file must be inside a HarmonyOS module's src/main/ets folder.");

  const componentFile = join(etsRoot, COMPONENTS_DIR, `${info.name}.ets`);
  if (componentFile === targetFile) throw new Error(`target_file is ${info.name}.ets itself.`);
  const code = ensureExported(widget.code, info).trimEnd() + "\n";

  let fileStatus: AddResult["fileStatus"];
  if (!existsSync(componentFile)) {
    mkdirSync(dirname(componentFile), { recursive: true });
    writeFileSync(componentFile, code);
    fileStatus = "created";
  } else if (sameCode(readFileSync(componentFile, "utf8"), code)) {
    fileStatus = "unchanged";
  } else if (overwrite) {
    writeFileSync(componentFile, code);
    fileStatus = "replaced";
  } else {
    fileStatus = "kept";
  }

  const path = importPath(targetFile, componentFile);
  const importStatement = `import { ${info.name} } from '${path}'`;
  let importStatus: AddResult["importStatus"] = "not-written";
  if (existsSync(targetFile)) {
    const result = addImport(readFileSync(targetFile, "utf8"), info.name, path);
    if (result.added) writeFileSync(targetFile, result.text);
    importStatus = result.added ? "added" : "present";
  }

  return {
    componentFile,
    fileStatus,
    importStatement,
    importStatus,
    call: callText(info),
    missingResources: missingResources(widget.code, etsRoot),
  };
}

const resourceRef = /\$r\(\s*['"]app\.(\w+)\.([\w.]+)['"]\s*\)/g;
const rawfileRef = /\$rawfile\(\s*['"]([^'"]+)['"]\s*\)/g;
const elementTypes = new Set(["color", "string", "float", "integer", "boolean", "plural", "strarray", "intarray", "pattern"]);

/** `$r('app.…')` / `$rawfile()` references the module cannot resolve (same rules as the plugin). */
export function missingResources(code: string, etsRoot: string): string[] {
  const resources = join(dirname(etsRoot), "resources");
  if (!existsSync(resources)) return [];
  const qualifiers = readdirSync(resources, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "rawfile")
    .map((d) => join(resources, d.name));
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const [, type, name] of code.matchAll(resourceRef)) {
    if (seen.has(`${type}.${name}`)) continue;
    seen.add(`${type}.${name}`);
    let found = true; // Unknown types: do not guess.
    if (type === "media" || type === "profile") {
      found = qualifiers.some((q) => {
        try {
          return readdirSync(join(q, type)).some((f) => f.slice(0, f.length - extname(f).length) === name);
        } catch {
          return false;
        }
      });
    } else if (elementTypes.has(type)) {
      const pattern = new RegExp(`"name"\\s*:\\s*"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
      found = qualifiers.some((q) => {
        const f = join(q, "element", `${type}.json`);
        try {
          return pattern.test(readFileSync(f, "utf8"));
        } catch {
          return false;
        }
      });
    }
    if (!found) missing.push(`$r('app.${type}.${name}')`);
  }
  for (const [, path] of code.matchAll(rawfileRef)) {
    if (!existsSync(join(resources, "rawfile", path)) && !missing.includes(`$rawfile('${path}')`)) missing.push(`$rawfile('${path}')`);
  }
  return missing;
}
