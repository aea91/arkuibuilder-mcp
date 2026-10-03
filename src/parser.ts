/**
 * Light-weight reader for ArkTS component source, ported from the ArkUIBuilder IDE plugin
 * (ComponentParser.kt) so both produce the same calls. It finds the exported (or first)
 * `@Component`/`@ComponentV2` struct and the members a caller must pass.
 */

export interface Param {
  name: string;
  decorator: string;
  type: string | null;
}

export interface ComponentInfo {
  name: string;
  exported: boolean;
  /** Members the caller must pass, in declaration order. */
  requiredParams: Param[];
}

const structRegex = /@Component(?:V2)?\b[\s\S]*?\b(export\s+)?struct\s+([A-Za-z_]\w*)/g;
const decoratorRegex = /@(\w+)(?:\([^)]*\))?/g;
const memberRegex =
  /^(?:(?:private|public|protected|readonly|static)\s+)*([A-Za-z_]\w*)\s*[?!]?\s*(?::\s*((?:[^=;]|=>)+?))?\s*(=(?!>).*)?;?$/;

/** Decorators whose members are passed by the caller. */
const alwaysRequired = new Set(["Link", "ObjectLink"]);
const requiredWithoutInitializer = new Set(["Prop", "Require", "Param", "BuilderParam"]);

/** Starting value for the call site; the caller adjusts it. */
export function placeholder(p: Param): string {
  if (p.decorator === "Link" || p.decorator === "ObjectLink") return `this.${p.name}`;
  const t = p.type;
  if (t == null) return `this.${p.name}`;
  if (t === "number") return "0";
  if (t === "string") return "''";
  if (t === "boolean") return "false";
  if (t === "ResourceColor" || t === "ResourceStr") return "''";
  if (t.endsWith("[]") || t.startsWith("Array<")) return "[]";
  return `this.${p.name}`;
}

/** The call, e.g. `ColorStudio({ step: this.step })`. */
export function callText(info: ComponentInfo): string {
  if (info.requiredParams.length === 0) return `${info.name}()`;
  return `${info.name}({ ${info.requiredParams.map((p) => `${p.name}: ${placeholder(p)}`).join(", ")} })`;
}

export function parseComponent(code: string): ComponentInfo | null {
  const source = stripComments(code);
  const matches = [...source.matchAll(structRegex)];
  if (matches.length === 0) return null;
  const match = matches.find((m) => (m[1] ?? "").trim() !== "") ?? matches[0];
  const name = match[2];
  const bodyStart = source.indexOf("{", match.index! + match[0].length - 1);
  if (bodyStart < 0) return null;
  return {
    name,
    exported: (match[1] ?? "").trim() !== "",
    requiredParams: requiredParams(topLevelStatements(source, bodyStart)),
  };
}

/** Makes `struct Name` importable by adding `export` when the snippet left it out. */
export function ensureExported(code: string, info: ComponentInfo): string {
  if (info.exported) return code;
  return code.replace(new RegExp(`(^|\\s)struct\\s+${info.name}\\b`), `$1export struct ${info.name}`);
}

function stripDecorators(s: string): string {
  return s.replace(decoratorRegex, "");
}

function requiredParams(statements: string[]): Param[] {
  const params: Param[] = [];
  for (const statement of statements) {
    const decorators = [...statement.matchAll(decoratorRegex)].map((m) => m[1]);
    if (decorators.length === 0) continue;
    const rest = stripDecorators(statement).trim();
    const m = memberRegex.exec(rest);
    if (!m) continue;
    const hasInitializer = (m[3] ?? "").trim() !== "";
    // @Require makes even an initialised @Prop/@BuilderParam mandatory.
    const required =
      decorators.some((d) => alwaysRequired.has(d)) ||
      decorators.includes("Require") ||
      (!hasInitializer && decorators.some((d) => requiredWithoutInitializer.has(d)));
    if (!required) continue;
    const type = (m[2] ?? "").trim() || null;
    const decorator = decorators.find((d) => d !== "Require") ?? "Require";
    params.push({ name: m[1], decorator, type });
  }
  return params;
}

/**
 * Splits the struct body (starting at its `{`) into the member declarations at depth 1.
 * Decorators on their own line are joined with the member below them.
 */
function topLevelStatements(source: string, bodyStart: number): string[] {
  const statements: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  const flush = () => {
    const text = current.trim();
    if (text) statements.push(text);
    current = "";
  };
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (quote !== null) {
      // String contents are dropped so text like '@Link x' inside them is not read as code.
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) {
        quote = null;
        if (depth === 1) current += ch;
      }
      continue;
    }
    switch (ch) {
      case "'":
      case '"':
      case "`":
        quote = ch;
        if (depth === 1) current += ch;
        break;
      case "{":
      case "(":
      case "[":
        if (depth === 1 && ch === "{") flush();
        depth++;
        // Keep `()`/`[]` on members (e.g. `number[]`) but not what is inside them.
        if (depth === 2 && ch !== "{") current += ch;
        break;
      case "}":
      case ")":
      case "]":
        depth--;
        if (depth === 0) {
          flush();
          return statements;
        }
        if (depth === 1 && ch !== "}") current += ch;
        break;
      case "\n":
      case ";":
        if (depth === 1) {
          // A line holding only decorators belongs to the member on the next line.
          const t = current.trim();
          if (t && stripDecorators(t).trim() === "") current += " ";
          else flush();
        }
        break;
      default:
        if (depth === 1) current += ch;
    }
  }
  flush();
  return statements;
}

/** Removes // and /* *\/ comments while leaving string contents alone. */
function stripComments(code: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote !== null) {
      out += ch;
      if (ch === "\\" && i + 1 < code.length) {
        out += code[++i];
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      i--;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? code.length : end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}
