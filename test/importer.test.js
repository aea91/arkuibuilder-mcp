import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addImport, addWidget, findEtsRoot } from "../dist/importer.js";
import { callText, parseComponent } from "../dist/parser.js";

const code = `@Component
export struct ColorStudio {
  @Link step: number
  build() {
    Image($r('app.media.missing_icon'))
    Text($r('app.string.app_name'))
  }
}`;
const info = parseComponent(code);
const widget = { id: "w1", title: "Color Studio", platform: "Mobile", category: "", description: "", code, tags: [], source: "catalog", info, name: info.name, call: callText(info) };

function project() {
  const root = mkdtempSync(join(tmpdir(), "arkui-mcp-"));
  const ets = join(root, "entry", "src", "main", "ets");
  mkdirSync(join(ets, "pages"), { recursive: true });
  mkdirSync(join(root, "entry", "src", "main", "resources", "base", "element"), { recursive: true });
  writeFileSync(join(root, "entry", "src", "main", "resources", "base", "element", "string.json"), '{"string":[{"name":"app_name","value":"x"}]}');
  return { root, ets, page: join(ets, "pages", "Index.ets") };
}

test("creates the component, imports it after existing imports, reports missing resources", () => {
  const { ets, page } = project();
  writeFileSync(page, "import { router } from '@kit.ArkUI'\nimport {\n  a\n} from './x'\n\n@Entry\n@Component\nstruct Index {\n  build() {}\n}\n");
  const r = addWidget(widget, page, false);
  assert.equal(r.fileStatus, "created");
  assert.equal(r.importStatus, "added");
  assert.equal(readFileSync(join(ets, "components", "ColorStudio.ets"), "utf8"), code + "\n");
  assert.match(readFileSync(page, "utf8"), /} from '\.\/x'\nimport \{ ColorStudio \} from '\.\.\/components\/ColorStudio'\n/);
  assert.equal(r.call, "ColorStudio({ step: this.step })");
  assert.deepEqual(r.missingResources, ["$r('app.media.missing_icon')"]);

  const again = addWidget(widget, page, false);
  assert.equal(again.fileStatus, "unchanged");
  assert.equal(again.importStatus, "present");
});

test("keeps a different existing file unless overwrite", () => {
  const { ets, page } = project();
  mkdirSync(join(ets, "components"));
  writeFileSync(join(ets, "components", "ColorStudio.ets"), "// mine\n");
  assert.equal(addWidget(widget, page, false).fileStatus, "kept");
  assert.equal(readFileSync(join(ets, "components", "ColorStudio.ets"), "utf8"), "// mine\n");
  assert.equal(addWidget(widget, page, true).fileStatus, "replaced");
});

test("target page that does not exist yet gets the import line back", () => {
  const { page } = project();
  const r = addWidget(widget, page, false);
  assert.equal(r.importStatus, "not-written");
  assert.equal(r.importStatement, "import { ColorStudio } from '../components/ColorStudio'");
  assert.equal(existsSync(page), false);
});

test("rejects files outside an ArkTS module and plain snippets", () => {
  assert.throws(() => addWidget(widget, join(tmpdir(), "x", "Page.ets"), false), /src\/main\/ets/);
  const { page } = project();
  assert.throws(() => addWidget({ ...widget, info: null }, page, false), /plain snippet/);
  assert.equal(findEtsRoot("/a/b/c.ets"), null);
});

test("addImport into a file without imports", () => {
  assert.equal(addImport("@Entry\n", "A", "./A").text, "import { A } from './A'\n\n@Entry\n");
});
