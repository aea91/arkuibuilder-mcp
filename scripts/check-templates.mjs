// Compiles every template in a real HarmonyOS project: node scripts/check-templates.mjs <project-dir>
// Writes pages/Tpl<Name>.ets (plus widgets in components/) into the project's entry module, then runs
// hvigor assembleHap. Use a scratch copy of a project; the catalog is fetched live unless
// ARKUIBUILDER_CATALOG_FILE is set.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { allWidgets, findWidget } from "../dist/catalog.js";
import { addTemplate, allTemplates } from "../dist/templates.js";

const project = resolve(process.argv[2] ?? "");
const ets = join(project, "entry", "src", "main", "ets");
if (!existsSync(ets)) {
  console.error("Usage: node scripts/check-templates.mjs <HarmonyOS project with an entry module>");
  process.exit(1);
}
const deveco = process.env.DEVECO_HOME ?? "/Applications/DevEco-Studio.app/Contents";
const { widgets, catalogError } = await allWidgets();
if (catalogError) throw new Error(catalogError);
for (const t of allTemplates()) {
  const r = addTemplate(t, widgets, join(ets, "pages", `Tpl${t.file}`), true, findWidget);
  console.log(`${t.id.padEnd(20)} ${r.route}`);
}
const out = execFileSync(
  join(deveco, "tools", "node", "bin", "node"),
  [join(deveco, "tools", "hvigor", "bin", "hvigorw.js"), "--mode", "module", "-p", "module=entry@default", "-p", "product=default", "assembleHap", "--no-daemon"],
  { cwd: project, env: { ...process.env, DEVECO_SDK_HOME: process.env.DEVECO_SDK_HOME ?? join(deveco, "sdk") }, encoding: "utf8", maxBuffer: 64 << 20 },
);
// eslint-disable-next-line no-control-regex
const lines = out.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
const warnings = lines.flatMap((l, i) => (/(pages\/Tpl|components\/)\w+\.ets/.test(l) ? [`${l.trim()} ${lines[i + 1]?.trim() ?? ""}`] : []));
console.log(warnings.length ? `Warnings:\n${warnings.join("\n")}` : "No warnings in templates or their widgets.");
console.log(lines.find((l) => l.includes("BUILD")) ?? "BUILD result not found");
