import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// A local "clone" of one indexed repo, so get_sample runs without GitHub.
const clones = mkdtempSync(join(tmpdir(), "arkui-mcp-samples-"));
const repo = join(clones, "how-to-get-heart-rate-with-sensorkit");
const files = {
  "entry/src/main/module.json5":
    '{ "module": { "requestPermissions": [ { "name": "ohos.permission.READ_HEALTH_DATA" }, { "name": "ohos.permission.INTERNET" } ] } }',
  "entry/src/main/ets/pages/Index.ets": "@Entry\n@Component\nstruct Index {\n  build() {}\n}\n",
  "entry/src/main/ets/pages/HeartRate.ets":
    "import { sensor } from '@kit.SensorServiceKit';\nimport { hilog } from '@kit.PerformanceAnalysisKit';\nexport const id = sensor.SensorId.HEART_RATE;\n",
  "entry/src/main/ets/entryability/EntryAbility.ets": "export default class EntryAbility {}\n",
  "entry/src/ohosTest/ets/test/Ability.test.ets": "test\n",
  "entry/hvigorfile.ts": "export default {}\n",
  "oh_modules/x/index.ets": "dependency\n",
};
for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

let client;
before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: {
      ...process.env,
      ARKUIBUILDER_CATALOG_FILE: fileURLToPath(new URL("./fixtures/catalog.json", import.meta.url)),
      ARKUIBUILDER_SAMPLES_DIR: clones,
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

test("overview and search over the bundled index", async () => {
  const overview = await call("search_samples", {});
  assert.match(overview.text, /^\d{3} open source HarmonyOS watch projects/);
  assert.match(overview.text, /how-to \(\d+\)/);

  const hr = await call("search_samples", { query: "heart rate", limit: 3 });
  assert.match(hr.text, /how-to-get-heart-rate-with-sensorkit \[How-to/);

  const byKit = await call("search_samples", { kit: "@kit.LocationKit", kind: "how-to" });
  assert.doesNotMatch(byKit.text, /^No samples/);
  assert.doesNotMatch(byKit.text, /\[Sample app/);

  assert.match((await call("search_samples", { query: "zzzz-nothing" })).text, /^No samples match/);
});

test("get_sample outline lists source, kits and permissions, not boilerplate", async () => {
  const r = await call("get_sample", { name: "https://github.com/Explore-In-HMOS/how-to-get-heart-rate-with-sensorkit" });
  assert.equal(r.isError, false);
  assert.match(r.text, /Permissions: ohos\.permission\.READ_HEALTH_DATA, ohos\.permission\.INTERNET/);
  assert.match(r.text, /pages\/HeartRate\.ets {2}~\d+ tok {2}\[SensorServiceKit\]/);
  assert.doesNotMatch(r.text, /PerformanceAnalysisKit/);
  assert.doesNotMatch(r.text, /EntryAbility|ohosTest|hvigorfile|oh_modules/);
  assert.doesNotMatch(r.text, /```/);
});

test("get_sample reads key files or the requested ones", async () => {
  const auto = await call("get_sample", { name: "how-to-get-heart-rate-with-sensorkit", include_code: true });
  // Files using a distinctive kit come first, then pages.
  assert.ok(auto.text.indexOf("### entry/src/main/ets/pages/HeartRate.ets") < auto.text.indexOf("### entry/src/main/ets/pages/Index.ets"));
  assert.match(auto.text, /sensor\.SensorId\.HEART_RATE/);

  const one = await call("get_sample", { name: "how-to-get-heart-rate-with-sensorkit", files: ["Index.ets", "missing.ets"] });
  assert.match(one.text, /### entry\/src\/main\/ets\/pages\/Index\.ets/);
  assert.doesNotMatch(one.text, /### .*HeartRate/);
  assert.match(one.text, /Not found: missing\.ets/);

  assert.equal((await call("get_sample", { name: "no-such-repo" })).isError, true);
  assert.equal((await call("get_sample", { name: "water-tracker" })).isError, true); // no local clone
});
