# ArkUIBuilder MCP

MCP server that gives AI assistants (Claude Code, Claude Desktop, Cursor, …) the
[ArkUIBuilder](https://huaweidevelopers.com) catalog of ready-made HarmonyOS ArkUI components.

Instead of writing UI components from scratch, the assistant finds a tested one, has this server copy it
into the project, and writes only the call:

```text
You:    Build a fitness page with a step ring and a dark-mode toggle, using ArkUIBuilder widgets.
Claude: search_widgets("progress ring")  → ProgressRingFb({ value: this.value })
        search_widgets("toggle")         → SwitchFb({ on: this.on })
        add_widget(ProgressRingFb, …/pages/Fitness.ets)   ← file + import written by the server
        add_widget(SwitchFb, …/pages/Fitness.ets)
        …writes only the page: @State value, @State on, and the two calls in build()
```

Because the component code is copied by the server rather than typed by the model, the assistant spends
tokens only on the page itself. For example, `ColorStudioFb`'s signature is ~70 tokens; its source is ~1,400.

## Tools

| Tool | What it does |
|---|---|
| `search_widgets` | Search by words, platform (Mobile, Wearable, PC (2in1), My Widgets) and category. No arguments gives an overview. Each result shows the call and required parameters. |
| `get_widget` | One widget's details; `include_code: true` adds its source (only needed to adapt it). |
| `add_widget` | Writes `<module>/src/main/ets/components/<Name>.ets`, adds `import { Name } from '…'` to `target_file`, returns the call. Never overwrites a different existing file unless `overwrite: true`. Reports `$r()` / `$rawfile()` resources the module lacks. |

It also lists **My Widgets** saved with the [ArkUIBuilder IDE plugin](https://github.com/aea91/arkuibuilder-tool)
(found automatically in the IDE config folders; set `ARKUIBUILDER_MY_WIDGETS` to point at a
`my-widgets.json` elsewhere).

### Sample projects

For HarmonyOS APIs (sensors, heart rate, digital crown, notifications, maps, Bluetooth, NFC, storage, …) the
server also searches the 550+ open source watch projects of [Explore-In-HMOS](https://github.com/Explore-In-HMOS/hmos-index),
so the assistant starts from working code instead of recalling APIs from memory.

| Tool | What it does |
|---|---|
| `search_samples` | Search by words, `kind` (`how-to`, `app`, `lite`, `library`, `companion`), `kit` (e.g. `SensorServiceKit`) and `domain`. No arguments gives an overview. |
| `get_sample` | A project's outline: SDK, requested permissions, and its source files with size and the kits each file imports. `files: [...]` reads specific files; `include_code: true` reads the files that use the distinctive kits, within `max_chars`. |

```text
You:    Show the live heart rate on the watch.
Claude: search_samples("heart rate")                      → how-to-get-heart-rate-with-sensorkit
        get_sample(…)                                     → permissions + files; SendToPhone.ets uses SensorServiceKit
        get_sample(…, files: ["SendToPhone.ets"])         → only that file's code
```

The index ships with the package (`data/samples.json`); source files are fetched from GitHub when asked for.
Without a token GitHub allows 60 file-list requests an hour; set `GITHUB_TOKEN` in the server's `env` if you hit that.
Lite Wearable projects are JavaScript and do not run on Smart Wearable (ArkTS) devices; results say so.

## Setup

Requires Node.js 18+.

**Claude Code**

```bash
claude mcp add arkuibuilder -- npx -y arkuibuilder-mcp
```

**Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`.cursor/mcp.json`) and other MCP clients:

```json
{
  "mcpServers": {
    "arkuibuilder": { "command": "npx", "args": ["-y", "arkuibuilder-mcp"] }
  }
}
```

From a local checkout, use `node /path/to/arkuibuilder-mcp/dist/index.js` as the command instead.

## Development

```bash
npm install
npm test               # builds, then runs parser, importer and stdio end-to-end tests
npm run build:samples  # regenerates data/samples.json from the hmos-index skill references
```

The component parser is a port of the IDE plugin's `ComponentParser.kt`; a test checks that both produce the
same call for every catalog widget (`test/fixtures/plugin-calls.txt`). Environment variables:

| Variable | Purpose |
|---|---|
| `ARKUIBUILDER_CATALOG_FILE` | Read the catalog from a saved `getWidgetCatalog` response instead of the network |
| `ARKUIBUILDER_MY_WIDGETS` | Path of the plugin's `my-widgets.json` |
| `ARKUIBUILDER_SAMPLES_DIR` | Read sample projects from local clones (`<dir>/<repo>/…`) instead of GitHub |
| `GITHUB_TOKEN` | Raises GitHub's rate limit for `get_sample` |
