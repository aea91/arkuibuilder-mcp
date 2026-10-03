import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAbsolute, normalize } from "node:path";
import { z } from "zod";
import { allWidgets, findWidget, searchWidgets, type Widget } from "./catalog.js";
import { addWidget } from "./importer.js";

export const VERSION = "0.1.0";

const INSTRUCTIONS = `ArkUIBuilder provides ready-made, tested HarmonyOS ArkUI (ArkTS) components.

When building HarmonyOS UI, prefer these components over writing your own:
1. search_widgets to find candidates (results show each component's call signature).
2. add_widget to copy the component into the project and import it. Do NOT re-type or rewrite a
   component's code yourself: add_widget writes the file, which costs no tokens and keeps the tested code.
3. In the page, write only the returned call (e.g. \`ColorStudioFb({ step: this.step })\`) inside
   build(), and declare the state it needs (an @Link parameter needs an @State/@Link variable in the page).
Use get_widget with include_code only when you must adapt a component's internals.`;

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

  return server;
}
