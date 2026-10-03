# Nexa Dashboard architecture

Read this first. It says where the code for a thing is, how data moves, and where to look when something breaks. The rules for changing the code are in [CONTRIBUTING.md](CONTRIBUTING.md).

## 1. The idea in four lines

- **The project JSON is the truth.** Screens, templates, flows, variables, types, and theme live on the `kufayeka-nexa-project` config node. Node-RED's Deploy saves them.
- **Functional core:** pure functions read and change that JSON (`src/model/`). They have no DOM, no sockets, and no globals, and are tested in plain Node.
- **Imperative shell, kept thin:** the editor (jQuery + Lit in Node-RED's editor), the page runtime (the browser), and the server (Node-RED plugin + worker threads) do the I/O around that core.
- **Registries, not `if` chains:** anything with many kinds is registered. That covers Logic nodes (`src/features/logic/`, and plugins' with SDK `defineLogicNode`), components (SDK `defineComponent`), and tag providers (`defineTagProvider`).

## 2. Where the code runs

```
Node-RED editor (browser)            Deployed page (browser)                Node-RED process (server)
dist/nexa-plugin.html                dist/nexa-runtime.bundle.js            dist/nexa-plugin.js -> src/server/plugin.js
  src/index.js                         src/runtime/index.js                   main thread: plugin, nodes/*.js, the flows
  src/editor-tray.js, canvas/,         features/, mounting/, logic/,          worker: screen-worker (pages, /_io tags)
  sidebar/, logic/, dialogs/           io/ (client.js tags, link.js)          worker: link-worker   (/_link, Nexa Link)
                                                                              worker: sparkplug-worker (MQTT, codec, tag tree)
            └──────────── both use: src/model/ (pure), src/features/logic/ (registry), src/shared/ (wire formats) ────────────┘
```

| Folder | Runs in | What |
| --- | --- | --- |
| `src/model/` | everywhere | The node tree, layout, scopes, types, breakpoints, theme, migration, and routes (`routes.js`: URL → screen, used by the screen worker and the page). Pure. |
| `src/features/logic/` | editor + page | Every Logic node type: `<family>/meta.js`, `editor.js`, `runtime.js`, and its dialogs. See §4. |
| `src/shared/` | page + server | Wire formats, one CommonJS file per protocol, used by both sides: `io/frame.js` (tags), `link/frame.js` (Nexa Link). |
| `src/index.js`, `editor-tray.js`, `canvas/`, `sidebar/`, `logic/`, `dialogs/`, `editor/` | editor | Shell: the Pages tray, the UI canvas, the Logic canvas, the sidebar tabs, and the non-Logic dialogs (screen, flow, template, variables). The Screens & Flows tab is `sidebar/screens-panel.js` (render + public API) with its parts in `sidebar/screens/`: tree-rows, tree-events, tree-actions, item-forms, screen-form, commands. Tree labels / icons: `sidebar/node-labels.js`. |
| `src/state.js` | editor | The editor's state (open screen, selection, zoom…) and project helpers. |
| `src/runtime/` | page | Shell: mount a screen (`mounting/`), navigation, overlays, teleport, theme, breakpoints (`features/`), the Logic engine (`logic/runner.js`), and the tag client and link client (`io/`). |
| `src/sdk/`, `sdk/` | editor + page | The component SDK, the property kit, and the testkit (`sdk/testkit/`). |
| `src/server/` | server | `plugin.js` (wires everything), `workers/`, `screens/render-html.js` (a page's HTML), `io/` (IoHub: tags to pages), `link/` (bridge, hub, token), `sparkplug/` (tree, codec, rebirth), `components/` (built-in components). |
| `nodes/` | server | Node-RED nodes: project, Sparkplug connection, Nexa Link (channel, from Nexa, to Nexa). |
| `dist/` | — | **Generated** by `node build.js`. Never edit. |
| `docs/` | — | How each feature behaves: LAYOUT, STATE, TYPES, THEME, SDK, MEDIA, FLOWS, LINK. |

## 3. How data moves

**A page opens.** The browser requests `GET :1881/nexa/<flow>/<screen>`. The screen worker resolves the route (`resolveScreenRoute` in `src/model/routes.js`) and renders HTML with the project embedded (`src/server/screens/render-html.js`). It also serves `_runtime.js`, `_model.js`, and `_sdk.js`. Then `runtime/index.js` calls `mountScreen` (`features/navigation.js`), which mounts the tree (`mounting/`) and fires the onload / onrender Logic nodes (`logic/runner.js`).

**A tag value arrives.** The main thread is not on this path:
1. MQTT goes into `sparkplug-worker`, which decodes it and updates **its own** tree (`server/sparkplug/sparkplugTree.js`).
2. The worker sends the delta over a `MessageChannel` straight to the screen worker. `plugin.js` sets the channel up in `wireSparkplugSubscription`; the worker sends its snapshot first, then every delta, in order.
3. `IoHub` (`server/io/`) sends binary frames every RPI over `/_io`.
4. The page receives them in `runtime/io/client.js` and `frame.js`, which update the bound components. Both ends use the one wire format `src/shared/io/frame.js`.

Separately, the worker also posts each decoded message to the **main thread**. There `nodes/nexa-sparkplug.js` builds its own tree, for the editor's Sparkplug sidebar, rebirth decisions and `getSnapshot`. A busy flow delays only that part.

Measured by `test/link-e2e.test.js`: while a flow blocks the main thread for 500 ms, the worst tag gap is about 54 ms (it was about 490 ms when the deltas went through main).

If a Sparkplug node has no worker (some tests), `plugin.js` falls back to relaying the main thread's deltas.

**A tag write.** The main thread is not on this path either:
1. A component, or a Sparkplug Write node.
2. `sendSparkplugWrite` (`runtime/io/client.js`) sends `{t:"w"}` over `/_io`.
3. The screen worker's `requestWrite` sends a `write` over the port to `sparkplug-worker`, which publishes a DCMD / NCMD.
4. The worker answers `write-result`, and the page gets its ack.

Without a port, the old path still works: `write-request` → `plugin.js` → `writeMetrics`.

**A Nexa Link request** ([docs/LINK.md](docs/LINK.md)). The path is:
1. A Request node, through `runtime/io/link.js`.
2. `/nexa/_link` on the link worker's own port (`server/link/hub.js`).
3. `bridge.js` on the main thread.
4. A **from Nexa** node, then the flow, then a **to Nexa** node, which answers back the same way.

## 4. Logic nodes: the registry

`src/features/logic/registry.js` holds every node type. A type lives in its family folder:

| Family | Types |
| --- | --- |
| `lifecycle/` | onload, onrender, onclose, inject |
| `ui/` | ui-event, ui-update, layer-control, teleport, overlay-open, overlay-close |
| `control/` | function, switch, delay, join, debug |
| `variables/` | set / get variable (single and multi), on-variable-change |
| `templates/` | param-input, template-output, template-event, set-template-param, populate, layout |
| `navigation/` | navigate, open-url, reload, route-trigger, route-not-found, render-screen, send-to-flow |
| `web/` | http-request, storage, cookie |
| `sparkplug/` | sparkplug-write, sparkplug-write-multi |
| `link/` | link-request, link-send, link-receive |

A Logic node is `{ id, type, x, y, w, h, props: {...} }`: its settings are in `props`. Older projects are migrated on load (`src/model/migrate-logic.js`), or on disk with `node scripts/migrate-project.js <flows.json>`.

A plugin adds node types with the SDK's `defineLogicNode` (`src/sdk/logic-node.js`, docs/SDK.md §12b) into the same registry. The registry lives on `window`, shared by the editor, page and SDK bundles. The editor puts plugin types in the palette under their section and builds their dialog from their fields (`src/logic/logic-fields-dialog.js`). On the page, a chain that reaches a plugin type before its module registered waits for it (`runtime/logic/runner.js`).

Each family has three files:
- `meta.js`: label, colours, icon, ports. Read by both bundles.
- `editor.js`: `label(node)`, `edit(node)` (its dialog, in the same folder), `hint`, `canAdd`, `onAdd`, `decorate`, `portTitle`.
- `runtime.js`: `run(node, msg, ctx)`. It returns a msg to pass it on through output 1. Otherwise it calls `ctx.next(msg)` / `ctx.nextPort(port, msg)` later (async), or does neither (a sink).

The shells only ask the registry: the Logic canvas (`src/logic/logic-nodes.js`), the palette chips (`src/sidebar/palette-events-panel.js`), and the engine (`src/runtime/logic/runner.js`). `test/logic-registry.test.js` fails if a type is incomplete, or if `node.type === "<logic type>"` shows up anywhere else.

What the palette *offers* in each mode (screen / flow / template), and the chips per component or overlay, stays in `palette-events-panel.js`: that is the menu, not the node type.

## 4b. The editor's selection (rules)

- **The selection is state.** It changes only through a select action (`canvas/selection.js`). Drawing never clears it: `renderActiveScreen` drops only the ids that no longer exist, then draws the outline and handles again. This holds for undo / redo, a plugin that registers late, and a theme or breakpoint redraw.
- **A redraw asked for while a pointer pressed on the canvas is down waits for its release** (`state.canvasPointerDown`, `flushDeferredRender`). Emptying the artboard under a click or a drag would cut it.
- **The properties panel** (`sidebar/properties-panel.js`) builds one pass at a time. It commits the field being typed first (blur), to the node it was typed for, and keeps its scroll position while the same node is shown.
- **Canvas shortcuts** (Delete, Enter, Ctrl+Z…) do not act when the focus is in the sidebar, the property kit, a select or a button (`editor-tray.js` `isEditableTarget`).
- Proven end to end by `test/editor-selection-e2e.test.js`.

## 5. Where to look

| Problem | Start here |
| --- | --- |
| A tag shows `???` / never updates | `runtime/io/client.js` (subscribed keys: `window.__nexaRuntime.subscribedTags()`), then `server/io/ioHub.js`, then `screen-worker.js` `setSparkplugPort` / `applySparkplugDelta`, then `sparkplug-worker.js` `applyToTree`, then the broker |
| A tag write does nothing | `runtime/io/client.js` `sendSparkplugWrite`, then `screen-worker.js` `requestWrite` / `finishWrite`, then `sparkplug-worker.js` `publish` |
| The Screens & Flows tree shows / does the wrong thing | `sidebar/screens/tree-rows.js` (what it shows), `tree-events.js` (select / move), `tree-actions.js` (menu / rename) |
| The editor's Sparkplug sidebar is stale | `nodes/nexa-sparkplug.js` (the main thread's tree), `plugin.js` `editorBatcher` |
| A Logic node misbehaves on the page | `src/features/logic/<family>/runtime.js`; the engine: `runtime/logic/runner.js` |
| A Logic node's label / dialog / palette chip | `src/features/logic/<family>/editor.js`, `meta.js` |
| A page 404 / wrong screen for a URL | `src/model/routes.js` `resolveScreenRoute` (tested in `test/model-routes.test.js`); called by `screen-worker.js` `handleScreenRequest`; on the page: `runtime/features/navigation.js` |
| Layout / auto layout / slots look wrong | `src/model/layout.js`, `tree.js` (pure, tested in `test/model-*.test.js`); drawn by `runtime/mounting/render.js` and `canvas/component-renderer.js` |
| A variable doesn't update | `src/model/scope.js`, `runtime/state/variable.js`, `features/logic/variables/`; a **shared** one from another page: `runtime/io/frame.js` (`test/shared-vars-e2e.test.js`) |
| Theme / dark mode | `src/model/theme.js`, `runtime/features/theme.js`, `sidebar/theme-panel.js` |
| A Request / From Node-RED never arrives | `docs/LINK.md`; `GET /nexa/_link-info` (port null = no channel deployed); `server/link/hub.js` |
| A component plugin doesn't load ("unknown component") | `screen-worker.js` `renderScreenHtml` (script URLs), then `docs/SDK.md` |
| Undo / redo | `src/history.js` |

## 6. Adding something

| To add | Do |
| --- | --- |
| A Logic node from a plugin | `defineLogicNode` in the plugin's module (docs/SDK.md §12b). |
| A Logic node type (built in) | An entry in its family's `meta.js`, `editor.js`, `runtime.js` (a new family: a folder plus a line in `features/logic/meta.js`, `editor.js`, `runtime.js`). A palette chip in `palette-events-panel.js`. Nothing else. |
| A component | A plugin package with the SDK (`docs/SDK.md`). Not inside this package. |
| A tag provider | `defineTagProvider` (SDK). |
| Something between threads | A wire format in `src/shared/<name>/` (one file, used by both sides), a test without sockets, then the worker. |
| A Node-RED node | `nodes/<name>.js` + `.html`, registered in `package.json`. |

## 7. Not done yet (structure backlog)

These are known and listed in the order they pay off:
- `var` → `const` / `let`: file by file when a file is touched (CONTRIBUTING §2). Not in bulk: `var` and `let` behave differently in loops with closures.

Done on 2026-10-03:
- the screen on show has one source (`features/navigation.js` getters). This fixed shared variables set on another page not showing.
- Join works on the page (`features/logic/control/join-core.js`).
- Overlay Open passes msg on once, when the overlay closes.
- comments no longer name `lib/`.
