import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Open source HarmonyOS projects from the Explore-In-HMOS organization
 * (https://github.com/Explore-In-HMOS/hmos-index). The index ships in data/samples.json
 * (built by scripts/build-samples.mjs); source files are fetched from GitHub on demand.
 */
export interface Sample {
  repo: string;
  /** how-to: one API or pattern; app: complete app; lite: Lite Wearable JS; library / companion / cross-platform. */
  kind: "how-to" | "app" | "lite" | "library" | "companion" | "cross-platform";
  platform: string;
  domain: string;
  description: string;
  /** Distinctive @kit.* kits (ArkTS) or @system.* / @ohos.* modules (Lite Wearable). */
  kits: string[];
  topics: string[];
  sdk: string;
  url: string;
}

export interface SourceFile {
  path: string;
  size: number;
}

const OWNER = "Explore-In-HMOS";

let index: Sample[] | null = null;

export function allSamples(): Sample[] {
  index ??= (JSON.parse(readFileSync(new URL("../data/samples.json", import.meta.url), "utf8")) as { samples: Sample[] })
    .samples;
  return index;
}

export function findSample(key: string): Sample | undefined {
  const k = key
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\/[^/]+\//, "")
    .replace(/\/$/, "");
  return allSamples().find((s) => s.repo === k) ?? allSamples().find((s) => s.repo === k.replace(/\s+/g, "-"));
}

/** Every term must match somewhere; ranks repo name and topics above the description. */
export function searchSamples(opts: { query?: string; kind?: string; kit?: string; domain?: string }): Sample[] {
  const terms = (opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const kit = opts.kit?.toLowerCase().replace(/^@kit\./, "");
  const scored: { s: Sample; score: number }[] = [];
  for (const s of allSamples()) {
    if (opts.kind && s.kind !== opts.kind) continue;
    if (opts.domain && s.domain !== opts.domain) continue;
    if (kit && !s.kits.some((k) => k.toLowerCase().replace(/^@kit\./, "") === kit)) continue;
    let score = 0;
    for (const t of terms) {
      const sc =
        (s.repo.includes(t) ? 5 : 0) +
        (s.topics.some((x) => x.includes(t)) ? 4 : 0) +
        (s.kits.some((x) => x.toLowerCase().includes(t)) ? 3 : 0) +
        (s.domain.includes(t) ? 2 : 0) +
        (s.description.toLowerCase().includes(t) ? 1 : 0);
      if (sc === 0) {
        score = -1;
        break;
      }
      score += sc;
    }
    if (score < 0) continue;
    // A how-to shows one technique in a small project, which is usually what an assistant needs.
    scored.push({ s, score: score + (s.kind === "how-to" ? 1 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.s.repo.localeCompare(b.s.repo)).map((x) => x.s);
}

const SOURCE_EXT = /\.(ets|ts|js|hml|css|kt|swift|dart)$/;
const BUILD_SCRIPT = /(^|\/)hvigorfile\.(ts|js)$/;
const CONFIG = /(^|\/)(module\.json5|config\.json|main_pages\.json|oh-package\.json5)$/;
const SKIP =
  /(^|\/)(oh_modules|node_modules|build|\.hvigor|hvigor|ohosTest|test|mock|entryability|entrybackupability|\.preview)(\/|$)/i;

/** Project source and the config files that matter when copying code (permissions, pages, dependencies). */
function wanted(path: string): boolean {
  if (SKIP.test(path) || BUILD_SCRIPT.test(path)) return false;
  return SOURCE_EXT.test(path) || CONFIG.test(path);
}

const treeCache = new Map<string, SourceFile[]>();
const fileCache = new Map<string, string>();

/** ARKUIBUILDER_SAMPLES_DIR points at local clones (<dir>/<repo>/...) instead of GitHub (tests, offline). */
const localDir = () => process.env.ARKUIBUILDER_SAMPLES_DIR;

function walk(root: string, dir: string, out: SourceFile[]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    const rel = relative(root, full).split(sep).join("/");
    if (e.isDirectory()) {
      if (!SKIP.test(rel)) walk(root, full, out);
    } else if (wanted(rel)) out.push({ path: rel, size: statSync(full).size });
  }
}

async function github(url: string): Promise<Response> {
  const headers: Record<string, string> = { "User-Agent": "arkuibuilder-mcp" };
  const token = process.env.GITHUB_TOKEN;
  if (token && url.startsWith("https://api.github.com/")) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      "GitHub rate limit reached (60 requests/hour without a token). Set GITHUB_TOKEN in the MCP server's env, " +
        "or clone the repository and read it directly.",
    );
  }
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status} for ${url}`);
  return res;
}

/** Source files of a sample, sorted by path. */
export async function sampleFiles(s: Sample): Promise<SourceFile[]> {
  const cached = treeCache.get(s.repo);
  if (cached) return cached;
  let files: SourceFile[] = [];
  const dir = localDir();
  if (dir) {
    const root = join(dir, s.repo);
    if (!existsSync(root)) throw new Error(`No local clone at ${root}`);
    walk(root, root, files);
  } else {
    const res = await github(`https://api.github.com/repos/${OWNER}/${s.repo}/git/trees/HEAD?recursive=1`);
    const body = (await res.json()) as { tree?: { path: string; type: string; size?: number }[] };
    files = (body.tree ?? [])
      .filter((t) => t.type === "blob" && wanted(t.path))
      .map((t) => ({ path: t.path, size: t.size ?? 0 }));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  treeCache.set(s.repo, files);
  return files;
}

export async function readSampleFile(s: Sample, path: string): Promise<string> {
  const key = `${s.repo}/${path}`;
  const cached = fileCache.get(key);
  if (cached != null) return cached;
  const dir = localDir();
  let text: string;
  if (dir) {
    text = readFileSync(join(dir, s.repo, ...path.split("/")), "utf8");
  } else {
    const url = `https://raw.githubusercontent.com/${OWNER}/${s.repo}/HEAD/${path.split("/").map(encodeURIComponent).join("/")}`;
    text = await (await github(url)).text();
  }
  fileCache.set(key, text);
  return text;
}

/** Kits and system modules a file imports, without the core kits every project uses. */
const CORE = new Set(["AbilityKit", "ArkTS", "ArkUI", "BasicServicesKit", "PerformanceAnalysisKit", "TestKit"]);
export function importedKits(code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/from\s+['"]@(kit\.\w+|system\.\w+|ohos\.[\w.]+|hms\.[\w.]+)['"]/g)) {
    const name = m[1].startsWith("kit.") ? m[1].slice(4) : `@${m[1]}`;
    if (!CORE.has(name)) found.add(name);
  }
  return [...found];
}

/** Permissions requested in module.json5 / config.json. */
export function permissions(config: string): string[] {
  return [...new Set([...config.matchAll(/["']name["']\s*:\s*["'](ohos\.permission\.\w+)["']/g)].map((m) => m[1]))];
}

/**
 * Files worth reading first: the ones that use the sample's distinctive kits, then the
 * main pages. Configs are left to the outline (permissions are summarised there).
 */
export function keyFiles(files: { path: string; size: number; kits: string[] }[]): string[] {
  const source = files.filter((f) => SOURCE_EXT.test(f.path));
  const withKits = source.filter((f) => f.kits.length > 0);
  const pages = source.filter((f) => /\/pages\//.test(f.path) && !withKits.includes(f));
  return [...withKits, ...pages].map((f) => f.path);
}
