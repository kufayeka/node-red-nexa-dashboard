# Nexa Dashboard (`@kufayeka/node-red-nexa-dashboard`)

> **A Node-RED-native, dual-canvas visual builder for HMI / SCADA / web dashboards.**
> Design screens with a drag-drop UI canvas, wire up interactivity with a Node-RED-style
> visual Logic canvas, and publish them as standalone pages served straight out of your
> Node-RED instance — no separate server, no separate build, no core patches.

This document describes the **actual current implementation** (verified against the
source in this package, not aspirational marketing copy). Anything not yet built is
called out explicitly under [§10 Known Limitations & Roadmap](#10-known-limitations--roadmap)
instead of being described as if it already worked.

---

## Table of Contents

1. [What this package actually is](#1-what-this-package-actually-is)
2. [High-level architecture](#2-high-level-architecture)
3. [Package layout & the build pipeline](#3-package-layout--the-build-pipeline)
4. [Data model](#4-data-model)
5. [The editor (Pages tray)](#5-the-editor-pages-tray)
6. [The Logic canvas in detail](#6-the-logic-canvas-in-detail)
7. [The deployed runtime](#7-the-deployed-runtime)
8. [The component plugin contract (`window.NEXA.registerComponent`)](#8-the-component-plugin-contract-windownexaregistercomponent)
9. [Writing your own component plugin, step by step](#9-writing-your-own-component-plugin-step-by-step)
10. [Known limitations & roadmap](#10-known-limitations--roadmap)
11. [Installation & development workflow](#11-installation--development-workflow)
12. [License](#12-license)

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

```
node-red-nexa-dashboard/
├── package.json              # "node-red": { plugins: {...}, nodes: {...} }
├── build.js                  # esbuild bundler — see below
├── nodes/
│   ├── nexa-project.js       # kufayeka-nexa-project config node (backend)
│   └── nexa-project.html     # ...and its (trivial) edit dialog
├── lib/
│   ├── nexa-plugin.js        # backend plugin: httpNode routes, Asset Engine bridge
│   ├── nexa-plugin.html      # ⚠️ AUTO-GENERATED — do not hand-edit, see below
│   ├── nexa-registry-client.js  # NEXA registry bootstrap, served to deployed pages
│   └── nexa-runtime-client.js   # deployed-page mount + Logic execution engine
├── src/                      # editor source — THIS is what you actually edit
│   ├── index.js               # entry point: registers the editor plugin + sidebar tab
│   ├── registry.js            # window.NEXA bootstrap (editor copy)
│   ├── state.js                # global state object, constants, screen/model helpers
│   ├── history.js              # undo/redo stack
│   ├── editor-tray.js          # the "Pages" tray: dual UI/Logic canvas tabs, keybindings
│   ├── canvas/
│   │   ├── canvas-ui.js         # UI canvas render/zoom
│   │   ├── component-renderer.js # renderComponent(), addComponentAt(), drag
│   │   ├── selection.js          # select/marquee/group/ungroup/flip
│   │   ├── selection-handles.js  # resize/rotate/lock handles
│   │   ├── layers.js             # layer tree, z-order
│   │   └── clipboard.js          # copy/cut/paste for UI components
│   ├── logic/
│   │   ├── logic-nodes.js       # Logic node render/drag/add/remove
│   │   ├── logic-wires.js       # bezier wire drawing + radius-based port hit-testing
│   │   ├── logic-selection.js   # Logic canvas select/marquee/copy/paste
│   │   └── logic-zoom.js        # Logic canvas zoom/fit (independent of the UI canvas's)
│   ├── dialogs/
│   │   ├── function-dialog.js    # Function node code editor (Ace)
│   │   ├── ui-update-dialog.js   # "Update Component" node config
│   │   ├── inject-dialog.js      # Inject node config
│   │   └── open-url-dialog.js    # Open URL node config
│   └── sidebar/
│       ├── sidebar-content.js       # the 5-tab "Nexa" sidebar shell
│       ├── screens-panel.js         # Screens tab (add/select/delete/settings)
│       ├── properties-panel.js      # Properties tab (per-component inspector)
│       └── palette-events-panel.js  # Components palette + Events tab (Logic chips)
└── dist/
    └── nexa-editor.bundle.js  # ⚠️ AUTO-GENERATED intermediate esbuild output
```

### The build step — **`src/` is the source of truth, not `lib/nexa-plugin.html`**

`lib/nexa-plugin.html` is not written by hand. `build.js` bundles the ES module tree
rooted at `src/index.js` with esbuild (IIFE format, `es2020` target) and writes the
result twice:

- `dist/nexa-editor.bundle.js` — the raw bundle.
- `lib/nexa-plugin.html` — the same bundle wrapped in a single `<script>` tag, which is
  what Node-RED's plugin loader actually serves to the editor (a `.html` sibling of
  `lib/nexa-plugin.js`'s registered plugin id is loaded automatically, per the standard
  Node-RED plugin-loader convention).

```bash
npm run build     # one-shot build
npm run watch      # rebuilds on every change under src/ (fs.watch, recursive)
```

**If you edit `lib/nexa-plugin.html` directly, your changes will be silently
overwritten the next time anyone runs `npm run build` (or `watch` picks up any other
change).** Always edit the modular files under `src/` and rebuild. `lib/nexa-plugin.js`,
`lib/nexa-registry-client.js`, and `lib/nexa-runtime-client.js` are **not** part of the
build — those three are plain hand-edited files (backend code and public runtime code,
neither of which benefits from bundling).

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
  type: string;               // a registered NEXA component id, e.g. "kufayeka-rect"
  x: number; y: number; w: number; h: number;
  rotation: number;            // degrees
  flipH?: boolean; flipV?: boolean;
  locked: boolean;
  g?: string;                  // group id, if this component is grouped
  layerId: string;
  props: Record<string, any>;  // seeded from the component's `defaults`
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
      | "function" | "debug" | "inject" | "reload" | "open-url";
  x: number; y: number;
  // ...type-specific fields, see §6
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
actual deployed page (§7). This was a deliberate correction during development: an
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

The **Events** sidebar tab is where `ui-event` and `ui-update` node chips come from: for
every component currently on the screen, it lists one draggable chip per declared event
(`"<Component> → <event label>"`) and a single consolidated **"<Component> → Update"**
chip (one `ui-update` node configures *any* combination of that component's properties —
there is no more one-node-per-property). Selecting a component on the canvas highlights
its chips here (and vice versa is not implemented — see §10).

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
  `render()` re-invocation otherwise.
- **Verbose logging is off by default** on deployed pages (nobody wants a live SCADA
  screen spamming devtools). Run `window.NEXA_LOGIC_VERBOSE = true` in the browser console
  to turn on step-by-step `[nexa-logic] ...` tracing for that page load. `debug` nodes
  always log, regardless of this flag.

---

## 7. The deployed runtime

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
`RED.comms.publish("nexa/value", meta)` — see §10 for what this is (and isn't) currently
used for.

---

## 8. The component plugin contract (`window.NEXA.registerComponent`)

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
  // binding UI — see §10.
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

## 9. Writing your own component plugin, step by step

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
    // that uses it (so it actually renders once published) — see §7.
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
                                  // el's size at all (see §8's warning).
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
(see §11), restart Node-RED, then:

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

## 10. Known limitations & roadmap

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

---

## 11. Installation & development workflow

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
npm install         # esbuild
npm run watch         # rebuilds lib/nexa-plugin.html on every src/ change
```

Restart Node-RED (or reload the editor tab) after each rebuild to pick up the new
bundle — the plugin `.html` is only read once, at editor load time.

---

## 12. License

MIT © Kufayeka Tech
