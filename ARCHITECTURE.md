# Nexa Dashboard architecture

Read this first. It says where the code for a thing is, how data moves, and where to look when something breaks. The rules for changing the code are in [CONTRIBUTING.md](CONTRIBUTING.md).

## 1. The idea in four lines

- **The project JSON is the truth.** Screens, templates, flows, variables, types, and theme live on the `kufayeka-nexa-project` config node. Node-RED's Deploy saves them.
- **Functional core:** pure functions read and change that JSON (`src/model/`). They have no DOM, no sockets, and no globals, and are tested in plain Node.
- **Imperative shell, kept thin:** the editor (jQuery + Lit in Node-RED's editor), the page runtime (the browser), and the server (Node-RED plugin + worker threads) do the I/O around that core.
- **Registries, not `if` chains:** anything with many kinds is registered. That covers Logic nodes (`src/features/logic/`), components (SDK `defineComponent`), and tag providers (`defineTagProvider`).

## 2. Where the code runs

```
Node-RED editor (browser)            Deployed page (browser)                Node-RED process (server)
dist/nexa-plugin.html                dist/nexa-runtime.bundle.js            dist/nexa-plugin.js -> src/server/plugin.js
  src/index.js                         src/runtime/index.js                   main thread: plugin, nodes/*.js, the flows
  src/editor-tray.js, canvas/,         features/, mounting/, logic/,          worker: screen-worker (pages, /_io tags)
  sidebar/, logic/, dialogs/           io/ (client.js tags, link.js)          worker: link-worker   (/_link, Nexa Link)
                                                                              worker: sparkplug-worker (MQTT + codec)
            └──────────── both use: src/model/ (pure), src/features/logic/ (registry), src/shared/ (wire formats) ────────────┘
```

| Folder | Runs in | What |
| --- | --- | --- |
| `src/model/` | everywhere | The node tree, layout, scopes, types, breakpoints, theme, migration. Pure. |
| `src/features/logic/` | editor + page | Every Logic node type: `<family>/meta.js`, `editor.js`, `runtime.js`, and its dialogs. See §4. |
| `src/shared/` | page + server | Wire formats, one file per protocol: `io/` (tags), `link/frame.js` (Nexa Link). |
| `src/index.js`, `editor-tray.js`, `canvas/`, `sidebar/`, `logic/`, `dialogs/`, `editor/` | editor | Shell: the Pages tray, the UI canvas, the Logic canvas, the sidebar tabs, and the non-Logic dialogs (screen, flow, template, variables). |
| `src/state.js` | editor | The editor's state (open screen, selection, zoom…) and project helpers. |
| `src/runtime/` | page | Shell: mount a screen (`mounting/`), navigation, overlays, teleport, theme, breakpoints (`features/`), the Logic engine (`logic/runner.js`), and the tag client and link client (`io/`). |
| `src/sdk/`, `sdk/` | editor + page | The component SDK, the property kit, and the testkit (`sdk/testkit/`). |
| `src/server/` | server | `plugin.js` (wires everything), `workers/`, `io/` (IoHub: tags to pages), `link/` (bridge, hub, token), `sparkplug/` (tree, codec, rebirth), `components/` (built-in components). |
| `nodes/` | server | Node-RED nodes: project, Sparkplug connection, Nexa Link (channel, from Nexa, to Nexa). |
| `dist/` | — | **Generated** by `node build.js`. Never edit. |
| `docs/` | — | How each feature behaves: LAYOUT, STATE, TYPES, THEME, SDK, MEDIA, FLOWS, LINK. |

## 3. How data moves

**A page opens.** The browser requests `GET :1881/nexa/<flow>/<screen>`. The screen worker resolves the route (`handleScreenRequest`) and renders HTML with the project embedded. It also serves `_runtime.js`, `_model.js`, and `_sdk.js`. Then `runtime/index.js` calls `mountScreen` (`features/navigation.js`), which mounts the tree (`mounting/`) and fires the onload / onrender Logic nodes (`logic/runner.js`).

**A tag value arrives.** The path is:
1. MQTT goes into `sparkplug-worker` (decode).
2. The **main thread** `nodes/nexa-sparkplug.js` updates the tree (`server/sparkplug/sparkplugTree.js`) and emits a delta.
3. `plugin.js` posts it to the screen worker.
4. `IoHub` (`server/io/`) sends binary frames every RPI over `/_io`.
5. The page receives them in `runtime/io/client.js` and `frame.js`, which update the bound components.

Known limit: step 2 is on the main thread, so a busy flow delays tags (measured: about 500 ms for a 500 ms block).

**A tag write.** The path is:
1. A component, or a Sparkplug Write node.
2. `sendSparkplugWrite` (`runtime/io/client.js`) sends `{t:"w"}` over `/_io`.
3. The screen worker turns it into a `write-request`.
4. `plugin.js` calls `writeMetrics`.
5. The worker publishes a DCMD / NCMD and acks back.

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

Each family has three files:
- `meta.js`: label, colours, icon, ports. Read by both bundles.
- `editor.js`: `label(node)`, `edit(node)` (its dialog, in the same folder), `hint`, `canAdd`, `onAdd`, `decorate`, `portTitle`.
- `runtime.js`: `run(node, msg, ctx)`. It returns a msg to pass it on through output 1. Otherwise it calls `ctx.next(msg)` / `ctx.nextPort(port, msg)` later (async), or does neither (a sink).

The shells only ask the registry: the Logic canvas (`src/logic/logic-nodes.js`), the palette chips (`src/sidebar/palette-events-panel.js`), and the engine (`src/runtime/logic/runner.js`). `test/logic-registry.test.js` fails if a type is incomplete, or if `node.type === "<logic type>"` shows up anywhere else.

What the palette *offers* in each mode (screen / flow / template), and the chips per component or overlay, stays in `palette-events-panel.js`: that is the menu, not the node type.

## 5. Where to look

| Problem | Start here |
| --- | --- |
| A tag shows `???` / never updates | `runtime/io/client.js` (subscribed keys: `window.__nexaRuntime.subscribedTags()`), then `server/io/ioHub.js`, then `nodes/nexa-sparkplug.js` (the tree), then the broker |
| A tag write does nothing | `runtime/io/client.js` `sendSparkplugWrite`, then `screen-worker.js` `onWrite`, then `plugin.js` `write-request`, then `nexa-sparkplug.js` `writeMetrics` |
| A Logic node misbehaves on the page | `src/features/logic/<family>/runtime.js`; the engine: `runtime/logic/runner.js` |
| A Logic node's label / dialog / palette chip | `src/features/logic/<family>/editor.js`, `meta.js` |
| A page 404 / wrong screen for a URL | `server/workers/screen-worker.js` `handleScreenRequest`; on the page: `runtime/features/navigation.js` |
| Layout / auto layout / slots look wrong | `src/model/layout.js`, `tree.js` (pure, tested in `test/model-*.test.js`); drawn by `runtime/mounting/render.js` and `canvas/component-renderer.js` |
| A variable doesn't update | `src/model/scope.js`, `runtime/state/variable.js`, `features/logic/variables/` |
| Theme / dark mode | `src/model/theme.js`, `runtime/features/theme.js`, `sidebar/theme-panel.js` |
| A Request / From Node-RED never arrives | `docs/LINK.md`; `GET /nexa/_link-info` (port null = no channel deployed); `server/link/hub.js` |
| A component plugin doesn't load ("unknown component") | `screen-worker.js` `renderScreenHtml` (script URLs), then `docs/SDK.md` |
| Undo / redo | `src/history.js` |

## 6. Adding something

| To add | Do |
| --- | --- |
| A Logic node type | An entry in its family's `meta.js`, `editor.js`, `runtime.js` (a new family: a folder plus a line in `features/logic/meta.js`, `editor.js`, `runtime.js`). A palette chip in `palette-events-panel.js`. Nothing else. |
| A component | A plugin package with the SDK (`docs/SDK.md`). Not inside this package. |
| A tag provider | `defineTagProvider` (SDK). |
| Something between threads | A wire format in `src/shared/<name>/` (one file, used by both sides), a test without sockets, then the worker. |
| A Node-RED node | `nodes/<name>.js` + `.html`, registered in `package.json`. |

## 7. Not done yet (structure backlog)

These are known and listed in the order they pay off:
- The tag path off the main thread: the Sparkplug tree into a worker, deltas worker → worker.
- Split `server/workers/screen-worker.js` (routing, HTML, SSE, IO) and `sidebar/screens-panel.js` (2484 lines).
- `hierarchy-panel.js` and `screens-panel.js` carry the same tree label / icon functions: move them to one module.
- One IO wire format: encoder `server/io/ioProtocol.js` (CJS) and decoder `shared/io/protocol.js` (ESM) duplicate the constants. Do it like `shared/link/frame.js`.
- Runtime state: `runtime/state.js` and module variables in `features/navigation.js` both hold the current screen.
- Join has no page implementation (it passes each message on).
- The Overlay Open node passes msg on right away **and** again when the overlay closes. This was kept as is in the registry move; decide whether the first one is wanted.
- `var` → `const` / `let`, and comments that still name `lib/` (gone).
