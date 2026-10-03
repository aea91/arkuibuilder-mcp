import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { callText, ensureExported, parseComponent } from "../dist/parser.js";

test("finds exported struct and required members", () => {
  const info = parseComponent(`@Component
export struct ColorStudio {
  @Link step: number
  @Prop title: string
  @Prop color: ResourceColor = Color.Red
  @State private open: boolean = false
  private size: number = 500

  build() {
    Column() { Text(this.title) }
  }
}`);
  assert.equal(info.name, "ColorStudio");
  assert.equal(info.exported, true);
  assert.deepEqual(info.requiredParams.map((p) => p.name), ["step", "title"]);
  assert.equal(callText(info), "ColorStudio({ step: this.step, title: '' })");
});

test("decorator on its own line, Require, arrow types", () => {
  const info = parseComponent(`@Component
struct Card {
  @Require @Prop
  label: string = 'x'
  @ObjectLink
  item: Item
  @Watch('onChange') @Link count: number
  @BuilderParam content: () => void
  build() {}
}`);
  assert.equal(info.exported, false);
  assert.deepEqual(info.requiredParams.map((p) => p.name), ["label", "item", "count", "content"]);
});

test("comments and strings do not confuse it", () => {
  const info = parseComponent(`// @Component struct Fake {}
@Component
export struct Real {
  /* @Link nope: number */
  private s: string = '}{ @Link x: number'
  @Link yes: number
  build() {}
}`);
  assert.equal(info.name, "Real");
  assert.deepEqual(info.requiredParams.map((p) => p.name), ["yes"]);
});

test("prefers the exported struct; plain snippets are not components", () => {
  assert.equal(parseComponent("@Component\nstruct Helper { build() {} }\n@Component\nexport struct Main { build() {} }").name, "Main");
  assert.equal(parseComponent("Button('Click me')\n  .onClick(() => {})"), null);
});

test("ensureExported adds export", () => {
  const code = "@Component\nstruct Card {\n  build() {}\n}";
  assert.equal(parseComponent(ensureExported(code, parseComponent(code))).exported, true);
});

test("matches the IDE plugin's call for every catalog widget", () => {
  const widgets = JSON.parse(readFileSync(new URL("./fixtures/catalog.json", import.meta.url))).widgets;
  // Produced by the plugin's ComponentParser over the same catalog, in the same order.
  const expected = readFileSync(new URL("./fixtures/plugin-calls.txt", import.meta.url), "utf8").trim().split("\n");
  const actual = widgets.filter((w) => w.code).map((w) => callText(parseComponent(w.code)));
  assert.equal(actual.length, 226);
  assert.deepEqual(actual, expected);
});
