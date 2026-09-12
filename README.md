# Nexa Dashboard (`@kufayeka/node-red-nexa-dashboard`)

> **A Node-RED-native, dual-canvas visual builder for HMI / SCADA / web dashboards.**
> Design screens with a drag-drop UI canvas, wire up interactivity with a Node-RED-style
> visual Logic canvas, and publish them as standalone pages served straight out of your
> Node-RED instance — no separate server, no separate build, no core patches.

This document describes the **actual current implementation** (verified against the
source in this package, not aspirational marketing copy). Anything not yet built is
called out explicitly under [§13 Known Limitations & Roadmap](#13-known-limitations--roadmap)
instead of being described as if it already worked.

---

## Table of Contents

1. [What this package actually is](#1-what-this-package-actually-is)
2. [High-level architecture](#2-high-level-architecture)
3. [Package layout & the build pipeline](#3-package-layout--the-build-pipeline)
4. [Data model](#4-data-model)
5. [The editor (Pages tray)](#5-the-editor-pages-tray)
6. [The Logic canvas in detail](#6-the-logic-canvas-in-detail)
7. [Basic Shape Components — practical usage](#7-basic-shape-components--practical-usage)
8. [Reusable Screen Templates](#8-reusable-screen-templates)
9. [The Lit Component node](#9-the-lit-component-node)
10. [The deployed runtime](#10-the-deployed-runtime)
11. [The component plugin contract (`window.NEXA.registerComponent`)](#11-the-component-plugin-contract-windownexaregistercomponent)
12. [Writing your own component plugin, step by step](#12-writing-your-own-component-plugin-step-by-step)
13. [Known limitations & roadmap](#13-known-limitations--roadmap)
14. [Installation & development workflow](#14-installation--development-workflow)
15. [License](#15-license)

---

## 1. What this package actually is

Nexa Dashboard is **one Node-RED plugin package**, installed like any other
`node-red-contrib-*` module, that adds:

- A **"Pages" editor** — a full-tray visual design surface (opened via the hamburger
  menu or the "Nexa" sidebar tab) where you lay out one or more **screens**, each
  containing draggable/resizable/rotatable **components** and an independent
  **Logic graph** (a small Node-RED-style flow of nodes/wires scoped to that one screen).
- A **config node** (`kufayeka-nexa-project`) that stores the screens/components/logic
  data. It travels with your flow — Deploy, export/import, and Node-RED Projects (git)
  persist it automatically. There is no separate JSON file and no separate save button.
- A **deployed-page runtime** — every screen is also servable as a plain, public HTML
  page under `/nexa/<screen-path>` on Node-RED's own HTTP server, independent of the
  authenticated editor.
- An **open component plugin contract** (`window.NEXA.registerComponent`) so any npm
  package can add new draggable widget types (shapes, gauges, charts, custom SCADA
  symbols, …) to the palette, using either plain DOM/CSS/SVG or a framework like Lit.

It runs **in-process**, inside the same Node-RED instance as everything else — it is not
a second server, and it does not fork or proxy to another process.

---

## 2. High-level architecture

```
+-----------------------------------------------------------------------------------+
|                                  NODE-RED PROCESS                                  |
|                                                                                     |
|  +----------------------------+          +---------------------------------------+ |
|  | @kufayeka/                 |  in-      | @kufayeka/node-red-nexa-dashboard     | |
|  | node-red-asset-engine      | process   |                                       | |
|  | (ISA-95 asset/tag tree,    |  calls    |  nodes/nexa-project.js  (config node) | |
|  |  ISA-95-style attributes,  | <-------> |  lib/nexa-plugin.js     (backend      | |
|  |  calc scripts, schedules)  |           |    plugin: httpNode routes + Asset    | |
|  |                             |           |    Engine subscription)              | |
|  +----------------------------+          |  lib/nexa-plugin.html   (editor plugin,| |
|                                            |    BUILT from src/ — see §3)          | |
|                                            |  lib/nexa-registry-client.js          | |
|                                            |  lib/nexa-runtime-client.js  (public  | |
|                                            |    runtime, served to deployed pages) | |
|                                            +--------------------+------------------+ |
+-------------------------------------------------------------------|------------------+
                                       Plugin discovery              |
                              (RED.plugins.getByType                 v
                              ("nexa-ui-component-package"))   +---------------------------+
                                                                | 3rd-party component      |
                                                                | plugin packages           |
                                                                | (e.g. @kufayeka/          |
                                                                |  nexa-component-basic-    |
                                                                |  shapes)                  |
                                                                +---------------------------+
```

Two Node-RED subsystems are reused directly, exactly as-is, rather than reinvented:

- **`RED.plugins`** — Nexa itself is registered as *two* plugins in the same package
  (an editor-side one and a backend/runtime-side one — see §3), and every component
  package is discovered the same generic way, via
  `RED.plugins.getByType("nexa-ui-component-package")`.
- **`RED.tray.show`** — the entire "Pages" editor lives inside one full-width tray
  (`width: Infinity`), not a new core workspace tab. This is a deliberate, zero-core-patch
  choice: Node-RED's central workspace region has no plugin extension point, but the tray
  system does, so the whole design studio is built on top of it instead of forking
  `red.js`/`workspaces.js`.

Because every Node-RED plugin gets its **own fresh `RED` API object** (see
`@node-red/registry/lib/util.js`'s `createNodeApi()`), Nexa's backend never reads
`RED.asset` — that property only exists on the Asset Engine's own copy of `RED`. Instead
it calls the exported escape hatch `getAssetController(RED)` from
`@kufayeka/node-red-asset-engine/lib/asset-plugin.js`, which returns the one real
module-scoped controller singleton regardless of which plugin's `RED` object asks for it.

---

## 3. Package layout & the build pipeline

**Short answer to "is `lib/` still needed now that there's a `src/`?" — yes, both are
required, and they are not redundant with each other.** `src/` is the editor's ES-module
*source* — it doesn't run anywhere by itself; it only exists to be bundled. `lib/` is
where the actual runnable backend artifacts live: the plugin Node-RED loads at startup
(`package.json`'s `"main"` field points directly at `lib/nexa-plugin.js`), and two files
served to public deployed pages that are deliberately hand-written and never touch the
bundler. Deleting `lib/` would break the plugin outright — there is no `src/` equivalent
for any of these three files.

**`lib/` vs. `dist/`, at a glance: `lib/` is (almost entirely) hand-written source;
`dist/` is (entirely) generated output** — with exactly one, unavoidable exception.
Every generated file also carries its own "AUTO-GENERATED, DO NOT EDIT" banner comment
at the very top, so this is never ambiguous if you're just looking at one file in
isolation:
- `lib/nexa-plugin.js`, `lib/nexa-registry-client.js`, `lib/nexa-runtime-client.js` —
  hand-written. No `src/` file produces these; edit them directly.
- `lib/nexa-plugin.html` — **generated**, but pinned to `lib/` by a hard external
  constraint, not a choice: Node-RED's own plugin loader
  (`@node-red/registry/lib/loader.js`) derives a plugin's `.html` filename by swapping
  the extension on its exact registered `.js` path (`lib/nexa-plugin.js` →
  `lib/nexa-plugin.html`) — there's no config for a different location, so this one file
  can never move to `dist/` no matter how much tidier that would look.
- `dist/nexa-editor.bundle.js`, `dist/nexa-lit-vendor.bundle.js` — **generated**, and
  free to live wherever's cleanest since nothing forces their location — both gitignored,
  both rebuilt by `npm run build`.

```
node-red-nexa-dashboard/
├── package.json              # "main": "lib/nexa-plugin.js" — the actual Node-RED entry point
├── build.js                  # esbuild bundler — see below
├── nodes/
│   ├── nexa-project.js       # kufayeka-nexa-project config node (backend)
│   └── nexa-project.html     # ...and its (trivial) edit dialog
├── lib/                       # ⚠️ REQUIRED AT RUNTIME, (almost) all hand-written — see above
│   ├── nexa-plugin.js               # hand-written backend: httpAdmin/httpNode routes, Asset Engine bridge
│   ├── nexa-plugin.html             # ⚠️ the ONE generated exception — pinned here by Node-RED itself, see above
│   ├── nexa-registry-client.js      # hand-written: NEXA registry bootstrap, served to deployed pages
│   └── nexa-runtime-client.js       # hand-written: deployed-page mount + Logic execution engine
├── src/                      # editor source — THIS is what you actually edit
│   ├── index.js               # entry point: registers the editor plugin + sidebar tab
│   ├── registry.js            # window.NEXA bootstrap (editor copy)
│   ├── lit-vendor.js           # Lit re-export, bundled standalone into dist/nexa-lit-vendor.bundle.js (§9.3)
│   ├── param-types.js          # shared typed-param helpers (typedInput/editableList widgets, type coercion)
│   ├── state.js                # global state object, constants, screen/model helpers
│   ├── history.js              # undo/redo stack
│   ├── editor-tray.js          # the "Pages" tray: dual UI/Logic canvas tabs, keybindings
│   ├── canvas/
│   │   ├── canvas-ui.js         # UI canvas render/zoom
│   │   ├── component-renderer.js # renderComponent(), addComponentAt(), drag, Lit/Template mounting
│   │   ├── selection.js          # select/marquee/group/ungroup/flip
│   │   ├── selection-handles.js  # resize/rotate/lock handles
│   │   ├── layers.js             # layer tree, z-order (the "Layers" sidebar tab)
│   │   └── clipboard.js          # copy/cut/paste for UI components
│   ├── logic/
│   │   ├── logic-nodes.js       # Logic node render/drag/add/remove
│   │   ├── logic-wires.js       # bezier wire drawing + radius-based port hit-testing
│   │   ├── logic-selection.js   # Logic canvas select/marquee/copy/paste
│   │   └── logic-zoom.js        # Logic canvas zoom/fit (independent of the UI canvas's)
│   ├── dialogs/
│   │   ├── function-dialog.js    # Function node code editor (RED.editor.createEditor)
│   │   ├── ui-update-dialog.js   # "Update Component" node config
│   │   ├── inject-dialog.js      # Inject node config
│   │   ├── open-url-dialog.js    # Open URL node config
│   │   └── lit-code-dialog.js    # Lit Component's class-body/CSS code editor (§9)
│   └── sidebar/
│       ├── sidebar-content.js       # the 6-tab "Nexa" sidebar shell
│       ├── screens-panel.js         # Screens tab (add/select/delete/settings)
│       ├── templates-panel.js       # Templates tab (§8)
│       ├── properties-panel.js      # Properties tab (per-component inspector)
│       └── palette-events-panel.js  # Components palette + Events tab (Logic chips)
├── test/                     # regression test suite — see §14.1
│   ├── run-all.js             # rebuilds + runs every mock-*.js, prints a PASS/FAIL summary
│   └── mock-*.js              # one file per area (registry/resize/templates/lit/etc.)
├── docs/
│   └── LIT_COMPONENT_GUIDE.md # deep-dive companion to §9
└── dist/                      # 100% generated, gitignored — nothing here is ever hand-edited
    ├── nexa-editor.bundle.js      # ⚠️ AUTO-GENERATED — the raw editor bundle (lib/nexa-plugin.html wraps this)
    └── nexa-lit-vendor.bundle.js  # ⚠️ AUTO-GENERATED from src/lit-vendor.js — Lit runtime for editor + deployed pages
```

### The build step — **`src/` is the source of truth, not `lib/nexa-plugin.html`**

`lib/nexa-plugin.html` and `dist/nexa-lit-vendor.bundle.js` are not written by hand —
both carry an "AUTO-GENERATED, DO NOT EDIT" banner at the top of the file itself as a
second line of defense. `build.js` runs esbuild (IIFE format, `es2020` target) **twice**:

1. Bundles the ES module tree rooted at `src/index.js`, writing the result to both
   `dist/nexa-editor.bundle.js` (the raw bundle) and `lib/nexa-plugin.html` (the same
   bundle wrapped in a single `<script>` tag, preceded by a `<script src>` for the Lit
   vendor bundle — see §9.3 for why Lit isn't folded into this same bundle). This
   `.html` file is what Node-RED's plugin loader actually serves to the editor (a `.html`
   sibling of `lib/nexa-plugin.js`'s registered plugin id is loaded automatically, per the
   standard Node-RED plugin-loader convention) — and it's the **one** generated file that
   is forced to live in `lib/` rather than `dist/`, because that loader convention derives
   the `.html` path by swapping the extension on the *exact* registered `.js` path, with
   no way to point it elsewhere.
2. Bundles `src/lit-vendor.js` standalone into `dist/nexa-lit-vendor.bundle.js`, served as
   a plain script both to the editor (`RED.httpAdmin`) and to deployed pages
   (`RED.httpNode`, under `/nexa/_lit-vendor.js`) — nothing forces *this* one's location,
   so it lives in `dist/` alongside every other generated artifact.

```bash
npm run build     # one-shot build (both bundles above)
npm run watch      # rebuilds on every change under src/ (fs.watch, recursive)
npm test           # rebuild + run the full regression suite, see §14.1
```

**If you edit `lib/nexa-plugin.html` or anything under `dist/` directly, your changes
will be silently overwritten the next time anyone runs `npm run build`.** Always edit the
modular files under `src/` and rebuild. `lib/nexa-plugin.js`, `lib/nexa-registry-client.js`,
and `lib/nexa-runtime-client.js` are genuinely different — **not** part of the build at
all — those three are plain hand-edited files (backend code and public runtime code,
neither of which benefits from bundling) and must be edited directly in `lib/`.

---

## 4. Data model

Everything lives on the `kufayeka-nexa-project` config node's `screens` array — there is
exactly one such config node per flow file in normal use (`getOrCreateProjectConfigNode()`
creates it automatically the first time you open the Pages editor).

```ts
interface Screen {
  id: string;
  name: string;             // e.g. "Overview"
  path: string;              // e.g. "/plant/:id/overview" — matched with simple ":param" segments
  width: number;              // artboard width in px (e.g. 1280)
  height: number;             // artboard height in px (e.g. 800)
  gridSize: number;           // snap grid, px (default 20)
  snap: boolean;               // snap-to-grid on/off
  components: Component[];
  groups: Group[];
  layers: Layer[];             // hierarchical, at least one ("Default Layer")
  logic: { nodes: LogicNode[]; wires: LogicWire[] };
}

interface Component {
  id: string;
  // A registered NEXA component id (e.g. "kufayeka-rect"), OR one of two
  // reserved types the runtime special-cases instead of looking up in the
  // component registry — see §8 and §9:
  //   "@template"      — a Reusable Screen Template instance (needs `templateId`,
  //                       `paramValues`)
  //   "@lit-component" — an inline Lit.js node (needs `litCode`, `litStyles`,
  //                       `litBindable`, `litEvents`)
  type: string;
  x: number; y: number; w: number; h: number;
  rotation: number;            // degrees
  flipH?: boolean; flipV?: boolean;
  locked: boolean;
  g?: string;                  // group id, if this component is grouped
  layerId: string;
  props: Record<string, any>;  // seeded from the component's `defaults`

  // Only present on a "@template" instance (see §8):
  templateId?: string;               // which Template this instance renders
  paramValues?: Record<string, any>; // per-instance static override of the template's
                                       // declared params — a string value that is
                                       // EXACTLY one "{path}" expression is resolved
                                       // against the immediately-enclosing scope's own
                                       // params instead of being used literally

  // Only present on a "@lit-component" instance (see §9):
  litCode?: string;      // the class BODY text — wrapped as `class extends <base> { <litCode> }`
  litStyles?: string;    // plain CSS text — wrapped as `static styles = css\`<litStyles>\`;`
  litBindable?: Array<{ name: string; type: "string"|"number"|"boolean"|"object"|"array"|"color"; defaultValue: any }>;
  litEvents?: Array<{ name: string }>;
}

interface Group { id: string; x: number; y: number; w: number; h: number; }
interface Layer { id: string; name: string; parentId: string | null; visible: boolean; }

// One flat edge list — not Node-RED's node.wires[[...]] nested-array shape.
// Deliberately simpler: fan-out is just "more than one wire with the same `from`".
interface LogicWire { id: string; from: string; to: string; }

// See §6 for the full per-type field reference.
interface LogicNode {
  id: string;
  type: "onload" | "onrender" | "onclose" | "ui-event" | "ui-update"
      | "function" | "debug" | "inject" | "reload" | "open-url"
      // Template-only node types (only offered in the Events tab while
      // editing a Template — see §8):
      | "param-input" | "set-template-param";
  x: number; y: number;
  // ...type-specific fields, see §6
}

// A project's Reusable Screen Templates (see §8) — same shape as Screen
// minus `path`, plus `params`/`identifier`. Stored alongside `screens` on
// the SAME kufayeka-nexa-project config node.
interface ProjectTemplate {
  id: string;
  name: string;
  identifier: string;    // plain user-editable reference field — NOT a routing key
  width: number; height: number; gridSize: number; snap: boolean;
  components: Component[];
  layers: Layer[];
  logic: { nodes: LogicNode[]; wires: LogicWire[] };
  params: Array<{
    id: string; name: string; label: string;
    type: "string" | "number" | "boolean" | "object" | "array" | "color";
    defaultValue: any;
  }>;
}
```

---

## 5. The editor (Pages tray)

Open it via the hamburger menu → **"Pages (Nexa Dashboard)"**, or the **"Nexa"** sidebar
tab's **"Open Pages Canvas"** button. Both call the same `nexa:open-pages-editor` action,
which opens a full-width (`width: Infinity`) tray.

### Sidebar — 5 tabs

| Tab | Purpose |
| --- | --- |
| **Components** | Palette of every registered component type (from all installed component packages), grouped by `category`. Drag a chip onto the UI canvas to place it. |
| **Screens** | Add/select/delete screens; per-screen settings (name, URL path, width/height, grid size, snap toggle). |
| **Properties** | Inspector for the current selection: one component's full `defaults` schema as editable fields, plus X/Y/W/H/rotation, layer assignment, lock toggle, flip H/V — or, for a multi-selection, group/ungroup, lock/unlock all, and flip. |
| **Layers** | Hierarchical layer tree (nested sub-layers), per-layer visibility toggle, rename, add/delete, and per-component z-order controls (bring to front/forward/backward/send to back). |
| **Events** | The Logic canvas's own "palette" — see §6. |

### Dual canvas: **UI** tab and **Logic** tab

The tray body has its own 2-tab bar (built with the same `RED.tabs.create` widget the
sidebar uses) switching between:

- **UI canvas** — the visual artboard. Fixed screen-size artboard on a dotted grid,
  independent zoom (`Ctrl/Cmd`+scroll or the bottom-right zoom toolbar: `−` / percentage
  / reset / `+` / zoom-to-fit), full click/shift-click/marquee multi-select, group/ungroup
  (`Ctrl+G` / `Ctrl+Shift+G`), 8-handle resize with grid snap, a rotate handle (`Shift`
  = 15° snap), horizontal/vertical flip (`Shift+H` / `Shift+V`), per-component lock,
  copy/cut/paste (`Ctrl+C` / `Ctrl+X` / `Ctrl+V`, pasted copies offset +20px, cut-then-paste
  keeps the original ids), and full undo/redo (`Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z`).
- **Logic canvas** — a separate, independently-zoomed 2000×1400 canvas per screen holding
  that screen's Logic graph. See §6.

Switching tabs is guarded both ways: dragging a UI component chip onto the Logic tab (or
a Logic/Events chip onto the UI tab) is rejected with a warning notification rather than
silently doing the wrong thing.

**Important design decision:** the editor tray is a **pure design surface**. Opening the
tray, switching screens, dragging components, and editing Logic node config **does not
execute anything** — no lifecycle nodes fire, no `ui-event`/`ui-update` wiring runs, and
no Function node code is evaluated while you are editing. All of that only happens on the
actual deployed page (§10). This was a deliberate correction during development: an
earlier version *did* execute the Logic graph inside the editor tray, which produced
confusing side effects (and diverged from what actually happens once a page is deployed).

### Undo/redo model

A single independent stack (`state.undoStack` / `state.redoStack`, not Node-RED's own
`RED.history`) records typed events: `add`, `delete`, `move`, `resize`, `rotate`, `flip`,
`group`, `ungroup` for the UI canvas, and `addLogicNode`, `deleteLogicNode`,
`moveLogicNode`, `addLogicWire`, `deleteLogicWire` for the Logic canvas, plus a `multi`
wrapper (an ordered list of the above, replayed/reversed together) for any action that
touches more than one thing at once — e.g. dragging 3 selected components, or deleting a
multi-selection. `Ctrl+Z`/`Ctrl+Shift+Z` (or `Ctrl+Y`) walk this stack and automatically
re-render whichever canvas (UI or Logic) the event belongs to.

---

## 6. The Logic canvas in detail

Each screen has its own Logic graph: absolutely-positioned node boxes on a 2000×1400
canvas, connected by SVG cubic-bezier wires, styled to match Node-RED's own node
chrome (`var(--red-ui-node-border)`, `var(--red-ui-view-background)`, etc.) — colored
left-edge band per node kind, small square input/output ports, full multi-select
(click/shift-click/marquee), group-drag, copy/cut/paste, and batch delete (one undo step
for a multi-selection).

Wiring: click-drag from an output port draws a temporary dashed line; releasing over an
input port within a **26px hit radius** (not a literal pixel dot — this is deliberately
forgiving, unlike a naive `elementFromPoint` hit-test) commits the wire and turns it solid.
Clicking an existing wire deletes it (hover turns it red first as a warning).

### Node kinds

| Type | Label | In | Out | Color | Config (double-click to edit) |
| --- | --- | :-: | :-: | --- | --- |
| `onload` | On Load | — | ✔ | green | none — fires once per page load |
| `onrender` | On Render | — | ✔ | green | none — fires once per page load, right after `onload` |
| `onclose` | On Close | — | ✔ | green | none — fires on `window.beforeunload` |
| `ui-event` | *(component-specific, e.g. "Rect1 → Clicked")* | — | ✔ | blue | none — dropped from the **Events** tab, already bound to one component + one event name |
| `ui-update` | *(e.g. "Update Rect1")* | ✔ | — | orange | a form with X/Y/W/H/rotation plus every one of the target component's `defaults` fields — each left blank means "don't touch, or take it from `msg` at runtime" |
| `function` | Function | ✔ | ✔ | purple | an Ace code editor (`RED.editor.createEditor`); receives `msg`, returns a new `msg` (or `null`/`undefined` to stop propagation there) |
| `debug` | Debug | ✔ | — | gray | none — logs the incoming `msg` to the browser console |
| `inject` | Inject | — | ✔ | light green | payload type (`json` / `str` / `num` / `date`), payload value, repeat interval in ms (0 = no repeat), "fire once on startup" |
| `reload` | Reload Page | ✔ | — | gray | none — calls `window.location.reload()` |
| `open-url` | Open URL | ✔ | — | teal | navigation mode (replace whole URL vs. sub-path/"endpoint" relative to the current screen), URL/endpoint value, open in new tab |
| `param-input` | On Params Change | — | ✔ | green | none — **only offered while editing a Template** (see §8). Subflow-Input analogue: fires the current instance's full param snapshot as `msg.payload`, once on mount and again every time any of its params change |
| `set-template-param` | *(e.g. "Instance #xxxx → Set Value")* | ✔ | — | purple | none — dropped from the **Events** tab like `ui-event`/`ui-update`, already bound to one `@template` instance + one declared param name; sets `msg.payload` as that param's new live value and cascades into any bound nested instance (see §8) |

The **Events** sidebar tab is where `ui-event` and `ui-update` node chips come from: for
every component currently on the screen, it lists one draggable chip per declared event
(`"<Component> → <event label>"`) and a single consolidated **"<Component> → Update"**
chip (one `ui-update` node configures *any* combination of that component's properties —
there is no more one-node-per-property). A `@template` instance instead gets one
**"<Instance> → Set `<Param>`"** chip per param its Template declares (§8); a
`@lit-component` instance gets one **"<Instance> → on `<event>`"** chip per declared
event plus the same consolidated **"→ Update"** chip (§9). Selecting a component on the
canvas highlights its chips here (and vice versa is not implemented — see §13).

### Execution engine — **only runs on the deployed page**

The functions that actually walk the graph (`runLogicGraph`, `continuePropagation`,
`fireLifecycle`, `fireUiEvent`, `applyUiUpdateProp`/`applyUiUpdateMulti`) exist **only**
in `lib/nexa-runtime-client.js` — the file served to public, deployed pages. The editor
never imports or calls any of them; it only builds/edits the graph data.

Execution semantics (verified in the current code):

- **Sources**: `onload`/`onrender` fire once, automatically, right after the page mounts
  its components; `onclose` fires on `beforeunload`; `ui-event` fires when a component
  calls `ctx.emit(eventName, payload)` from inside its own `render()`; `inject` runs its
  own `setInterval` (floor of 100ms, regardless of the configured interval) and/or a
  one-shot `setTimeout` if "fire once" is set.
- **Fan-out is real fan-out**: a node with two outgoing wires runs both downstream nodes;
  a node with two *incoming* wires from the same cascade runs **twice** — there is no
  per-firing dedup (an earlier version had one specifically to survive wiring cycles, but
  it also silently swallowed legitimate fan-in, so it was removed).
- **Every wire hop gets its own deep-cloned `msg`** (`structuredClone` where available,
  `JSON` round-trip as a fallback, and a manual recursive clone as a last resort for
  circular/non-serializable objects) — so one branch mutating `msg` can never corrupt a
  sibling branch or the parent event.
- **Function nodes support `await`**: the node's code is wrapped as
  `new Function("msg", "return (async function(){ " + code + " })();")`, so
  `await fetch(...)` (or any other promise) works directly in the code box. Because of
  this, *every* Function node call returns a Promise, even fully synchronous code with no
  `await` at all.
- **Loop safeguard is a single shared budget, not a per-call counter**: a naive per-call
  step counter would reset to zero on every `.then()` continuation and therefore *never*
  cap a cycle that runs through an async Function node — since every Function node call is
  now unconditionally async, that failure mode is real, not theoretical. The fix: one
  `budget = { steps: 0 }` object is created by the initial trigger (`fireLifecycle` /
  `fireUiEvent` / the inject timer) and threaded through every recursive call *and* every
  async `.then()` continuation after that. Once `budget.steps` exceeds **2000**, execution
  stops and logs `console.error("[nexa-logic] stopped after 2000 steps...")`.
- **"Update Component" (`ui-update`) merge priority** (lowest to highest, later wins):
  the node's own static `config` object → a plain-object `msg.payload` (so a Function
  node can just do `msg.payload = { text: "hi" }` without knowing about a separate field)
  or a small set of recognized top-level `msg` keys (`fill`, `stroke`, `color`, `text`,
  `rotation`, `x`, `y`, `w`, `h`, `opacity`) → an explicit `msg.properties` object, which
  always wins. `x`/`y`/`w`/`h`/`rotation`/`flipH`/`flipV` are treated as component
  geometry (moved/resized directly); everything else is written to `comp.props.<key>` and
  applied via the component's `onBind(el, "props.<key>", value)` if it has one, or a full
  `render()` re-invocation otherwise (a `@lit-component` sets the property directly on
  its mounted custom element — Lit's own reactivity re-renders it, no `onBind` involved).
  **`msg.properties` must be a whole object you assign, not a nonexistent one you mutate**
  — this is the single most common Function-node mistake when targeting a *custom*
  bindable prop name (one that isn't in the recognized top-level-key list above, e.g. a
  `@lit-component`'s own declared prop):
  ```js
  // WRONG — msg.properties is undefined the first time this runs; this throws
  // "Cannot set properties of undefined (setting 'prop1')"
  msg.properties.prop1 = msg.payload;
  return msg;

  // RIGHT — assign the whole object
  msg.properties = { prop1: msg.payload };
  return msg;
  ```
- **Verbose logging is off by default** on deployed pages (nobody wants a live SCADA
  screen spamming devtools). Run `window.NEXA_LOGIC_VERBOSE = true` in the browser console
  to turn on step-by-step `[nexa-logic] ...` tracing for that page load. `debug` nodes
  always log, regardless of this flag.

---

## 7. Basic Shape Components — practical usage

`@kufayeka/nexa-component-basic-shapes` is the bundled reference component package —
installed alongside Nexa Dashboard, it registers 8 component types under the **"Basic"**
palette category. This section is the practical "what does each one actually do" guide;
§11/§12 cover the underlying contract if you want to write your own.

All 8 share the same basic recipe: drag the chip onto the UI canvas, then use the
**Properties** tab to edit its fields (each maps 1:1 to a key in `comp.props`), and the
**Events** tab to wire its `click` event and/or drop an **"→ Update"** node targeting it.

| Component id | Palette label | Default size | Key props (`defaults`) | Notes |
| --- | --- | --- | --- | --- |
| `kufayeka-rect` | Rectangle | 120×80 | `fill`, `stroke`, `strokeWidth`, `strokeStyle`, `borderRadius`, `opacity`, `shadowBlur`, `shadowColor` | Plain `<div>` styling (border/background/box-shadow) — no SVG |
| `kufayeka-ellipse` | Circle / Ellipse | 100×100 | `fill`, `stroke`, `strokeWidth`, `strokeStyle`, `opacity`, `shadowBlur`, `shadowColor` | Same as Rectangle with `border-radius: 50%` |
| `kufayeka-triangle` | Triangle | 100×100 | `fill`, `stroke`, `strokeWidth`, `strokeStyle`, `direction` (`up`\|`down`\|`left`\|`right`), `opacity` | Inline SVG `<polygon>`, non-scaling stroke |
| `kufayeka-diamond` | Diamond | 100×100 | `fill`, `stroke`, `strokeWidth`, `strokeStyle`, `opacity` | Inline SVG `<polygon>` |
| `kufayeka-star` | Star | 100×100 | `fill`, `stroke`, `strokeWidth`, `strokeStyle`, `opacity` | Inline SVG `<polygon>`, 10-point star |
| `kufayeka-line` | Line | 140×24 | `stroke`, `strokeWidth`, `strokeStyle`, `arrowStart`, `arrowEnd`, `opacity` | Inline SVG `<line>` with optional arrowhead `<marker>`s |
| `kufayeka-path` | Freeform Path | 120×80 | `pathData` (raw SVG path `d` string), `fill`, `stroke`, `strokeWidth`, `strokeStyle`, `opacity` | For any shape the others can't express — edit `pathData` directly (no visual path editor yet) |
| `kufayeka-text-label` | Text Label | 160×36 | `text`, `color`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `textAlign`, `textDecoration`, `lineHeight`, `letterSpacing`, `backgroundColor`, `padding`, `wordWrap` | The one component in this package built as a Lit web component (`<nexa-text-label>`) rather than plain DOM — see §9 for what that pattern looks like when you write your own |

All 8 fire a `click` event and support the geometry every component gets for free
(x/y/w/h/rotation/lock, flip H/V except Text Label, resize/rotate handles).

### Recipe: change a shape's color when clicked

1. Drop a Rectangle, note its id from the canvas (e.g. `#a1b2`).
2. **Events** tab → drag **"Rectangle #a1b2 → Clicked"** onto the Logic canvas.
3. Drag **"Rectangle #a1b2 → Update"** onto the canvas too, double-click it, and set
   `fill` to a new color in the config form (leave every other field blank).
4. Wire "Clicked" → "Update". Deploy, open the screen, click the rectangle.

### Recipe: drive `pathData` from live data

`kufayeka-path`'s `pathData` isn't in the recognized top-level `msg` key list (§6), so
target it via `msg.properties` from a Function node between your data source and the
`ui-update` node:
```js
msg.properties = { pathData: "M 10 " + msg.payload + " L 100 " + msg.payload };
return msg;
```

---

## 8. Reusable Screen Templates

A **Template** solves "the same 10-field monitoring card needs to appear on this screen
15 times, all wired the same way, without hand-copying it 15 times." A Template is
**data-shape-identical to a Screen** (`components`/`layers`/`logic`, see `ProjectTemplate`
in §4) — no `path` (it's never deployed directly), plus a declared `params` list. Once
created, it's droppable from the **Components** palette (under a **"Templates"** section)
onto a Screen — or onto *another* Template, which is how nesting works — as a `"@template"`
component instance.

### 8.1 Creating and editing a Template

Sidebar → **Templates** tab → **"+ Add Template"**. Its settings form mirrors the
Screens tab's (Name / **Identifier** — a free-text reference field, not a routing key,
replacing the URL-path field a Screen has / Width / Height / Grid size / Snap) — Width
and Height are real, editable fields here, since a Template's own canvas size is
otherwise fixed at creation. Clicking **"Edit"** on a Template row opens the *same* Pages
tray, in **template-editing mode** — a **"← Back to Screens"** bar appears at the top;
everything else (palette, Properties, Events, both canvases) works exactly as it does for
a Screen, because the whole editor is generalized over "the currently active surface"
(a Screen or a Template) rather than forked.

### 8.2 Declaring params

Still on the Templates tab, while editing a Template: the **Parameters** section is a
boxed, sortable list (`buildEditableListWidget` in `src/param-types.js` — the same
Node-RED-native list chrome used by core config-node dialogs like `asset-multi-write`'s
rules). **"+ add"** appends a row with three sub-fields: **Name**, **Label**, and
**Value** — the Value field is a real Node-RED `typedInput` widget (`str`/`num`/`bool`/
`json`, via `buildTypedInputWidget`), and the param's `type` (`string`/`number`/
`boolean`/`object`/`array`) is derived automatically from whichever typedInput type you
pick — there's no separate type dropdown, so the declared type and the actual value can
never drift out of sync with each other.

### 8.3 Using a param inside the Template — automatic interpolation, zero wiring

Any **string** prop on any component *inside* the Template can reference a declared param
by name with `{paramName}` — this is resolved automatically on every render/mount, no
Logic node required:
```json
{ "type": "kufayeka-text-label", "props": { "text": "Speed: {speed} RPM" } }
```
Deep paths work too, for `object`/`array`-typed params — `{info.specs.rpm}`,
`{list[0]}`, `{items[1].label}` — via the same `{path}` grammar. A path that doesn't
resolve (unknown param name, or a missing later segment) is left exactly as literal text,
never rendered as `"undefined"`.

### 8.4 Reading/writing a param from Logic — the Subflow-Input/env-var analogue

Two node types exist **only** in a Template's own Events tab (§6):
- **`param-input`** ("On Params Change") — a source node, the Subflow-Input equivalent:
  fires the instance's current full param snapshot as `msg.payload` once on mount and
  again every time any param changes. Wire it into a Function/Debug node to react to
  params from inside the Template's own Logic.
- **`set-template-param`** — one **"<Instance> → Set `<Param>`"** chip per declared
  param, for every `@template` instance on the *current* canvas (a Screen, or another
  Template while nesting). Wire a Function/Inject node into it; `msg.payload` becomes
  that instance's new live param value, which re-interpolates every prop referencing it,
  re-fires that instance's own `param-input` node(s), and cascades into any nested
  instance bound to it (§8.5) — all without touching the Template's own definition.

### 8.5 Per-instance values: static default (Properties panel) or a `{path}` binding

Drop a Template instance onto a Screen (or another Template) and select it — the
**Properties** panel shows one `typedInput` field per declared param, seeded from the
param's `defaultValue`. Two ways to set it:
- **A literal value** — pick whichever typedInput type matches (`str`/`num`/`bool`/
  `json`) and type the value directly. This is a static per-instance override
  (`comp.paramValues.<name>`), exactly like a Subflow instance's own env-var dialog.
- **A `{path}` binding** — leave the typedInput on its **`str`** type and type an
  expression like `{x}` or `{info.specs.rpm}` as the text value. This is **declarative,
  reactive, and needs zero Logic-node wiring**: it's resolved against the
  *immediately-enclosing* scope's own already-resolved params (the Screen's own param
  state doesn't exist, so this only makes sense for a NESTED instance — one Template
  dropped inside another), and re-resolves automatically whenever the outer param changes
  live via `set-template-param` — the "10 identical monitoring cards, one wired data
  source" use case this feature exists for. A binding only ever looks at its *direct*
  parent's params (never grandparent), but composes correctly through any nesting depth
  because each level re-resolves its own binding the same way, one hop at a time.

### 8.6 Nesting and the cycle guard

A Template dropped inside another Template is mounted/rendered exactly like any other
component — recursively, scaled from its own intrinsic width/height to the instance's
actual `w`/`h`. Two independent guards prevent an infinite loop: the **palette**, while
editing Template A, excludes any Template that already (directly or transitively)
contains A (so you can't even drop it); a **defensive runtime/editor backstop**
(`visitedTemplateIds`, threaded through the recursive mount) renders a clear
`(circular template reference: ...)` box instead of hanging, in case hand-edited or
future-buggy data ever reaches that far.

### 8.7 Worked example — matches the "why does my second card follow the first card's value" question

Two independent Screen instances of the same "Card" Template, each driven by its own
Function+`set-template-param` wiring, each with a NESTED instance bound via `{path}`:

```
Screen
├─ cardA  (@template → "Card")     ← set-template-param("cardA", "value") = "A-DATA"
│   └─ leaf (@template → "Leaf", paramValues: { value: "{value}" })
└─ cardB  (@template → "Card")     ← set-template-param("cardB", "value") = "B-DATA"
    └─ leaf (@template → "Leaf", paramValues: { value: "{value}" })
```
`cardA`'s and `cardB`'s param state is tracked separately (keyed by each instance's own
full namespaced path — `cardA::leaf` and `cardB::leaf` are always distinct), so `leaf`
under `cardA` shows `"A-DATA"` and `leaf` under `cardB` shows `"B-DATA"`, independently —
this is namespace isolation working as designed, not something you need to wire around.
If you ever see the wrong sibling's value in practice, hard-refresh the deployed page
first (`_runtime.js` has no cache-busting query string, so a browser can serve a stale
cached copy from before a fix) before assuming it's a data-modeling bug.

---

## 9. The Lit Component node

A generic, always-available palette entry (under a **"Custom"** section, not tied to any
installed component package) for writing your **own** inline Lit.js component — the
JS/CSS live on the dropped instance itself, authored in the Properties panel — analogous
to Node-RED's own **Function** node (inline code, no separate package needed) or FlowFuse
Dashboard 2's **`ui-template`** node, but Lit-based instead of Vue-based.

> **This section covers the basics.** For internal functions/state, conditional
> rendering, loops, embedding an already-made Screen Template from your own code
> (`this.mountTemplate(...)`), and a full set of worked use cases, see the dedicated
> **[Lit Component Guide](docs/LIT_COMPONENT_GUIDE.md)**.

### 9.1 Authoring

Drop **"Lit Component"** from the palette, select it, and the Properties panel shows:

- **Class body / CSS preview fields** — read-only, just enough to see at a glance that
  code exists (a first-line snippet + character count). Click **"Edit Code..."** to
  actually write/change it — this opens a **modal dialog** (`RED.editor.createEditor`,
  the same widget the core Function node uses, in the same kind of `RED.tray.show`
  dialog the Function node's own editor uses — see `src/dialogs/lit-code-dialog.js`),
  not an inline sidebar editor. This is deliberate, not just a style choice: the
  Properties panel fully rebuilds on almost any interaction elsewhere in it (adding a
  Bindable Property, etc.), which would silently discard anything typed but not yet
  committed if the editor lived inline in the sidebar — a real bug an earlier version
  had. The dialog owns the editor exclusively while open, immune to that.
  - **Class body** is the INSIDE of a Lit class: `render()`, any other methods,
    lifecycle hooks. You do **not** write `class extends LitElement { ... }` yourself —
    just the members that go inside it.
    ```js
    render() {
      return html`<div>Hello, ${this.label}</div>`;
    }
    ```
  - **CSS** is plain CSS text, wrapped as `static styles = css\`...\`;` — scoped to
    *this component only*, for free, via Lit's Shadow DOM (no manual `scoped`/BEM-style
    hacks needed, unlike a plain-DOM component sharing the page's global stylesheet).
  - **Cancel** discards everything typed in the dialog; **Done** commits both the class
    body and CSS at once and re-renders the preview.
- **Bindable Properties** — a boxed, sortable list (`buildEditableListWidget`, the same
  Node-RED-native list chrome used by core config-node dialogs) declaring `{ name,
  defaultValue }` rows here rather than in your own code; each row's Value field is a
  real Node-RED `typedInput` (`str`/`num`/`bool`/`json`) — the property's `type` is
  derived automatically from whichever typedInput type you pick, no separate type
  dropdown. This list is what actually generates the Lit `static properties` declaration
  behind the scenes (so `this.label` in `render()` above just works, reactively, once
  you've declared `label` here) — **and** doubles as this instance's `ui-update`/
  Properties-panel targets, exactly like `defaults` does for a registered component (§11).
- **Events** — another boxed list, declaring `{ name }` rows for anything your code fires
  with `this.emit(eventName, payload)` (an `emit` method every Lit Component instance
  gets for free, wired to the Logic canvas's `ctx.emit` underneath) — each becomes an
  **"<Instance> → on `<name>`"** chip in the Events tab.

### 9.2 Reading data in — from a Logic node

Exactly the pattern documented in §6/§7: a `@lit-component`'s Bindable Properties are
NOT in the recognized top-level `msg` key list, so target them via `msg.properties`
keyed by the bindable prop's name:
```js
// A declared Bindable Property named "prop1" —
msg.properties = { prop1: msg.payload };
return msg;
```
wired into that instance's **"→ Update"** node. Lit's own reactivity re-renders the
component the moment the property is set — there's no `onBind` to write, unlike a plain
registered component.

### 9.3 How it actually runs (useful for debugging)

- Your class body is compiled once via `new Function(...)` into
  `class extends NexaLitBase { <your code> }` (`NexaLitBase` is a thin wrapper around the
  real `LitElement` adding two methods for free: `emit(name, payload)` and
  `mountTemplate(hostEl, templateIdOrName, paramValues, opts)` — the latter lets your own
  code embed an already-authored Screen Template into your shadow DOM, see the
  [Lit Component Guide](docs/LIT_COMPONENT_GUIDE.md#8-embedding-an-already-made-screen-template--thismounttemplate))
  and registered as a custom element with an
  auto-generated tag name (`nexa-lit-<hash of your code+styles+bindable list>`) —
  **same trust boundary as the Function node**: no sandboxing, this runs with full access,
  same as everything else in the admin editor.
- The compiled class is **cached by that hash**, so editing an unrelated instance, or
  re-rendering the same one with unchanged code, never re-registers a duplicate custom
  element (the browser's `customElements` registry only allows defining a given tag once).
  Editing the code/CSS/bindable list *does* produce a new hash → a new tag → a fresh
  element — the old tag simply stops being used, it isn't cleaned up (an accepted,
  standard limitation of live-editing custom elements in any browser).
- Lit itself ships as a plain `<script src>` — `window.NEXA_LIT = { LitElement, html,
  css, nothing }` — loaded once via `RED.httpAdmin` in the editor and once via
  `RED.httpNode` on each deployed page (`dist/nexa-lit-vendor.bundle.js`, built from
  `src/lit-vendor.js` by `build.js`), **not** bundled into the editor's own ES-module
  pipeline. Lit's module-level code runs real browser feature-detection unconditionally at
  import time, so folding it into `dist/nexa-editor.bundle.js` would mean paying that cost
  (and needing a real DOM) the instant the editor bundle loads, whether or not any screen
  actually uses a Lit Component.

---

## 10. The deployed runtime

`lib/nexa-plugin.js` registers a **second** plugin from the same package
(`type: "node-red-runtime-plugin"`) that mounts everything under `RED.httpNode` — the
*public*, unauthenticated Node-RED app, deliberately separate from `RED.httpAdmin` (the
editor-only API) and deliberately prefixed with `/nexa` so it can never collide with a
user's own `http-in` nodes wired into their own flows on the same shared instance:

- `GET /nexa/_registry.js` → `lib/nexa-registry-client.js` (the `window.NEXA` bootstrap —
  a standalone duplicate of the editor's own bootstrap in `src/registry.js`, kept
  separate on purpose so the proven editor code path is never put at risk while iterating
  on the public runtime).
- `GET /nexa/_runtime.js` → `lib/nexa-runtime-client.js` (§6's execution engine, plus DOM
  mounting).
- `GET /nexa/*` → matches the remainder of the path against every screen's `path` pattern
  (simple `:param` segments, e.g. `/plant/:id/overview`, matched by segment count and
  literal equality — not a full path-to-regexp implementation) across the **one**
  currently-deployed project (`getCurrentProject()`), and renders that screen's HTML page:
  an empty `#nexa-runtime-artboard` div sized to the screen's `width`/`height`, followed
  by `_registry.js`, then every component package's declared `runtimeScripts` (in
  registration order), then a `<script>` block embedding the screen JSON plus
  `window.__NEXA_PARAMS__`/`__NEXA_QUERY__` (route params and the request's query string),
  then `_runtime.js`, which immediately mounts `window.__NEXA_SCREEN__` on load.

The screen JSON embedded in that inline `<script>` block is escaped against a classic
`</script>`-injection XSS vector (`<` → `<`) before being serialized — necessary
because component `props` are free-text editor input that ends up embedded verbatim in a
public HTML page.

On backend startup, `lib/nexa-plugin.js` also subscribes once to Asset Engine changes via
`getAssetController(RED).subscribe(...)` and republishes every change through
`RED.comms.publish("nexa/value", meta)` — see §13 for what this is (and isn't) currently
used for.

---

## 11. The component plugin contract (`window.NEXA.registerComponent`)

Any script that calls `window.NEXA.registerComponent(id, definition)` — from the editor
bundle, from a component package's own runtime script, or both (the same `def` shape
works in either context) — adds one draggable component type.

### Mandatory safe-queue bootstrap

Because script load order across independently-installed packages isn't guaranteed,
every component package's own script **must** start with this exact guard so a
registration call arriving before Nexa's own registry has initialized is queued instead
of lost:

```javascript
window.NEXA = window.NEXA || { _q: [], registerComponent: function (id, def) { this._q.push([id, def]); } };
```

Nexa's real registry (`src/registry.js` in the editor, `lib/nexa-registry-client.js` on
deployed pages) replaces `window.NEXA` with the real implementation and immediately
flushes anything queued in `_q`.

### Definition schema

```ts
interface NexaComponentDefinition {
  category?: string;   // palette grouping, e.g. "Basic", "Gauges" (default: "General")
  label?: string;       // palette / inspector display name (default: the registered id)
  icon?: string;         // FontAwesome class, e.g. "fa fa-square-o" (cosmetic only today)
  defaultSize?: { w: number; h: number };  // size when first dropped (default: 100×60)

  capabilities?: {
    resizable?: boolean;   // show resize handles (default: treated as true)
    rotatable?: boolean;    // show the rotate handle (default: treated as true)
    flippable?: boolean;    // allow Flip H/V (default: treated as true; false disables it)
    lockable?: boolean;      // show the lock icon (default: treated as true)
  };

  defaults?: {
    [propName: string]: {
      value: any;
      type: "text" | "number" | "color" | "checkbox" | "select";
      options?: string[];   // only meaningful for "select" in your own render() logic —
                              // the built-in Properties panel does not special-case "select" today
    };
  };

  // Property paths intended for live external (e.g. asset tag) binding.
  // Declared and normalized by the registry today; not yet consumed by any
  // binding UI — see §13.
  bindable?: string[];        // e.g. ["props.fill", "props.stroke"]

  // Events this component can emit toward the Logic canvas. Both forms are accepted —
  // a bare string is normalized to {name, label: "On "+name} automatically.
  events?: Array<string | { name: string; label: string }>;

  // Called on mount AND whenever the component may need a full re-render
  // (e.g. a property was edited in the Properties panel).
  render(el: HTMLElement, props: Record<string, any>, ctx: NexaRenderContext): void;

  // Optional fast path for a single property changing (from the Properties panel,
  // or from a "Update Component" Logic node at runtime). If omitted, a full
  // render() re-invocation is used instead.
  onBind?(el: HTMLElement, target: string, value: any): void;
}

interface NexaRenderContext {
  emit(eventName: string, payload?: Record<string, any>): void;
}
```

### Writing `render()` correctly

- **`el` is already positioned and sized for you.** Nexa's own wrapper div already has
  `position: absolute`, explicit `width`/`height` in px matching the component's actual
  `w`/`h`, and `box-sizing: border-box` set *before* your `render()` runs. **Do not set
  `el.style.width`/`el.style.height` yourself** — doing so overwrites the wrapper's own
  explicit pixel size (e.g. with `"100%"`, which resolves against the *canvas*, not your
  component), making the rendered shape balloon to fill the whole artboard while the
  selection box — which is sized independently, straight from `comp.w`/`comp.h` — stays
  correctly small. (This exact regression happened during development: two shape
  components were fixed by removing a stray `el.style.width = "100%"` from their own
  `render()`.) If you need an inner element sized to fill its parent, size *that child*
  to `100%` — never `el` itself.
- **`render()` can be called more than once** (property edits, layer changes, etc.) —
  assign event handlers idempotently (`el.onclick = function(){...}`, not
  `el.addEventListener(...)`, which would otherwise accumulate duplicate listeners on
  every re-render).
- **`ctx.emit(eventName, payload)`** is how a component notifies the Logic canvas.
  `payload` should be a plain, JSON-serializable object — it gets deep-cloned before
  being handed to any downstream Function/Update node.

---

## 12. Writing your own component plugin, step by step

This mirrors `@kufayeka/nexa-component-basic-shapes` (the bundled example/reference
package — see its own README for the full shape catalogue it ships).

### Step 1 — scaffold the package

```bash
mkdir node-red-nexa-component-indicator
cd node-red-nexa-component-indicator
npm init -y
```

### Step 2 — declare it as a Node-RED plugin in `package.json`

```json
{
  "name": "node-red-nexa-component-indicator",
  "version": "1.0.0",
  "main": "plugin.js",
  "node-red": {
    "version": ">=4.0.0",
    "plugins": {
      "nexa-indicator": "plugin.js"
    }
  }
}
```

Node-RED's plugin loader discovers this from any package installed alongside Node-RED
(same mechanism as `node-red-contrib-*` nodes) — no changes to Nexa Dashboard itself, and
no registration call anywhere in Nexa's own code. Nexa only ever asks Node-RED for
`RED.plugins.getByType("nexa-ui-component-package")` — your package shows up there purely
because of `type` in the definition below.

### Step 3 — the plugin backend (`plugin.js`)

```javascript
const path = require("path");
const express = require("express");

module.exports = function (RED) {
  RED.plugins.registerPlugin("nexa-indicator", {
    type: "nexa-ui-component-package",
    // Every script listed here is injected, in order, into BOTH the editor's
    // Pages tray (so you can drag it in the palette) and every deployed page
    // that uses it (so it actually renders once published) — see §10.
    runtimeScripts: [
      "/nexa-indicator/client.js"
    ],
    onadd: function () {
      const staticDir = express.static(path.join(__dirname, "public"));
      // Both mounts are needed: httpAdmin serves it to the authenticated editor,
      // httpNode serves it to public deployed pages. Skipping either one means
      // your component works in only one of the two contexts.
      if (RED.httpAdmin) RED.httpAdmin.use("/nexa-indicator", staticDir);
      if (RED.httpNode) RED.httpNode.use("/nexa-indicator", staticDir);
    }
  });
};
```

### Step 4 — the component itself (`public/client.js`)

```javascript
(function () {
  window.NEXA = window.NEXA || { _q: [], registerComponent: function (id, def) { this._q.push([id, def]); } };

  NEXA.registerComponent("custom-indicator", {
    category: "Sensors",
    label: "LED Indicator",
    icon: "fa fa-lightbulb-o",
    defaultSize: { w: 40, h: 40 },
    capabilities: { resizable: true, rotatable: true, flippable: true, lockable: true },
    defaults: {
      active: { value: false, type: "checkbox" },
      activeColor: { value: "#4caf50", type: "color" },
      inactiveColor: { value: "#9e9e9e", type: "color" }
    },
    bindable: ["props.active", "props.activeColor"],
    events: [{ name: "click", label: "Clicked" }],

    render: function (el, props, ctx) {
      // el is already the right size — style its contents, don't resize el itself.
      el.style.borderRadius = "50%";
      el.style.width = "100%";   // OK here only because el has no siblings competing
      el.style.height = "100%";  // for its box — for anything with a border/shadow that
                                  // must exactly track comp.w/h, prefer NOT touching
                                  // el's size at all (see §11's warning).
      el.style.backgroundColor = props.active ? props.activeColor : props.inactiveColor;
      el.style.boxShadow = props.active ? "0 0 12px " + props.activeColor : "inset 0 1px 3px rgba(0,0,0,0.5)";
      el.style.transition = "background-color 0.2s, box-shadow 0.2s";
      el.onclick = function () {
        ctx.emit("click", { active: props.active });
      };
    },

    onBind: function (el, target, value) {
      if (target === "props.active") {
        el.style.backgroundColor = value ? "#4caf50" : "#9e9e9e";
      }
    }
  });
})();
```

### Step 5 — install and verify

Add the package as a dependency the same way you would any other Node-RED node package
(see §14), restart Node-RED, then:

1. Open **Pages** — your component should appear in the **Components** palette under
   category **"Sensors"**.
2. Drag it onto a screen — it should render at 40×40 and its selection box should match.
3. Open the **Events** tab — with the indicator selected/present on the screen, you
   should see a **"LED Indicator #xxxx → Clicked"** chip and a **"LED Indicator #xxxx →
   Update"** chip, draggable onto the Logic canvas.
4. Deploy, then open the screen's public `/nexa/<path>` URL — clicking the indicator
   there should actually fire whatever you wired its `click` event to (only the deployed
   page executes Logic — see §6).

---

## 13. Known limitations & roadmap

Documented honestly so nobody builds on top of something that isn't really there yet:

- **Asset Engine live tag-binding is not wired up end-to-end.** The backend
  (`lib/nexa-plugin.js`) *does* subscribe to `@kufayeka/node-red-asset-engine` and
  republish every change via `RED.comms.publish("nexa/value", meta)` — but nothing
  currently subscribes to that channel, on either the editor side or the deployed-page
  side. The `bindable` field on a component definition is a real, normalized part of the
  contract, but there is no picker UI anywhere to actually bind a component property to
  an asset tag path yet. Practically, if you need a Nexa screen to react to live data
  today, the only two ways are: (a) an `inject` Logic node polling on an interval, driven
  by a Function node that fetches the value itself (e.g. `await fetch(...)` against an
  Asset Engine HTTP endpoint), or (b) extending `lib/nexa-runtime-client.js` yourself. A
  proper live-binding picker (reusing the Asset Engine's existing hierarchy-autocomplete
  pattern) is the natural next step here, not yet built.
- **The Logic canvas never executes inside the editor, by design.** This means there is
  no "test it live in the tray" workflow — you always have to Deploy and open the actual
  deployed page to see Logic run. This was a deliberate correction (an earlier version
  did execute Logic in the editor, which caused confusing side effects), not an oversight.
- **Selecting a component on the canvas highlights its Events-tab chips, but not the
  reverse** — clicking an Events chip does not select/scroll to the underlying component.
- **`icon` and `select`-type `defaults` fields are cosmetic conventions only** — nothing
  in the built-in palette or Properties panel currently renders a `<select>` for a
  `type: "select"` field (it falls back to a plain text input); component authors wanting
  a real dropdown must build it themselves inside `render()`.
- **Screen path matching is intentionally simple** (`:param` segments, exact segment
  count, no wildcards/regex) — not a full router. Good enough for
  `/plant/:plantId/overview`-style routes; not a substitute for Express's own
  `path-to-regexp` if you need more.
- **Only one project (config node) is served publicly at a time**
  (`getCurrentProject()` tracks the most recently loaded `kufayeka-nexa-project` node
  module-globally). Multiple Nexa project config nodes in the same flow file are not a
  supported multi-tenant setup today.
- **A `@lit-component`'s actual Shadow-DOM rendering has not been verified against a real
  browser DOM in an automated test** — this codebase's own headless mock-test harness
  (plain Node.js, no real `HTMLElement`/`customElements`/Shadow DOM) can and does verify
  the mount/compile/cache/`ui-update` wiring around it, but not whether Lit itself then
  paints correctly. Boot-test any non-trivial Lit Component by hand before relying on it.
- **`_registry.js`/`_runtime.js`/`_lit-vendor.js` are served with no cache-busting query
  string.** If you deploy a fix to this package itself and a previously-opened deployed
  page still looks wrong, hard-refresh (or open in a private window) before assuming the
  fix didn't take — the browser may be serving an old cached copy of one of those scripts.
- **A `set-template-param`/declarative-`{path}`-binding cascade only reaches ONE level of
  nesting depth from where the change originates** (by design — see §8.5 on why a binding
  only ever looks at its direct parent, never a grandparent). A chain three or more
  Templates deep composes correctly on its own (each level re-resolves independently), but
  a `set-template-param` node itself can currently only target a `@template` instance that
  is a **direct child of the surface the node is authored on** — there's no picker for
  reaching a doubly-nested instance from three levels up. Work around it today by putting
  the `set-template-param` node on the *middle* Template's own canvas instead.

---

## 14. Installation & development workflow

This package follows the same convention as `@kufayeka/node-red-asset-engine` in this
monorepo — installed as a `file:` dependency from `data/package.json` (the Node-RED user
directory) rather than published to a registry:

```json
{
  "dependencies": {
    "@kufayeka/node-red-nexa-dashboard": "file:../packages/node_modules/@kufayeka/node-red-nexa-dashboard"
  }
}
```

```bash
cd data
npm install
```

To work on the editor itself:

```bash
cd packages/node_modules/@kufayeka/node-red-nexa-dashboard
npm install         # esbuild, lit
npm run watch         # rebuilds lib/nexa-plugin.html + dist/nexa-lit-vendor.bundle.js on every src/ change
```

**Two different kinds of change need two different kinds of restart, and mixing them up
produces confusing symptoms:**

- **Editor bundle changes** (anything under `src/`, i.e. `lib/nexa-plugin.html` after a
  rebuild) — a plain **browser reload** of the Node-RED editor tab is enough; the plugin
  `.html` is fetched fresh on every editor page load.
- **Backend node/plugin registration changes** (`nodes/nexa-project.js`,
  `lib/nexa-plugin.js`, or a fresh `npm install` in `data/` after adding this package as a
  dependency for the first time) — these run **once, at Node-RED process startup**
  (`RED.nodes.registerType(...)` / `RED.plugins.registerPlugin(...)`). A browser reload
  does **not** re-run them. If the editor ever reports *"kufayeka-nexa-project node type
  not found"*, this is almost always the cause — restart the actual Node-RED **process**
  (not just the browser tab), and confirm `data/node_modules/@kufayeka/
  node-red-nexa-dashboard` actually resolves (a broken/missing `file:` link after moving
  the repo, or an `npm install` that never completed in `data/`, produces the identical
  symptom).

### 14.1 Running the test suite

```bash
npm test
```

Rebuilds the editor bundle, then runs every `test/mock-*.js` file (plain hand-written
Node.js against a minimal DOM/jQuery shim — no `jsdom` in this environment, so anything
genuinely Shadow-DOM/real-browser-specific is called out as such in the relevant test's
own header comment rather than silently assumed to be covered) and prints a PASS/FAIL
summary. Add a new `mock-*.js` file to `test/` and its filename to the appropriate array
in `test/run-all.js` to extend coverage — see any existing `mock-*.js` file's own header
comment for the established pattern (what it mocks, what it deliberately does not).

---

## 15. License

MIT © Kufayeka Tech
