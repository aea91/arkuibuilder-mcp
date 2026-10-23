import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { z } from "zod";
import { allWidgets, findWidget, searchWidgets, type Widget } from "./catalog.js";
import { addWidget } from "./importer.js";
import {
  allSamples,
  findSample,
  importedKits,
  keyFiles,
  permissions,
  readSampleFile,
  sampleFiles,
  searchSamples,
  type Sample,
} from "./samples.js";
import { addTemplate, allTemplates, findTemplate, searchTemplates, stateFields, templateCode, type Template } from "./templates.js";

export const VERSION = "0.3.0";

const INSTRUCTIONS = `ArkUIBuilder provides ready-made, tested HarmonyOS ArkUI (ArkTS) components.

When building HarmonyOS UI, prefer these components over writing your own:
1. search_widgets to find candidates (results show each component's call signature).
2. add_widget to copy the component into the project and import it. Do NOT re-type or rewrite a
   component's code yourself: add_widget writes the file, which costs no tokens and keeps the tested code.
3. In the page, write only the returned call (e.g. \`ColorStudioFb({ step: this.step })\`) inside
   build(), and declare the state it needs (an @Link parameter needs an @State/@Link variable in the page).
Use get_widget with include_code only when you must adapt a component's internals.

For a whole page or app screen (fitness, shop, wallet, profile/settings, sign in, music, weather, watch apps,
a PC workspace), check search_templates first: add_template writes a complete page built from these widgets,
adds the widgets and registers the route, so you only adjust texts and data afterwards.

For HarmonyOS APIs and capabilities (sensors, heart rate, digital crown, notifications, maps, Bluetooth,
NFC, storage, payments…), search the open source samples before writing the code from memory:
search_samples finds a working project, and get_sample returns its outline (permissions, files and the
kits each file uses). Then fetch only the files you need with get_sample's files parameter. The samples
target watches; Lite Wearable (JavaScript) code does not run on Smart Wearable (ArkTS) devices.`;

/** One line per widget: enough to choose and call it without fetching its code. */
function summary(w: Widget): string {
  const where = [w.source === "mine" ? "My Widgets" : w.platform, w.category].filter(Boolean).join(" · ");
  const params = w.info?.requiredParams.length
    ? `  params: ${w.info.requiredParams.map((p) => `@${p.decorator} ${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ")}`
    : "";
  const desc = w.description ? `\n  ${w.description.length > 140 ? `${w.description.slice(0, 137)}...` : w.description}` : "";
  return `- ${w.title} [${where}]\n  ${w.call ?? `${w.name} (plain snippet, no component)`}${params}${desc}`;
}

function overview(widgets: Widget[]): string {
  const count = (key: (w: Widget) => string) => {
    const m = new Map<string, number>();
    for (const w of widgets) {
      const k = key(w) || "Other";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ");
  };
  return [
    `${widgets.length} widgets.`,
    `Platforms: ${count((w) => (w.source === "mine" ? "My Widgets" : w.platform))}`,
    `Categories: ${count((w) => w.category)}`,
    "Search with a query (e.g. \"progress bar\", \"toggle\", \"chart\") and/or platform/category filters.",
  ].join("\n");
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

const KIND_LABEL: Record<Sample["kind"], string> = {
  "how-to": "How-to",
  app: "Sample app",
  lite: "Lite Wearable app (JavaScript)",
  library: "ArkTS library",
  companion: "Phone companion app",
  "cross-platform": "Cross platform",
};

function sampleSummary(s: Sample): string {
  const meta = [KIND_LABEL[s.kind], s.sdk].filter(Boolean).join(" · ");
  const kits = s.kits.length ? `\n  kits: ${s.kits.join(", ")}` : "";
  return `- ${s.repo} [${meta}]\n  ${s.description}${kits}`;
}

function samplesOverview(): string {
  const count = (key: (s: Sample) => string) => {
    const m = new Map<string, number>();
    for (const s of allSamples()) m.set(key(s), (m.get(key(s)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ");
  };
  const kits = new Map<string, number>();
  for (const s of allSamples()) for (const k of s.kits) kits.set(k, (kits.get(k) ?? 0) + 1);
  const topKits = [...kits].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => `${k} (${n})`).join(", ");
  return [
    `${allSamples().length} open source HarmonyOS watch projects from Explore-In-HMOS.`,
    `Kinds: ${count((s) => s.kind)}`,
    `Domains: ${count((s) => s.domain)}`,
    `Most used kits: ${topKits}`,
    'Search with a query (e.g. "heart rate", "digital crown", "notification") and/or kind, kit or domain filters.',
  ].join("\n");
}

function templateSummary(t: Template): string {
  return `- ${t.id}: ${t.title} [${t.platform}]\n  ${t.description}\n  widgets: ${t.widgets.join(", ")}`;
}

const approxTokens = (bytes: number) => `~${Math.max(1, Math.round(bytes / 4)).toLocaleString("en-US")} tok`;
const FENCE: Record<string, string> = { ets: "ts", ts: "ts", js: "js", hml: "html", css: "css", json5: "json", json: "json", kt: "kotlin", swift: "swift", dart: "dart" };

export function createServer(): McpServer {
  const server = new McpServer({ name: "arkuibuilder", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "search_widgets",
    {
      title: "Search ArkUIBuilder widgets",
      description:
        "Search ready-made HarmonyOS ArkUI components (ArkUIBuilder catalog plus the user's My Widgets). " +
        "Each result shows the call to write in build() and its required parameters. " +
        "Call with no arguments for an overview of platforms and categories.",
      inputSchema: {
        query: z.string().optional().describe("Words to match in name, title, category, tags or description"),
        platform: z.string().optional().describe("Mobile, Wearable, Light Wearable, PC (2in1) or My Widgets"),
        category: z.string().optional().describe("Exact category name from the overview"),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum results (default 15)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, platform, category, limit }) => {
      const { widgets, catalogError } = await allWidgets();
      const note = catalogError ? `\n(Catalog unavailable: ${catalogError}. Showing My Widgets only.)` : "";
      if (!query && !platform && !category) return text(overview(widgets) + note);
      const found = searchWidgets(widgets, { query, platform, category });
      if (found.length === 0) return text(`No widgets match.${note}\n\n${overview(widgets)}`);
      const shown = found.slice(0, limit ?? 15);
      const more = found.length > shown.length ? `\n(${found.length - shown.length} more; refine the query or raise limit.)` : "";
      return text(`${found.length} match${found.length === 1 ? "" : "es"}:\n${shown.map(summary).join("\n")}${more}${note}`);
    },
  );

  server.registerTool(
    "get_widget",
    {
      title: "Get an ArkUIBuilder widget",
      description:
        "Details of one widget by component name (e.g. ColorStudioFb), id or title. " +
        "Set include_code only if you need to read or adapt its source; to use it as-is call add_widget instead.",
      inputSchema: {
        name: z.string().describe("Component name, id or title"),
        include_code: z.boolean().optional().describe("Include the full ArkTS source (default false)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name, include_code }) => {
      const { widgets, catalogError } = await allWidgets();
      const w = findWidget(widgets, name);
      if (!w) return text(`No widget named "${name}".${catalogError ? ` (Catalog unavailable: ${catalogError})` : ""} Use search_widgets.`, true);
      const lines = [summary(w)];
      if (w.tags.length) lines.push(`  tags: ${w.tags.join(", ")}`);
      if (include_code) lines.push("", "```ts", w.code.trimEnd(), "```");
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "add_widget",
    {
      title: "Add an ArkUIBuilder widget to the project",
      description:
        "Copies a widget's component into <module>/src/main/ets/components/<Name>.ets and adds its import to " +
        "target_file. Returns the call to place in build(). Never overwrites a different existing file " +
        "unless overwrite is true.",
      inputSchema: {
        name: z.string().describe("Component name, id or title"),
        target_file: z
          .string()
          .describe("Absolute path of the .ets page that will use it, inside <module>/src/main/ets (may not exist yet)"),
        overwrite: z.boolean().optional().describe("Replace an existing, different components/<Name>.ets (default false)"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ name, target_file, overwrite }) => {
      if (!isAbsolute(target_file)) return text("target_file must be an absolute path.", true);
      const { widgets, catalogError } = await allWidgets();
      const w = findWidget(widgets, name);
      if (!w) return text(`No widget named "${name}".${catalogError ? ` (Catalog unavailable: ${catalogError})` : ""} Use search_widgets.`, true);
      try {
        const r = addWidget(w, normalize(target_file), overwrite ?? false);
        const file = {
          created: `Created ${r.componentFile}`,
          unchanged: `${r.componentFile} already up to date`,
          replaced: `Replaced ${r.componentFile}`,
          kept: `${r.componentFile} exists with different code and was kept (pass overwrite: true to replace it)`,
        }[r.fileStatus];
        const imp = {
          added: `Added to target_file: ${r.importStatement}`,
          present: "target_file already imports it",
          "not-written": `target_file does not exist yet; include this line when you create it: ${r.importStatement}`,
        }[r.importStatus];
        const lines = [file, imp, `Call in build(): ${r.call}`];
        const needs = w.info?.requiredParams.filter((p) => p.decorator === "Link" || p.decorator === "ObjectLink") ?? [];
        if (needs.length) {
          lines.push(`The page needs state for: ${needs.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ")} (e.g. @State).`);
        }
        if (r.missingResources.length) {
          lines.push(`Missing resources in this module (add them or replace the references): ${r.missingResources.join(", ")}`);
        }
        return text(lines.join("\n"));
      } catch (e) {
        return text(e instanceof Error ? e.message : String(e), true);
      }
    },
  );

  server.registerTool(
    "search_samples",
    {
      title: "Search HarmonyOS sample projects",
      description:
        "Search 550+ open source HarmonyOS watch projects (Explore-In-HMOS): focused how-tos for one API or " +
        "pattern, complete sample apps, Lite Wearable (JavaScript) apps and ArkTS libraries. Use it before " +
        "writing HarmonyOS API code (sensors, health, digital crown, notifications, maps, Bluetooth, NFC, " +
        "storage…) from memory. Call with no arguments for an overview.",
      inputSchema: {
        query: z.string().optional().describe("Words to match in repo name, topics, kits or description"),
        kind: z
          .enum(["how-to", "app", "lite", "library", "companion", "cross-platform"])
          .optional()
          .describe("how-to (one technique), app (complete app), lite (Lite Wearable JS), library, companion (phone app)"),
        kit: z.string().optional().describe("A kit the project uses, e.g. SensorServiceKit or @kit.LocationKit"),
        domain: z
          .string()
          .optional()
          .describe("sensors-and-health, location-and-maps, media-and-audio, connectivity-and-network, background-and-notifications, data-and-storage or ui-and-interaction"),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum results (default 10)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, kind, kit, domain, limit }) => {
      if (!query && !kind && !kit && !domain) return text(samplesOverview());
      const found = searchSamples({ query, kind, kit, domain });
      if (found.length === 0) return text(`No samples match.\n\n${samplesOverview()}`);
      const shown = found.slice(0, limit ?? 10);
      const more = found.length > shown.length ? `\n(${found.length - shown.length} more; refine the query or raise limit.)` : "";
      return text(
        `${found.length} match${found.length === 1 ? "" : "es"}:\n${shown.map(sampleSummary).join("\n")}${more}\n` +
          "Next: get_sample(name) for its permissions and files.",
      );
    },
  );

  server.registerTool(
    "get_sample",
    {
      title: "Get a HarmonyOS sample project",
      description:
        "Outline of one sample project: description, SDK, requested permissions, and its source files with " +
        "size and the kits each file imports. Pass files to read specific files, or include_code to read the " +
        "files that use the sample's distinctive kits (up to max_chars). Code is fetched from GitHub.",
      inputSchema: {
        name: z.string().describe("Repository name (e.g. how-to-get-heart-rate-with-sensorkit) or its GitHub URL"),
        files: z
          .array(z.string())
          .max(20)
          .optional()
          .describe("Paths from the outline to read; a unique file name such as Index.ets also works"),
        include_code: z.boolean().optional().describe("Read the key files automatically (default false)"),
        max_chars: z.number().int().min(2000).max(200000).optional().describe("Code budget for this call (default 40000)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name, files, include_code, max_chars }) => {
      const s = findSample(name);
      if (!s) return text(`No sample named "${name}". Use search_samples.`, true);
      try {
        const list = await sampleFiles(s);
        // Read every source file once (small projects, cached) to show which kits each one uses.
        const withKits = await mapLimit(list, 8, async (f) => ({
          ...f,
          kits: /\.(ets|ts|js)$/.test(f.path) ? importedKits(await readSampleFile(s, f.path)) : [],
        }));
        const configs = list.filter((f) => /(module\.json5|config\.json)$/.test(f.path));
        const perms = [...new Set((await Promise.all(configs.map((f) => readSampleFile(s, f.path)))).flatMap(permissions))];

        const lines = [
          `${s.repo} — ${KIND_LABEL[s.kind]}${s.sdk ? ` · ${s.sdk}` : ""}`,
          s.description,
          s.url,
        ];
        if (s.kind === "lite") lines.push("Lite Wearable (JavaScript): does not run on Smart Wearable / ArkTS devices.");
        if (s.kits.length) lines.push(`Kits: ${s.kits.join(", ")}`);
        lines.push(`Permissions: ${perms.length ? perms.join(", ") : "none requested"}`);
        lines.push("", `Files (${list.length}):`);
        for (const f of withKits) lines.push(`  ${f.path}  ${approxTokens(f.size)}${f.kits.length ? `  [${f.kits.join(", ")}]` : ""}`);

        let wantedPaths: string[] = [];
        const unknown: string[] = [];
        if (files?.length) {
          for (const want of files) {
            const w = want.replace(/^\/+/, "");
            const exact = list.find((f) => f.path === w);
            const bySuffix = list.filter((f) => f.path.endsWith(`/${w}`));
            const hit = exact ?? (bySuffix.length === 1 ? bySuffix[0] : undefined);
            if (hit) wantedPaths.push(hit.path);
            else unknown.push(bySuffix.length > 1 ? `${want} (ambiguous: ${bySuffix.map((f) => f.path).join(", ")})` : want);
          }
        } else if (include_code) {
          wantedPaths = keyFiles(withKits);
        }

        const budget = max_chars ?? 40000;
        let used = 0;
        const skipped: string[] = [];
        for (const path of [...new Set(wantedPaths)]) {
          const code = await readSampleFile(s, path);
          if (used > 0 && used + code.length > budget) {
            skipped.push(path);
            continue;
          }
          used += code.length;
          const ext = path.split(".").pop() ?? "";
          lines.push("", `### ${path}`, "```" + (FENCE[ext] ?? ""), code.trimEnd(), "```");
        }
        if (unknown.length) lines.push("", `Not found: ${unknown.join(", ")}`);
        if (skipped.length) lines.push("", `Over the ${budget}-char budget, not included: ${skipped.join(", ")} (raise max_chars or request them in another call).`);
        if (!wantedPaths.length) lines.push("", "Read files with files: [...] or include_code: true.");
        return text(lines.join("\n"));
      } catch (e) {
        return text(`${e instanceof Error ? e.message : String(e)}\nRepository: ${s.url}`, true);
      }
    },
  );

  server.registerTool(
    "search_templates",
    {
      title: "Search ArkUIBuilder page templates",
      description:
        "Ready-made pages built from ArkUIBuilder widgets (e.g. fitness dashboard, shop with tab bar, wallet, " +
        "profile and settings, sign in, music player, weather, watch health/workout/home, PC workspace). " +
        "Call with no arguments to list them all.",
      inputSchema: {
        query: z.string().optional().describe("Words to match in name, tags, widgets or description"),
        platform: z.string().optional().describe("Mobile, Wearable or PC (2in1)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, platform }) => {
      const found = query || platform ? searchTemplates({ query, platform }) : allTemplates();
      if (found.length === 0) return text(`No templates match. All templates:\n${allTemplates().map(templateSummary).join("\n")}`);
      return text(`${found.length} template${found.length === 1 ? "" : "s"}:\n${found.map(templateSummary).join("\n")}\nNext: add_template(id, target_file).`);
    },
  );

  server.registerTool(
    "add_template",
    {
      title: "Add a page template to the project",
      description:
        "Writes a complete page to target_file (its struct is named after the file), copies every widget it " +
        "uses into components/ with their imports, and adds the page to main_pages.json. The page compiles " +
        "as-is; then edit its texts, data and state. Refuses to replace an existing target_file unless overwrite is true.",
      inputSchema: {
        name: z.string().describe("Template id from search_templates, e.g. fitness-today"),
        target_file: z
          .string()
          .describe("Absolute path of the new page, inside <module>/src/main/ets (e.g. …/ets/pages/Fitness.ets)"),
        overwrite: z.boolean().optional().describe("Replace target_file if it already exists (default false)"),
        include_code: z.boolean().optional().describe("Return the written page code (default false)"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ name, target_file, overwrite, include_code }) => {
      if (!isAbsolute(target_file)) return text("target_file must be an absolute path.", true);
      const t = findTemplate(name);
      if (!t) return text(`No template named "${name}". Templates: ${allTemplates().map((x) => x.id).join(", ")}`, true);
      const { widgets, catalogError } = await allWidgets();
      if (catalogError) return text(`Catalog unavailable: ${catalogError}. Templates need the catalog's widgets; try again later.`, true);
      try {
        const r = addTemplate(t, widgets, normalize(target_file), overwrite ?? false, findWidget);
        const lines = [
          `${{ created: "Created", unchanged: "Already up to date:", replaced: "Replaced" }[r.pageStatus]} ${r.pageFile} (struct ${r.structName}, ${t.title})`,
          {
            added: `Added route "${r.route}" to main_pages.json`,
            present: `Route "${r.route}" already in main_pages.json`,
            "no-profile": `No resources/base/profile/main_pages.json found; add "${r.route}" to the module's pages yourself`,
          }[r.routeStatus],
        ];
        const created = r.widgets.filter((w) => w.result.fileStatus === "created").map((w) => w.name);
        const same = r.widgets.filter((w) => w.result.fileStatus === "unchanged").map((w) => w.name);
        const kept = r.widgets.filter((w) => w.result.fileStatus === "kept").map((w) => w.name);
        if (created.length) lines.push(`Widgets added to components/: ${created.join(", ")}`);
        if (same.length) lines.push(`Widgets already present: ${same.join(", ")}`);
        if (kept.length) lines.push(`Kept existing different components/ files (check they still fit this page): ${kept.join(", ")}`);
        const missing = [...new Set(r.widgets.flatMap((w) => w.result.missingResources))];
        if (missing.length) lines.push(`Missing resources in this module: ${missing.join(", ")}`);
        const code = templateCode(t);
        const state = stateFields(code);
        if (state.length) lines.push(`Page state: ${state.join("; ")}`);
        lines.push("The page is ready to run. Edit texts and data in place; do not re-type the widgets.");
        if (include_code) lines.push("", "```ts", readFileSync(r.pageFile, "utf8").trimEnd(), "```");
        return text(lines.join("\n"));
      } catch (e) {
        return text(e instanceof Error ? e.message : String(e), true);
      }
    },
  );

  return server;
}

/** Promise.all with at most `n` tasks running at once. */
async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
