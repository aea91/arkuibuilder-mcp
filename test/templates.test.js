import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.ARKUIBUILDER_CATALOG_FILE = fileURLToPath(new URL("./fixtures/catalog.json", import.meta.url));
process.env.ARKUIBUILDER_MY_WIDGETS = join(tmpdir(), "no-such-my-widgets.json");
const { catalogWidgets, findWidget } = await import("../dist/catalog.js");
const { addTemplate, allTemplates, findTemplate, searchTemplates, structNameFor, templateCode } = await import("../dist/templates.js");

function project() {
  const root = mkdtempSync(join(tmpdir(), "arkui-tpl-"));
  const main = join(root, "entry", "src", "main");
  mkdirSync(join(main, "ets", "pages"), { recursive: true });
  mkdirSync(join(main, "resources", "base", "profile"), { recursive: true });
  writeFileSync(join(main, "resources", "base", "profile", "main_pages.json"), '{\n  "src": [\n    "pages/Index"\n  ]\n}\n');
  return { ets: join(main, "ets"), pages: join(main, "resources", "base", "profile", "main_pages.json") };
}

test("every template uses exactly the catalog widgets it lists", async () => {
  const widgets = await catalogWidgets();
  const known = new Set(widgets.filter((w) => w.info).map((w) => w.info.name));
  const ids = new Set();
  for (const t of allTemplates()) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
    const code = templateCode(t);
    assert.match(code, new RegExp(`@Entry\\s*\\n@Component\\s*\\nstruct ${t.file.replace(".ets", "")} \\{`), t.id);
    assert.doesNotMatch(code, /^import /m, `${t.id} must not import; add_template adds the imports`);
    for (const w of t.widgets) {
      assert.ok(known.has(w), `${t.id}: ${w} not in catalog`);
      assert.match(code, new RegExp(`\\b${w}\\(`), `${t.id}: ${w} listed but not used`);
    }
    const used = new Set([...code.matchAll(/\b([A-Z]\w*)\(/g)].map((m) => m[1]).filter((n) => known.has(n)));
    assert.deepEqual([...used].sort(), [...t.widgets].sort(), `${t.id}: widgets list out of date`);
  }
  assert.ok(allTemplates().some((t) => t.platform === "Wearable"));
});

test("search and lookup", () => {
  assert.equal(findTemplate("Fitness Today")?.id, "fitness-today");
  assert.equal(findTemplate("WatchHealth")?.id, "watch-health");
  assert.equal(searchTemplates({ query: "heart rate" })[0].id, "watch-health");
  assert.ok(searchTemplates({ platform: "Wearable" }).every((t) => t.platform === "Wearable"));
  assert.deepEqual(searchTemplates({ query: "zzzz" }), []);
  assert.equal(structNameFor("/x/my_fitness-page.ets"), "MyFitnessPage");
  assert.equal(structNameFor("/x/1.ets"), null);
});

test("add_template writes the page, widgets, imports and route; reruns are safe", async () => {
  const widgets = await catalogWidgets();
  const { ets, pages } = project();
  const target = join(ets, "pages", "Fitness.ets");
  const t = findTemplate("fitness-today");

  const r = addTemplate(t, widgets, target, false, findWidget);
  assert.equal(r.pageStatus, "created");
  assert.equal(r.structName, "Fitness");
  assert.equal(r.route, "pages/Fitness");
  assert.equal(r.routeStatus, "added");
  const page = readFileSync(target, "utf8");
  assert.match(page, /^import \{ SegmentedControlFb \} from '\.\.\/components\/SegmentedControlFb'\n/);
  assert.match(page, /struct Fitness \{/);
  for (const w of t.widgets) {
    assert.ok(existsSync(join(ets, "components", `${w}.ets`)), w);
    assert.match(page, new RegExp(`import \\{ ${w} \\}`));
  }
  assert.deepEqual(JSON.parse(readFileSync(pages, "utf8")).src, ["pages/Index", "pages/Fitness"]);

  const again = addTemplate(t, widgets, target, false, findWidget);
  assert.equal(again.pageStatus, "unchanged");
  assert.equal(again.routeStatus, "present");
  assert.ok(again.widgets.every((w) => w.result.fileStatus === "unchanged" && w.result.importStatus === "present"));
  assert.equal(readFileSync(target, "utf8"), page);

  writeFileSync(target, "@Entry\n@Component\nstruct Fitness {\n  build() {}\n}\n");
  assert.throws(() => addTemplate(t, widgets, target, false, findWidget), /already exists/);
  assert.equal(addTemplate(t, widgets, target, true, findWidget).pageStatus, "replaced");
  assert.equal(readFileSync(target, "utf8"), page);

  assert.throws(() => addTemplate(t, widgets, join(tmpdir(), "Nowhere.ets"), false, findWidget), /src\/main\/ets/);
});
