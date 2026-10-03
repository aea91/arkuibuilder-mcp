import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const work = mkdtempSync(join(tmpdir(), "arkui-mcp-e2e-"));
const myWidgets = join(work, "my-widgets.json");
writeFileSync(
  myWidgets,
  JSON.stringify([{ id: "local-1", title: "Promo Banner", platform: "Mobile", category: "Cards", description: "", code: "@Component\nexport struct PromoBanner {\n  @Prop label: string\n  build() {}\n}", tags: ["promo"] }]),
);

let client;
before(async () => {
  // Real stdio round trip against the built server, with a fixed catalog and My Widgets file.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: {
      ...process.env,
      ARKUIBUILDER_CATALOG_FILE: fileURLToPath(new URL("./fixtures/catalog.json", import.meta.url)),
      ARKUIBUILDER_MY_WIDGETS: myWidgets,
    },
  });
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
});
after(() => client?.close());

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join("\n"), isError: r.isError };
};

test("lists the three tools and gives usage instructions", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["add_widget", "get_widget", "search_widgets"]);
  assert.match(client.getInstructions(), /Do NOT re-type or rewrite/);
});

test("overview, search and My Widgets", async () => {
  const overview = await call("search_widgets", {});
  assert.match(overview.text, /^227 widgets\./);
  assert.match(overview.text, /My Widgets \(1\)/);

  const found = await call("search_widgets", { query: "color studio" });
  assert.match(found.text, /ColorStudioFb\(\{ step: this\.step \}\)/);

  const mine = await call("search_widgets", { platform: "My Widgets" });
  assert.match(mine.text, /PromoBanner\(\{ label: '' \}\)/);
});

test("get_widget includes code only when asked", async () => {
  const brief = await call("get_widget", { name: "colorstudiofb" });
  assert.doesNotMatch(brief.text, /```/);
  const full = await call("get_widget", { name: "ColorStudioFb", include_code: true });
  assert.match(full.text, /export struct ColorStudioFb/);
  assert.equal((await call("get_widget", { name: "Nope" })).isError, true);
});

test("add_widget writes the component and import", async () => {
  const ets = join(work, "app", "entry", "src", "main", "ets");
  mkdirSync(join(ets, "pages"), { recursive: true });
  const page = join(ets, "pages", "Index.ets");
  writeFileSync(page, "@Entry\n@Component\nstruct Index {\n  build() {}\n}\n");

  const r = await call("add_widget", { name: "ColorStudioFb", target_file: page });
  assert.equal(r.isError, false);
  assert.match(r.text, /Created .*components\/ColorStudioFb\.ets/);
  assert.match(r.text, /Call in build\(\): ColorStudioFb\(\{ step: this\.step \}\)/);
  assert.match(r.text, /needs state for: step: number/);
  assert.match(readFileSync(page, "utf8"), /^import \{ ColorStudioFb \} from '\.\.\/components\/ColorStudioFb'\n/);
  assert.match(readFileSync(join(ets, "components", "ColorStudioFb.ets"), "utf8"), /export struct ColorStudioFb/);

  assert.equal((await call("add_widget", { name: "ColorStudioFb", target_file: "pages/Index.ets" })).isError, true);
});
