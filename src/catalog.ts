import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callText, parseComponent, type ComponentInfo } from "./parser.js";

export const CATALOG_URL = "https://us-central1-arkuibuilder.cloudfunctions.net/getWidgetCatalog";
const CACHE_MS = 10 * 60 * 1000;

export interface Widget {
  id: string;
  title: string;
  platform: string;
  category: string;
  description: string;
  code: string;
  tags: string[];
  /** "catalog" (ArkUIBuilder, Firebase) or "mine" (the user's My Widgets from the IDE plugin). */
  source: "catalog" | "mine";
  info: ComponentInfo | null;
  /** What callers type: the struct name, or the title without spaces for plain snippets. */
  name: string;
  call: string | null;
}

interface RemoteWidget {
  id?: string;
  title?: string;
  description?: string;
  mainCategory?: string;
  category?: string;
  code?: string;
  tags?: string[];
}

interface SavedWidget {
  id?: string;
  title?: string;
  platform?: string;
  category?: string;
  description?: string;
  code?: string;
  tags?: string[];
}

/** Same label the plugin shows: Firestore's "Smart Wearable" is "Wearable". */
function normalizePlatform(p: string): string {
  return p === "Smart Wearable" ? "Wearable" : p;
}

function toWidget(
  w: { id: string; title: string; platform: string; category: string; description: string; code: string; tags: string[] },
  source: Widget["source"],
): Widget {
  const info = parseComponent(w.code);
  return {
    ...w,
    platform: normalizePlatform(w.platform),
    source,
    info,
    name: info?.name ?? w.title.replace(/[^\p{L}\p{N}_]/gu, ""),
    call: info ? callText(info) : null,
  };
}

/** ARKUIBUILDER_CATALOG_FILE reads a saved getWidgetCatalog response instead (tests, offline use). */
async function fetchCatalogJson(): Promise<unknown> {
  const file = process.env.ARKUIBUILDER_CATALOG_FILE;
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const res = await fetch(CATALOG_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
  return res.json();
}

let catalog: { widgets: Widget[]; at: number } | null = null;
let inflight: Promise<Widget[]> | null = null;

/** The ArkUIBuilder catalog, cached for ten minutes. */
export async function catalogWidgets(): Promise<Widget[]> {
  if (catalog && Date.now() - catalog.at < CACHE_MS) return catalog.widgets;
  inflight ??= (async () => {
    try {
      const body = (await fetchCatalogJson()) as { widgets?: RemoteWidget[] };
      const widgets = (body.widgets ?? [])
        .filter((r) => r.id && r.code)
        .map((r) =>
          toWidget(
            {
              id: r.id!,
              title: r.title || r.id!,
              platform: r.mainCategory ?? "",
              category: r.category ?? "",
              description: r.description ?? "",
              code: r.code!,
              tags: r.tags ?? [],
            },
            "catalog",
          ),
        );
      catalog = { widgets, at: Date.now() };
      return widgets;
    } catch (e) {
      // A stale catalog beats none when the network blips.
      if (catalog) return catalog.widgets;
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * IDE config folders the plugin may have written `arkuibuilder/my-widgets.json` to, e.g.
 * `~/Library/Application Support/Huawei/DevEcoStudio6.0` on macOS. ARKUIBUILDER_MY_WIDGETS can
 * point at the file directly.
 */
export function myWidgetsFiles(): string[] {
  const explicit = process.env.ARKUIBUILDER_MY_WIDGETS;
  if (explicit) return existsSync(explicit) ? [explicit] : [];
  const roots =
    process.platform === "darwin"
      ? [join(homedir(), "Library", "Application Support")]
      : process.platform === "win32"
        ? [process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")]
        : [process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")];
  const files: string[] = [];
  for (const root of roots) {
    for (const vendor of safeList(root)) {
      for (const product of safeList(join(root, vendor))) {
        const file = join(root, vendor, product, "arkuibuilder", "my-widgets.json");
        if (existsSync(file)) files.push(file);
      }
    }
  }
  return files;
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** The user's own widgets from every IDE that has the plugin; read fresh on each call. */
export function myWidgets(): Widget[] {
  const seen = new Set<string>();
  const out: Widget[] = [];
  for (const file of myWidgetsFiles()) {
    let saved: SavedWidget[];
    try {
      saved = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const s of Array.isArray(saved) ? saved : []) {
      if (!s.id || s.code == null || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(
        toWidget(
          {
            id: s.id,
            title: s.title || "Untitled",
            platform: s.platform ?? "",
            category: s.category ?? "",
            description: s.description ?? "",
            code: s.code,
            tags: s.tags ?? [],
          },
          "mine",
        ),
      );
    }
  }
  return out;
}

/** My Widgets first, then the catalog. If the catalog is unreachable, My Widgets still work. */
export async function allWidgets(): Promise<{ widgets: Widget[]; catalogError?: string }> {
  const mine = myWidgets();
  try {
    return { widgets: [...mine, ...(await catalogWidgets())] };
  } catch (e) {
    return { widgets: mine, catalogError: e instanceof Error ? e.message : String(e) };
  }
}

/** By component name, id or title, ignoring case. */
export function findWidget(widgets: Widget[], key: string): Widget | undefined {
  const k = key.trim().toLowerCase();
  return (
    widgets.find((w) => w.name.toLowerCase() === k) ??
    widgets.find((w) => w.id.toLowerCase() === k) ??
    widgets.find((w) => w.title.toLowerCase() === k)
  );
}

/** Simple relevance ranking over name, title, category, platform, tags and description. */
export function searchWidgets(
  widgets: Widget[],
  opts: { query?: string; platform?: string; category?: string },
): Widget[] {
  const terms = (opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const platform = opts.platform?.toLowerCase();
  const category = opts.category?.toLowerCase();
  const scored: { w: Widget; score: number }[] = [];
  for (const w of widgets) {
    if (platform && !(w.platform.toLowerCase() === platform || (platform === "my widgets" && w.source === "mine"))) continue;
    if (category && w.category.toLowerCase() !== category) continue;
    let score = 0;
    for (const t of terms) {
      const s =
        (w.name.toLowerCase().includes(t) ? 5 : 0) +
        (w.title.toLowerCase().includes(t) ? 5 : 0) +
        (w.category.toLowerCase().includes(t) ? 3 : 0) +
        (w.tags.some((tag) => tag.toLowerCase().includes(t)) ? 3 : 0) +
        (w.description.toLowerCase().includes(t) ? 1 : 0);
      // Every term must match somewhere.
      if (s === 0) {
        score = -1;
        break;
      }
      score += s;
    }
    if (score < 0) continue;
    scored.push({ w, score: score + (w.source === "mine" ? 1 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.w.title.localeCompare(b.w.title)).map((s) => s.w);
}
