#!/usr/bin/env node
// Builds data/samples.json from the Explore-In-HMOS skill reference files
// (https://github.com/Explore-In-HMOS/hmos-index/tree/main/skill/hmos-wearable-samples/references).
// Run with `npm run build:samples` whenever the hmos-index catalog changes.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://raw.githubusercontent.com/Explore-In-HMOS/hmos-index/main/skill/hmos-wearable-samples/references/";
const FILES = {
  "smart-wearable-how-to.md": "how-to",
  "smart-wearable-apps.md": "app",
  "lite-wearable.md": "lite",
  "libraries-and-cross-platform.md": "library",
};

/** SAMPLES_REFERENCES_DIR reads the .md files from a local folder instead of GitHub. */
async function read(file) {
  const dir = process.env.SAMPLES_REFERENCES_DIR;
  if (dir) return readFileSync(join(dir, file), "utf8");
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

const list = (s) =>
  !s || /only|not applicable/i.test(s) ? [] : s.split(",").map((x) => x.trim()).filter(Boolean);

function parse(md, kind) {
  const out = [];
  let domain = "";
  for (const block of md.split(/\n(?=## |### )/)) {
    const domainHead = block.match(/^## .*\(`([^`]+)`\)/);
    if (domainHead) {
      domain = domainHead[1];
      continue;
    }
    const head = block.match(/^### (\S+)\n([\s\S]*)/);
    if (!head) continue;
    const [, repo, body] = head;
    const [description, ...rest] = body.trim().split("\n");
    const meta = rest.join(" ");
    const field = (name) => meta.match(new RegExp(`${name}: (.*?)\\.(?= [A-Z][\\w ]*:|$)`))?.[1];
    const url = meta.match(/URL: (\S+)/)?.[1];
    if (!url) throw new Error(`No URL for ${repo}`);
    // Libraries file mixes ArkTS libraries, a Flutter app and phone-side companion apps.
    let k = kind;
    if (kind === "library" && !repo.startsWith("library-")) k = /Phone OS/.test(meta) ? "companion" : "cross-platform";
    out.push({
      repo,
      kind: k,
      platform: k === "lite" ? "Lite Wearable" : k === "companion" || k === "cross-platform" ? "Phone" : "Smart Wearable",
      domain,
      description: description.trim(),
      kits: list(field("Kits") ?? field("Modules")),
      topics: list(field("Topics")),
      sdk: (field("SDK") ?? "").replace(/["|]/g, "").trim(),
      url,
    });
  }
  return out;
}

const samples = [];
for (const [file, kind] of Object.entries(FILES)) samples.push(...parse(await read(file), kind));
const names = new Set(samples.map((s) => s.repo));
if (names.size !== samples.length) throw new Error("Duplicate repo names");

const outDir = new URL("../data/", import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(
  new URL("samples.json", outDir),
  JSON.stringify({ source: "https://github.com/Explore-In-HMOS/hmos-index", generated: new Date().toISOString().slice(0, 10), samples }, null, 1) + "\n",
);
const byKind = Object.groupBy(samples, (s) => s.kind);
console.log(`${samples.length} samples: ${Object.entries(byKind).map(([k, v]) => `${k} ${v.length}`).join(", ")}`);
