# Nexa Dashboard (`@kufayeka/node-red-nexa-dashboard`)

> **Enterprise-grade, high-performance visual dashboard, SCADA, and HMI engineering platform native to Node-RED.**
>
> Build rich industrial HMIs, SCADA visualization screens, and reactive web applications directly within Node-RED with zero core monkey-patching. Nexa provides a dual-canvas visual environment (UI WYSIWYG layout & Logic event graph), a multi-threaded architecture with dedicated worker threads, a cyclic binary Realtime Nexa IO Protocol, an Optix-style application hierarchy, and a Lit-based component SDK.

---

## Table of Contents

1. [Executive Overview & Capabilities](#1-executive-overview--capabilities)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Complete Project Tree Structure](#3-complete-project-tree-structure)
4. [Developer Bug-Fixing & Code Architecture Guide](#4-developer-bug-fixing--code-architecture-guide)
   - [4.1 Root & Core Entrypoints (`src/`)](#41-root--core-entrypoints-src)
   - [4.2 UI Design Canvas (`src/canvas/`)](#42-ui-design-canvas-srccanvas)
   - [4.3 Native Modal Tray Dialogs (`src/dialogs/`)](#43-native-modal-tray-dialogs-srcdialogs)
   - [4.4 In-Editor Code Editors (`src/editor/`)](#44-in-editor-code-editors-srceditor)
   - [4.5 Logic Graph Canvas (`src/logic/`)](#45-logic-graph-canvas-srclogic)
   - [4.6 Pure State Model & Tree Operations (`src/model/`)](#46-pure-state-model--tree-operations-srcmodel)
   - [4.7 Modular Deployed Runtime Engine (`src/runtime/`)](#47-modular-deployed-runtime-engine-srcruntime)
   - [4.8 Component SDK & Property Kit (`src/sdk/`)](#48-component-sdk--property-kit-srcsdk)
   - [4.9 Backend Server, Workers & Protocols (`src/server/`)](#49-backend-server-workers--protocols-srcserver)
   - [4.10 Shared Cross-Environment Code (`src/shared/`)](#410-shared-cross-environment-code-srcshared)
   - [4.11 Sidebar Panels & Optix Hierarchy (`src/sidebar/`)](#411-sidebar-panels--optix-hierarchy-srcsidebar)
   - [4.12 Node-RED Backend Nodes (`nodes/`)](#412-node-red-backend-nodes-nodes)
   - [4.13 Build Outputs & Artifacts (`dist/`)](#413-build-outputs--artifacts-dist)
5. [Build Pipeline & Development Workflow](#5-build-pipeline--development-workflow)
6. [Testing & Verification Guide](#6-testing--verification-guide)
7. [License](#7-license)

---

## 1. Executive Overview & Capabilities

Nexa Dashboard transforms Node-RED into a full-featured industrial HMI and SCADA design studio. Instead of relying on rigid, HTML-template widgets or heavyweight external SCADA servers, Nexa embeds directly into the Node-RED process while delegating CPU-intensive operations to dedicated background worker threads.

### Key Capabilities

1. **Dual-Canvas Design Surface (Full-Width Studio Tray)**
   - **UI Canvas**: Drag-and-drop WYSIWYG editor featuring absolute layout, auto-layout frames (Flexbox Row/Column), CSS Grid containers, responsive breakpoint previews (Mobile, Tablet, Desktop), design token theming (Light/Dark mode, custom CSS variables), and snap-to-grid alignment.
   - **Logic Canvas**: Visual wiring editor scoped specifically to individual Screens, Templates, or Screen Flows. Connect component event triggers (`click`, `change`, `render`), route controllers, timer delays, data transforms, and Sparkplug tag writes using Node-RED-style nodes and bezier wires.

2. **Dedicated Multi-Threaded Architecture**
   - **Screen Worker (`screen-worker.js`)**: An isolated background worker thread that hosts a high-speed HTTP runtime server on a dedicated port (default `1881`). Public web clients viewing `/nexa/<screen-path>` are served directly from this worker without contending for the Node-RED main thread event loop.
   - **Sparkplug Worker (`sparkplug-worker.js`)**: A dedicated worker thread handling MQTT Sparkplug B connections, protobuf encoding/decoding, NBIRTH/DBIRTH payload parsing, rebirth cycles, and metric delta batching. Heavy industrial telemetry traffic never throttles UI rendering or Node-RED message processing.

3. **Realtime Nexa IO Protocol (Cyclic Binary Synchronization)**
   - High-performance WebSocket engine (`/nexa/_io` and `ioHub.js`) delivering bidirectional sub-10ms metric streaming between server tag providers and browser UI components.
   - Supports dense binary framing and differential delta packets, minimizing serialization overhead over industrial networks.

4. **Optix-Style Screens, Templates, and Screen Flows Hierarchy**
   - **Unified Navigation Tree (`<nx-tree>`)**: 2D virtualized navigation tree supporting horizontal overflow scrolling (`width: max-content`), deep folder nesting, and distinct categorizations (`screen`, `template`, `flow`).
   - **Templates**: Composite templates (reusable UI screen layouts with custom typed parameters and variables) and Component templates (atomic reusable widgets).
   - **Screen Flows**: Logic-only state machines and routing pipelines capable of route pattern matching (`/devices/:id`), selective cookie extraction, device fingerprinting, middleware verification, and smooth SPA screen replacement without full page reloads.
   - **Component Tree Interaction**: Clicking any component node in the Screens & Flows tree automatically opens the Pages editor tray (if closed), selects the parent screen/template, activates the UI canvas tab, unhides ancestor overlays and slot tabs, and selects the component on the canvas without jumping away from the active sidebar tab.
   - **Protected Double-Click Editing**: Tree nodes in Screens & Flows never enter inline text-input editing on double-click. Instead, double-clicking immediately opens the native Node-RED modal properties tray dialog (`window.RED.tray.show`).

5. **Component SDK & Open Plugin Architecture**
   - Build custom UI components using Lit Web Components, Zag.js accessible state machines, and the Nexa Component SDK (`src/sdk/`).
   - Third-party packages register widgets cleanly via standard Node-RED plugin discovery (`RED.plugins.getByType("nexa-ui-component-package")`).

---

## 2. High-Level Architecture

```text
+-----------------------------------------------------------------------------------------+
|                                    NODE-RED PROCESS                                     |
|                                                                                         |
|  +--------------------------------+           +---------------------------------------+ |
|  | Node-RED Editor / Main Thread  |           | Nexa Server Backend (dist/nexa-plugin)| |
|  |                                |           |                                       | |
|  | • Pages Studio Tray (Infinity) | in-proc   | • Configuration node (nexa-project)   | |
|  | • Sidebar: Screens, Hierarchy, | <-------> | • Sparkplug config (nexa-sparkplug)   | |
|  |   Components, Properties, etc. |  IPC /    | • Asset storage API (/nexa-assets/)   | |
|  | • Native RED.tray properties   |  events   | • Worker thread manager               | |
|  +--------------------------------+           +-------------------+-------------------+ |
|                                                                   |                     |
|                                        Spawns Worker Threads      |                     |
|                   +-----------------------------------------------+                     |
|                   |                                               |                     |
|                   v                                               v                     |
|  +--------------------------------+           +---------------------------------------+ |
|  | Screen Worker (port 1881)      |           | Sparkplug Worker (MQTT / Protobuf)    | |
|  |                                |           |                                       | |
|  | • Isolated HTTP server (1881)  |           | • MQTT Client (TCP / TLS / WS)        | |
|  | • Serves /nexa/<path> HTML/JS  |           | • Sparkplug B Protobuf Codec          | |
|  | • Realtime Nexa IO Hub (/io)   |           | • Metric delta batcher & rebirth      | |
|  | • Cyclic binary WebSocket sync |           | • Offloads heavy PLC payloads         | |
|  +----------------+---------------+           +-------------------+-------------------+ |
+-------------------|-----------------------------------------------|---------------------+
                    |                                               |
         HTTP / WS  | Deployed Screen Clients                       | MQTT Broker
                    v                                               v
   +---------------------------------+             +----------------------------------+
   | Browser Runtime Client          |             | Industrial Field Devices / PLCs  |
   | (/nexa/_runtime.js)             |             | (Sparkplug B EoN Nodes)          |
   | • DOM Mounting & Lit Components |             +----------------------------------+
   | • Nexa IO WebSocket Client      |
   | • Runtime Scopes & Variables    |
   | • SPA Router & Flow Gateway     |
   +---------------------------------+
```

---

## 3. Complete Project Tree Structure

```text
node-red-nexa-dashboard/
├── dist/                                 # 100% AUTO-GENERATED BUNDLES (DO NOT EDIT DIRECTLY)
│   ├── nexa-editor.bundle.js             # Bundled editor studio code (IIFE)
│   ├── nexa-model-client.js              # window.NexaModel for browser deployed pages
│   ├── nexa-model.js                     # CommonJS pure model for Node-RED & workers
│   ├── nexa-plugin.html                  # Node-RED editor plugin definition with bundled script
│   ├── nexa-plugin.js                    # CommonJS entrypoint loader required by package.json
│   ├── nexa-registry-client.js           # Component registry bundle served to deployed pages
│   ├── nexa-runtime.bundle.js            # Modular deployed client runtime (/nexa/_runtime.js)
│   ├── nexa-sdk-kit.bundle.js            # Inspector property kit (<nx-*>) widgets bundle
│   └── nexa-sdk.bundle.js                # Core SDK runtime (Lit + FieldController + codecs)
├── docs/                                 # IN-DEPTH TECHNICAL SPECIFICATIONS & GUIDES
│   ├── FLOWS.md                          # Screens, Templates, Folders & Screen Flows architecture
│   ├── LAYOUT.md                         # Layout system, auto-layout frames & constraints
│   ├── LIT_COMPONENT_GUIDE.md            # Guide to authoring custom Lit components
│   ├── MEDIA.md                          # Media asset management and file uploading
│   ├── SDK.md                            # Nexa Component SDK complete API reference
│   ├── STATE.md                          # Lexical state scoping, variables & expression binding
│   ├── THEME.md                          # Design tokens, color system, and breakpoint rules
│   └── TYPES.md                          # User-Defined Types (UDT) and data schemas
├── nodes/                                # NODE-RED BACKEND NODE DEFINITIONS
│   ├── nexa-project.html                 # UI definition for kufayeka-nexa-project config node
│   ├── nexa-project.js                   # Backend implementation of kufayeka-nexa-project
│   ├── nexa-sparkplug.html               # UI definition for kufayeka-nexa-sparkplug node
│   └── nexa-sparkplug.js                 # Backend implementation of kufayeka-nexa-sparkplug
├── sdk/                                  # COMPONENT SDK TEMPLATES & DEV TESTKITS
│   ├── template/                         # Sample starting boilerplate for 3rd party plugins
│   ├── testkit/                          # Headless Chrome test runner and DOM testing utilities
│   ├── nexa-component-sdk.js             # ESM facade module re-exporting SDK APIs
│   └── package.js                        # Node-RED plugin discovery helper for component packages
├── src/                                  # 100% HANDWRITTEN MODULAR SOURCE CODE (EDIT HERE)
│   ├── canvas/                           # Editor UI design canvas & canvas interactions
│   │   ├── breakpoints-ui.js             # Responsive breakpoint preview bar & screen width controls
│   │   ├── canvas-ui.js                  # Main artboard render, stage setup, zoom transform
│   │   ├── clipboard.js                  # Copy, cut, and paste handlers for UI canvas nodes
│   │   ├── component-renderer.js         # Component DOM renderer, Lit mounting, slot tab switching
│   │   ├── constraints.js                # Auto-pinning & constraint resizing engine
│   │   ├── drag-feedback.js              # Visual insertion indicators and drop ghost rendering
│   │   ├── drop-target.js                # Frame capture, auto-layout insertion, and reparenting
│   │   ├── layout-readback.js            # Reads back computed layout bounding boxes from live DOM
│   │   ├── selection-handles.js          # Bounding box selection handles, resize, rotate, gap/padding
│   │   ├── selection.js                  # Selection state, marquee selection, multi-select, lock/group
│   │   └── sparkplug-live.js             # In-editor live Sparkplug metric update listener
│   ├── dialogs/                          # Native Node-RED Modal Tray Properties Dialogs (window.RED.tray.show)
│   │   ├── app-variable-dialog.js        # Global app variable properties dialog
│   │   ├── component-template-dialog.js  # Component template properties & configuration dialog
│   │   ├── delay-dialog.js               # Logic Delay node duration configuration dialog
│   │   ├── flow-dialog.js                # Screen Flow metadata & starting endpoint dialog
│   │   ├── folder-dialog.js              # Group / Folder name & category dialog
│   │   ├── function-dialog.js            # Logic Function node JavaScript code editor
│   │   ├── get-variable-multi-dialog.js  # Batch variable read configuration dialog
│   │   ├── inject-dialog.js              # Logic manual message injector configuration
│   │   ├── join-dialog.js                # Upstream message join node configuration
│   │   ├── layer-control-dialog.js       # Z-index and layer ordering configuration
│   │   ├── lit-code-dialog.js            # Lit Component inline class body and CSS code editor
│   │   ├── navigate-dialog.js            # Goto Screen (SPA Navigation) configuration dialog
│   │   ├── open-url-dialog.js            # External URL open configuration dialog
│   │   ├── overlay-dialog.js             # Dialog / Drawer overlay trigger configuration
│   │   ├── populate-dialog.js            # Repeater / list population configuration dialog
│   │   ├── render-screen-dialog.js       # Flow Render Screen node configuration dialog
│   │   ├── route-not-found-dialog.js     # Flow 404 Route Not Found configuration dialog
│   │   ├── route-trigger-dialog.js       # Flow Ingress Route Trigger (path, cookies, device) dialog
│   │   ├── screen-dialog.js              # Screen properties (name, path, dimensions, grid, auth)
│   │   ├── screen-variable-dialog.js     # Screen-scoped variable configuration dialog
│   │   ├── send-to-flow-dialog.js        # Send to Flow message dispatcher dialog
│   │   ├── set-variable-dialog.js        # Set Variable operation (set, toggle, append, math) dialog
│   │   ├── set-variable-multi-dialog.js  # Batch variable update configuration dialog
│   │   ├── shared-variable-dialog.js     # Realtime server-synced IO variable configuration dialog
│   │   ├── sparkplug-write-dialog.js     # Single tag DCMD write configuration dialog
│   │   ├── sparkplug-write-multi-dialog.js# Multi-tag batch write configuration dialog
│   │   ├── switch-dialog.js              # Multi-way condition branching configuration dialog
│   │   ├── teleport-dialog.js            # Teleport node target container configuration dialog
│   │   ├── template-dialog.js            # Composite template properties & sizing dialog
│   │   ├── template-output-dialog.js     # Composite template event output configuration dialog
│   │   ├── template-param-dialog.js      # Template parameter definition & typing dialog
│   │   ├── template-variable-dialog.js   # Template-scoped variable configuration dialog
│   │   ├── ui-update-dialog.js           # Update Component properties & action dispatch dialog
│   │   └── web-io-dialog.js              # HTTP Request, LocalStorage & Cookie config dialogs
│   ├── editor/                           # In-editor CodeMirror 6 code editor integration
│   │   ├── cm6-code-editor.js            # CodeMirror 6 wrapper with JavaScript and CSS syntax modes
│   │   └── nexa-completions.js           # Autocomplete provider for variables, tags, and APIs
│   ├── logic/                            # Logic canvas design surface (Node-RED style graph)
│   │   ├── logic-nodes.js                # Logic node rendering, ports, status chips, dragging
│   │   ├── logic-selection.js            # Marquee box selection, copy, paste, delete on Logic canvas
│   │   ├── logic-wires.js                # Cubic bezier wire rendering, port hit testing, drag-wire
│   │   └── logic-zoom.js                 # Independent pan, zoom, and viewport centering for Logic
│   ├── model/                            # Pure state data model (Shared across editor & runtime)
│   │   ├── breakpoints.js                # Tailwind breakpoint matching and media query rules
│   │   ├── index.js                      # Root export compiling to dist/nexa-model*.js
│   │   ├── layout.js                     # Auto-layout CSS calculation, flex/grid rules, constraints
│   │   ├── migrate.js                    # Backward-compatibility project migration functions
│   │   ├── scope.js                      # Lexical scope chain resolution (App -> Screen -> Frame)
│   │   ├── theme.js                      # CSS variable token resolution and color utility functions
│   │   ├── tree.js                       # Core immutable tree algorithms (find, locate, walk, reparent)
│   │   └── types.js                      # User-Defined Type (UDT) validation and schema models
│   ├── runtime/                          # Modular deployed screen runtime engine (/nexa/<path>)
│   │   ├── index.js                      # Runtime entrypoint compiling to dist/nexa-runtime.bundle.js
│   │   ├── state.js                      # Client-side runtime state singleton
│   │   ├── features/                     # Specialized client features
│   │   │   ├── breakpoints.js            # Window resize listener and reactive breakpoint switching
│   │   │   ├── navigation.js             # SPA router, history.pushState, and path parsing
│   │   │   ├── overlays.js               # Dialog and Drawer modal overlay managers
│   │   │   ├── teleport.js               # Cross-container component teleportation engine
│   │   │   └── theme.js                  # Document-level theme switching and token injection
│   │   ├── io/                           # Realtime client networking
│   │   │   ├── client.js                 # Realtime Nexa IO WebSocket client connection & heartbeat
│   │   │   ├── frame.js                  # Binary packet decoder and telemetry frame parser
│   │   │   └── sparkplug.js              # Sparkplug live tag subscription dispatcher
│   │   ├── logic/                        # Logic execution runner inside the browser
│   │   │   ├── context.js                # Execution context (msg, vars, http, cookies, storage)
│   │   │   ├── runner.js                 # Event graph runner: triggers, wire traversal, async nodes
│   │   │   ├── nodes/                    # Specialized node execution logic
│   │   │   │   ├── control-nodes.js      # Delay, Switch, Join, Navigate, Render Screen runners
│   │   │   │   ├── data-nodes.js         # HTTP Request, Storage, Cookie, Function node runners
│   │   │   │   ├── sparkplug-nodes.js    # Sparkplug tag write execution
│   │   │   │   └── variable-nodes.js     # Set Variable, Get Variable, Watch Variable runners
│   │   │   └── widgets/                  # Dynamic UI widgets controlled by Logic
│   │   │       ├── carousel.js           # Interactive carousel slide controller
│   │   │       ├── populate.js           # Template repeater & dynamic list generator
│   │   │       ├── virtual.js            # Virtual scrolling list engine (100,000+ rows)
│   │   │       └── zoom.js               # Pan-zoom interactive widget container
│   │   ├── mounting/                     # DOM component instantiation
│   │   │   ├── box.js                    # Sizing box, CSS position, and visibility wrapper
│   │   │   ├── lit.js                    # Lit component compiler, reactive props, event wiring
│   │   │   ├── pins.js                   # Screen pin placement and layout anchoring
│   │   │   ├── render.js                 # Recursive DOM tree mounter and life-cycle scheduler
│   │   │   └── slots.js                  # Slot host container and light-DOM projection
│   │   └── state/                        # Variable and scope store
│   │       ├── scope.js                  # Client prototype scope chain implementation
│   │       └── variable.js               # writeVariable, variable persistence, and change watchers
│   ├── sdk/                              # Nexa Component SDK Source Code
│   │   ├── assets.js                     # Asset URL resolver helper
│   │   ├── bind.js                       # Two-way data binding and property interpolation
│   │   ├── component.js                  # Component definition helpers and lifecycle hooks
│   │   ├── element.js                    # Base Lit NexaElement class
│   │   ├── format.js                     # Number, date, currency, and string formatters
│   │   ├── registry-entry.js             # Entrypoint generating dist/nexa-registry-client.js
│   │   ├── registry.js                   # window.NEXA registry implementation and component lookup
│   │   ├── runtime-entry.js              # Entrypoint generating dist/nexa-sdk.bundle.js
│   │   ├── schema.js                     # Component property schema validation
│   │   ├── tags.js                       # Sparkplug tag binding resolution
│   │   ├── theme.js                      # SDK token helper
│   │   ├── zag.js                        # Zag.js state machine wrapper for Lit
│   │   ├── field/                        # Industrial field controls & data codecs
│   │   │   ├── codecs.js                 # Data type coercion (int, float, hex, ascii)
│   │   │   └── controller.js             # FieldController managing input value/quality states
│   │   └── kit/                          # Nexa Property Kit (<nx-*>) widgets & inspector
│   │       ├── asset.js                  # Asset picker widget (<nx-asset>)
│   │       ├── base.js                   # Base KitElement class
│   │       ├── binding.js                # Data binding source picker widget (<nx-binding>)
│   │       ├── composite.js              # Composite inspector sub-forms
│   │       ├── index.js                  # Entrypoint generating dist/nexa-sdk-kit.bundle.js
│   │       ├── inputs.js                 # Text, number, switch, select, color widgets
│   │       ├── inspector.js              # Dynamic inspector generator for components
│   │       ├── layout-widgets.js         # Layout controls (flex direction, padding, gap)
│   │       ├── lit-global.js             # Resolves Lit from window global
│   │       ├── styles.js                 # CSS styles for all <nx-*> kit widgets
│   │       └── tree.js                   # Optix hierarchy tree (<nx-tree>) web component
│   ├── server/                           # Backend Node.js code running inside Node-RED
│   │   ├── assets.js                     # Server-side asset store (file hashing, SVG sanitizing)
│   │   ├── plugin.js                     # Main Node-RED plugin registering routes & hooks
│   │   ├── components/                   # Core built-in component definitions
│   │   │   ├── layout.js                 # Flex container & grid layout component definitions
│   │   │   └── media.js                  # Image, video, and iframe component definitions
│   │   ├── io/                           # Realtime Nexa IO Engine (Backend)
│   │   │   ├── ioHub.js                  # WebSocket hub managing cyclic broadcasts & subscriptions
│   │   │   └── ioProtocol.js             # Frame pack/unpack and cyclic telemetry protocols
│   │   ├── sparkplug/                    # Sparkplug B Industrial Engine
│   │   │   ├── deltaBatcher.js           # Coalesces high-frequency metric deltas
│   │   │   ├── sparkplugCodec.js         # Protobuf serialization/deserialization
│   │   │   ├── sparkplugRebirth.js       # Rebirth request coordinator (CMD publishing)
│   │   │   ├── sparkplugTree.js          # In-memory Sparkplug topic/metric hierarchy
│   │   │   └── sparkplug_b.proto         # Official Eclipse Sparkplug B protobuf schema
│   │   └── workers/                      # Node.js Worker Threads
│   │       ├── screen-worker.js          # Dedicated HTTP server worker (port 1881)
│   │       └── sparkplug-worker.js       # Dedicated MQTT & protobuf parser worker
│   ├── shared/                           # Code shared identically between backend and client
│   │   └── io/
│   │       └── protocol.js               # Common binary opcodes and packet structure constants
│   ├── sidebar/                          # Node-RED Left/Right Sidebar Panels
│   │   ├── assets-panel.js               # Asset library management panel (upload, preview)
│   │   ├── breakpoints-panel.js          # Responsive breakpoints manager panel
│   │   ├── frame-inspector.js            # Auto-layout, flex direction, padding & constraint inspector
│   │   ├── hierarchy-panel.js            # Outline / DOM tree hierarchy tab
│   │   ├── kit-inspector.js              # Renders dynamic component property forms using NexaKit
│   │   ├── palette-events-panel.js       # Draggable component palette and event triggers
│   │   ├── properties-panel.js           # Right-side component properties panel dispatcher
│   │   ├── screens-panel.js              # Screens, Templates, Folders & Flows tree (Screens & Flows tab)
│   │   ├── sidebar-content.js            # 10-tab sidebar container and tab switcher
│   │   ├── sparkplug-panel.js            # Live Sparkplug B tree browser & metric monitor
│   │   ├── templates-panel.js            # Screen template management panel
│   │   ├── theme-panel.js                # Project color palettes, typography & theme manager
│   │   ├── types-panel.js                # User-Defined Types (UDT) data structure builder
│   │   └── variables-inspector.js        # Scoped variables inspector for screens and containers
│   ├── assets-client.js                  # Client API for requesting project assets
│   ├── editor-tray.js                    # Pages studio tray setup (dual tabs, toolbar, zoom, keys)
│   ├── history.js                        # Undo/Redo stack manager with coalescing
│   ├── index.js                          # Editor entrypoint registering plugins and sidebar
│   ├── param-types.js                    # Typed-input helpers and parameter coercion utilities
│   ├── registry.js                       # Editor-side component registry instance
│   └── state.js                          # Global editor state singleton and helper functions
├── test/                                 # EXHAUSTIVE TEST SUITES
│   ├── fixtures/                         # HTML and mock fixtures for test execution
│   ├── mock-*.js                         # Headless mock tests covering editor and runtime
│   ├── *-browser.test.js                 # Headless Chrome integration tests
│   ├── test-p0-p1-screens-flows.js       # Screens & Flows architecture regression tests
│   ├── test-p2-spa-navigation.js         # Single Page App transition & persistent IO tests
│   ├── test-p2-flow-routing.js           # Screen Flow gateway & Route Trigger tests
│   ├── test-tree-variables-sidebar.js    # Tree hierarchy, variables, and component click tests
│   └── run-all.js                        # Master test runner executing all 56+ suites
├── build.js                              # ESBuild bundler compiling src/ into dist/
└── package.json                          # Package manifest, Node-RED plugin hooks & dependencies
```

---

## 4. Developer Bug-Fixing & Code Architecture Guide

When encountering a bug or implementing a new feature, use this directory-by-directory breakdown to pinpoint the exact file responsible.

### 4.1 Root & Core Entrypoints (`src/`)

| File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/index.js` | Main entrypoint for the Node-RED editor bundle. Registers the `kufayeka-nexa-dashboard` plugin and sidebar tab. | Sidebar tab failing to appear, plugin registration failure at editor load. | Root initialization block. |
| `src/state.js` | Central state management singleton for the editor. Stores `screens`, `templates`, `flows`, `folders`, selection, and DOM references. | Stale screen state, screen lookup failures (`getActiveScreen`), UUID generation, snap-to-grid calculations. | `state`, `getActiveScreen()`, `findTemplate()`, `findFlow()`, `findFolder()`, `genId()`, `snap()`. |
| `src/editor-tray.js` | Full-width Pages studio tray lifecycle (`window.RED.tray.show`). Houses the dual UI and Logic canvas tabs, keyboard shortcuts, and tray header/footer. | Pages tray failing to open/close, Esc/Delete/Ctrl+Z shortcut issues, UI/Logic canvas tab switching or visibility glitches. | `registerPagesEditorAction()`, `updateCanvasTabsVisibility()`, `buildCanvasArea()`. |
| `src/history.js` | Undo and redo command stack with action coalescing (e.g., rapid slider or text edits grouped into a single undo step). | Ctrl+Z / Ctrl+Y not restoring properties correctly, undo stack memory leaks, corrupted component state after undo. | `pushHistory()`, `undo()`, `redo()`, `clearHistory()`. |
| `src/registry.js` | Editor-side component registry bootstrap attaching `window.NEXA`. | Custom widgets not registering in editor, duplicate component type errors. | `window.NEXA`. |
| `src/param-types.js` | Type coercion and Node-RED `typedInput` wrappers for custom component and template parameters. | Type mismatch when binding numbers/booleans/JSON, `typedInput` widget rendering errors. | `buildTypedInputWidget()`, `mapParamTypeToTypedInputType()`. |
| `src/assets-client.js` | Frontend client for fetching asset URLs, project images, and SVG icons. | Broken image thumbnails in editor, failing asset path resolution. | `resolveAssetUrl()`. |

---

### 4.2 UI Design Canvas (`src/canvas/`)

| File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/canvas/canvas-ui.js` | Manages the artboard DOM, canvas grid rendering, background styling, stage dimensions, and canvas zoom transforms. | Canvas grid not rendering, stage sizing bugs, zoom levels incorrect, artboard background colors not following theme. | `renderActiveScreen(opts)`, `applyZoomTransform()`. |
| `src/canvas/selection.js` | Manages canvas selection (`state.selectedIds`), multi-selection, marquee drag boxes, lock states, and grouping. | Component not selecting when clicked, marquee box selecting wrong nodes, sidebar jumping unexpectedly away from active tree. | `selectOnly(id, opts)`, `selectMultiple(ids, opts)`, `deselectAll()`, `refreshSelectionVisuals()`. |
| `src/canvas/selection-handles.js` | Draws Figma-style selection bounding boxes, 8-point resize handles, rotation handles, padding overlays, and gap indicators. | Resize handles detached from element, rotating component snaps incorrectly, padding/gap visuals misaligned. | `renderSelectionHandles()`, `clearSelectionHandles()`. |
| `src/canvas/component-renderer.js`| Renders components into the artboard DOM. Instantiates Lit Web Components, project templates, slots, and sets up jQuery UI draggable. | Component visual not updating on prop edit, slot frames missing, drag ghost offset from mouse pointer. | `renderComponent()`, `addComponentAt()`, `revealSlotsOf()`. |
| `src/canvas/drop-target.js` | Calculates drop targets when dragging components over the canvas, into auto-layout frames, or into component slot frames. | Dragging a button into a frame drops it outside, auto-layout reordering drops in reverse, cycle detection failures. | `findDropTarget()`, `reparentKeepingPlace()`. |
| `src/canvas/layout-readback.js` | Reads back actual computed bounding boxes and CSS values from the live DOM after layout rendering. | Auto-layout frame has zero width/height, children overlapping despite auto-layout enabled. | `readbackLayout()`. |
| `src/canvas/constraints.js` | Calculates and applies resizing constraints (pin Left, Right, Center, Stretch) when parent frames or screens resize. | Child element fails to follow parent frame resize, anchored element stretches unexpectedly. | `applyConstraints()`. |
| `src/canvas/clipboard.js` | In-memory clipboard operations for UI components (Copy, Cut, Paste, Duplicate) with deep ID remapping. | Pasted component overwrites existing component ID, duplicated frame loses children. | `copySelected()`, `pasteClipboard()`, `duplicateSelected()`. |
| `src/canvas/sparkplug-live.js` | Subscribes to live Sparkplug metric updates during design time so components display live values on the canvas. | Live values not updating on the editor canvas despite MQTT connection active. | `ensureSparkplugLiveRenderWired()`. |
| `src/canvas/breakpoints-ui.js` | Renders the top breakpoint switcher bar (Mobile, Tablet, Desktop) and manages screen width simulation. | Breakpoint selector bar missing, clicking mobile width fails to resize stage. | `refreshBreakpointBar()`. |
| `src/canvas/drag-feedback.js` | Renders insertion lines and drop indicator highlights during drag-and-drop. | Insertion line not showing between auto-layout siblings. | `showInsertionLine()`, `clearDragFeedback()`. |

---

### 4.3 Native Modal Tray Dialogs (`src/dialogs/`)

Every entity and Logic node in Nexa uses standard Node-RED modal trays (`window.RED.tray.show`), ensuring a consistent native experience.

| File | Entity / Node Configured | Common Debug Scenarios |
| :--- | :--- | :--- |
| `src/dialogs/screen-dialog.js` | Screen properties (name, URL route path, width, height, grid size, disabled flag). | Screen route path validation, width/height changes not persisting to project. |
| `src/dialogs/screen-variable-dialog.js` | Screen-scoped variable (name, type, defaultValue). | Type dropdown coercion errors, defaultValue parsing bugs. |
| `src/dialogs/template-dialog.js` | Composite template properties (name, dimensions, category). | Template conversion issues, sizing changes. |
| `src/dialogs/component-template-dialog.js`| Component template properties (custom tagName, label, icon). | Component template failing to register in palette. |
| `src/dialogs/template-param-dialog.js` | Template parameter (name, label, type, default value). | Parameter type binding mismatch, label updates not reflecting. |
| `src/dialogs/template-variable-dialog.js` | Template-scoped variable. | Variable values leaking outside template instance boundaries. |
| `src/dialogs/flow-dialog.js` | Screen Flow properties (name, ingress endpoint route). | Flow starting route `/app` not saving, duplicate flow route warnings. |
| `src/dialogs/folder-dialog.js` | Group / Folder properties (name, category). | Folder rename failing, wrong category assigned. |
| `src/dialogs/app-variable-dialog.js` | Global project variable (name, type, defaultValue, persistence). | Variable failing to save in `sessionStorage` or `localStorage`. |
| `src/dialogs/shared-variable-dialog.js`| Realtime server-synced IO variable. | Shared IO variable failing to sync over WebSocket. |
| `src/dialogs/delay-dialog.js` | Logic `Delay` node (duration in ms or s). | Timer values not validating, non-numeric inputs. |
| `src/dialogs/switch-dialog.js` | Logic `Switch` node (rules, operators: `==`, `>`, regex, else). | Output ports not matching rule count, branching evaluation errors. |
| `src/dialogs/function-dialog.js` | Logic `Function` node (JavaScript code, output count). | Syntax errors in CodeMirror editor, `msg` not returning. |
| `src/dialogs/navigate-dialog.js` | Logic `Goto Screen` node (target screen, route, history action). | Destination screen dropdown missing screens, back/forward history failures. |
| `src/dialogs/route-trigger-dialog.js` | Logic `Route Trigger` node (pattern `/devices/:id`, cookies). | Route pattern not matching dynamic params, cookies not extracting. |
| `src/dialogs/render-screen-dialog.js` | Logic `Render Screen` node. | Render screen lifecycle not receiving flow context. |
| `src/dialogs/set-variable-dialog.js` | Logic `Set Variable` node (op: set, merge, append, toggle, inc). | Array append appending undefined, toggle failing on boolean. |
| `src/dialogs/sparkplug-write-dialog.js` | Logic `Sparkplug Write` node (metric path, payload, DCMD). | Metric picker empty, wrong payload data type published. |
| `src/dialogs/ui-update-dialog.js` | Logic `Update Component` node (target component, action, props). | Target component dropdown empty, action parameters not routing. |
| `src/dialogs/web-io-dialog.js` | Logic `HTTP Request`, `Storage`, and `Cookie` nodes. | REST request URL interpolation failing, storage key missing. |

---

### 4.4 In-Editor Code Editors (`src/editor/`)

| File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/editor/cm6-code-editor.js` | Wraps CodeMirror 6 for code editing in Function and Lit dialogs. Supports dark/light themes, linting, and line numbers. | Code editor cursor jumping, syntax highlighting broken, theme not updating. | `createCodeEditor()`. |
| `src/editor/nexa-completions.js` | IntelliSense autocomplete extension for CodeMirror. Suggests in-scope variables, `msg` properties, and Sparkplug tags. | Autocomplete popup not appearing, outdated variable names suggested. | `getNexaCompletions()`. |

---

### 4.5 Logic Graph Canvas (`src/logic/`)

| File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/logic/logic-nodes.js` | Renders Logic nodes on the SVG logic canvas, port connectors, node status badges, and node dragging. | Logic node misplaced, port icon missing, dragging node doesn't update wires. | `renderLogicCanvas()`, `addLogicNode()`, `removeLogicNode()`. |
| `src/logic/logic-wires.js` | Calculates and draws smooth cubic bezier connection curves between node ports; handles wire creation and deletion. | Wires drawn with jagged lines, port hit-testing fails when connecting wire, dangling wires left after node delete. | `renderLogicWires()`, `startWireDrag()`, `removeWire()`. |
| `src/logic/logic-selection.js` | Marquee box selection, multi-node movement, copying, cutting, and pasting logic subgraphs. | Pasted nodes overlapping original nodes, multi-node dragging desyncing. | `selectLogicNode()`, `copyLogicSelection()`, `pasteLogic()`. |
| `src/logic/logic-zoom.js` | Pan and zoom controls for the Logic canvas, zoom level indicators, and "Fit to View". | Logic canvas panning stuck, zoom jumping to extremes, fit-to-view clipping nodes. | `setLogicZoom()`, `fitLogicToView()`. |

---

### 4.6 Pure State Model & Tree Operations (`src/model/`)

The model contains pure functions with zero DOM or Node-RED dependencies. It is compiled by `build.js` into both `dist/nexa-model.js` (CommonJS for workers) and `dist/nexa-model-client.js` (browser global `window.NexaModel`).

| File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/model/tree.js` | Core immutable tree operations: node lookup, path traversal, parent/child relationships, container checks, and tree pruning. | `Tree.locate` failing, reparenting node causes cyclic hierarchy, child count badges incorrect. | `locate()`, `find()`, `parentOf()`, `ancestors()`, `kids()`, `insert()`, `detach()`. |
| `src/model/layout.js` | Pure layout engine calculating CSS flexbox, grid, sizing, and constraint offsets for frames and children. | Auto-layout flexDirection broken, wrap not wrapping, fill-container calculating wrong width. | `computeLayoutStyles()`, `computeFrameStyles()`. |
| `src/model/scope.js` | Lexical scope resolution (`App` -> `Screen` -> `Container` -> `Component`). Manages variable visibility and shadowing. | Variable bound in child component resolving to wrong scope, outer variable shadowed incorrectly. | `createScope()`, `resolveVariable()`. |
| `src/model/breakpoints.js` | Tailwind-compatible responsive breakpoint thresholds (`sm`, `md`, `lg`, `xl`, `2xl`). | Screen failing to adapt at target width, breakpoint rules firing on wrong window size. | `matchBreakpoint()`, `getSortedBreakpoints()`. |
| `src/model/theme.js` | Design token dictionary, light/dark mode color palettes, and CSS variable injector. | Color tokens not resolving, dark mode toggle not changing component colors. | `resolveToken()`, `applyThemeVariables()`. |
| `src/model/types.js` | User-Defined Type (UDT) validation and structured data mapping. | Custom UDT object property rejected, schema validation failure. | `validateUDT()`. |
| `src/model/migrate.js` | Project version migrations upgrading legacy schemas to the current tree structure. | Old flows failing to import, missing properties after upgrade. | `migrateProject()`. |

---

### 4.7 Modular Deployed Runtime Engine (`src/runtime/`)

Compiled by `build.js` into `dist/nexa-runtime.bundle.js` and served to public client browsers under `/nexa/_runtime.js`.

| Subdirectory / File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/runtime/index.js` | Runtime entrypoint; initializes DOM mounting, network listeners, and boots the active screen. | Deployed page blank on load, startup lifecycle failure. | `initNexaRuntime()`. |
| `src/runtime/features/navigation.js` | Client-side SPA routing engine. Intercepts URL changes, executes flow pipelines, and swaps screens without page reload. | Browser back/forward button broken, URL query parameters lost during transition, flash of unstyled content. | `gotoScreen()`, `initRouter()`. |
| `src/runtime/features/overlays.js` | Manages modal Dialogs and sliding Drawers. Controls z-index stacking, focus trapping, and backdrop dismissal. | Modal dialog opening behind other components, backdrop click not closing drawer, focus escaping modal. | `openOverlay()`, `closeOverlay()`. |
| `src/runtime/features/teleport.js` | Teleports UI elements into remote DOM target containers (e.g. into headers, toolbars, or floating popups). | Teleported element rendered twice, element not returning to origin when closed. | `teleportNode()`. |
| `src/runtime/io/client.js` | Realtime Nexa IO WebSocket client. Handles automatic reconnection, subscription sync, and binary packet reception. | Live metrics showing `???`, WebSocket disconnecting frequently, high network latency. | `ioConnect()`, `ioSubscribe()`, `ioSend()`. |
| `src/runtime/io/frame.js` | Decodes cyclic binary telemetry packets into UI metric values. | Telemetry values parsed as NaN or incorrect types. | `decodeFrame()`. |
| `src/runtime/logic/runner.js` | Logic execution engine on deployed screens. Dispatches component events (`click`, `change`), executes wires and async nodes. | Button click not triggering flow, wire execution hanging, variable change watcher not firing. | `runLogic()`, `dispatchComponentEvent()`. |
| `src/runtime/logic/nodes/*` | Runtime implementations for Delay, Switch, Join, Navigate, Functions, and Tag writes. | Delay timer not pausing flow, Switch node taking wrong branch, HTTP request failing CORS. | Individual node executor functions. |
| `src/runtime/logic/widgets/*` | High-performance dynamic UI controllers: virtual lists (`virtual.js`), template repeaters (`populate.js`), carousels (`carousel.js`). | 10,000-row list crashing browser, repeater duplicating rows, carousel animation jitter. | `initVirtualList()`, `renderPopulate()`. |
| `src/runtime/mounting/render.js` | Recursive DOM component renderer for deployed screens. Handles late-registering component plugins. | Component showing `???` inside tabs, late-loaded plugin widgets not mounting. | `mountScreen()`, `dismountScreen()`, `beginLateMount()`. |
| `src/runtime/mounting/lit.js` | Instantiates Lit-based Web Components, binds reactive properties, and routes events. | Lit component not updating when bound variable changes. | `mountLitComponent()`. |
| `src/runtime/state/variable.js` | Runtime variable store, `sessionStorage`/`localStorage` persistence, and change notification dispatch. | Variables not persisting across reload, two-way input binding failing to write back. | `writeVariable()`, `readVariable()`. |

---

### 4.8 Component SDK & Property Kit (`src/sdk/`)

| Subdirectory / File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/sdk/element.js` | Base `NexaElement` Lit class extending `LitElement` with automatic property binding, theme token access, and cleanup hooks. | Custom component lifecycle errors, styles not inheriting design tokens. | `NexaElement`. |
| `src/sdk/component.js` | `defineComponent()` helper defining component metadata, property schemas, actions, and palette categorization. | Custom component missing from sidebar palette, wrong default icon or dimensions. | `defineComponent()`. |
| `src/sdk/field/controller.js` | `FieldController` managing industrial two-way bindings (reading live PLC tag, handling user edits, echoing writes, quality states). | Field input value reverting while user is typing, write echo not updating state, `???` bad quality badge missing. | `FieldController`. |
| `src/sdk/field/codecs.js` | Data transformation codecs: scaling, offset, bit masking, unit conversion, and number formatting. | Scaled sensor value calculating incorrectly, raw integer not converting to decimal. | `applyCodec()`. |
| `src/sdk/kit/tree.js` | The `<nx-tree>` web component implementing the virtualized 2D hierarchy tree. | Tree horizontal scroll clipping text, double click inline rename triggering when disabled, drag-and-drop tree reordering issues. | `NxTree`, `nx-tree-select`, `nx-tree-open`, `nx-tree-move`. |
| `src/sdk/kit/inspector.js` | Dynamically generates property inspector forms for components based on their `props` schema. | Property field missing in inspector, wrong widget rendered for property type. | `renderInspector()`. |
| `src/sdk/kit/inputs.js` | Reusable property kit controls: `<nx-text>`, `<nx-number>`, `<nx-switch>`, `<nx-select>`, `<nx-color>`. | Number input stepping incorrectly, color picker failing to update value. | Custom element definitions. |
| `src/sdk/kit/binding.js` | Property data binding picker widget (`<nx-binding>`). Allows binding properties to variables, tags, or expressions. | Binding picker missing variable from scope, expression evaluation syntax errors. | `<nx-binding>`. |
| `src/sdk/zag.js` | Adapts Zag.js state machines (tabs, dropdowns, dialogs, sliders) for accessible Lit components. | Keyboard navigation not working in custom widget, dropdown closing prematurely. | `ZagController`. |

---

### 4.9 Backend Server, Workers & Protocols (`src/server/`)

| Subdirectory / File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/server/plugin.js` | Main backend plugin registered in Node-RED. Mounts HTTP admin endpoints, static asset routes, and starts worker threads. | Node-RED startup crash, `/nexa-assets/` returning 404, worker communication failure. | `module.exports = function(RED)`. |
| `src/server/workers/screen-worker.js` | Dedicated Node.js worker hosting the independent HTTP runtime server on port 1881. | Port 1881 conflict, deployed screens returning 500 or not reloading on deploy, worker memory leak. | HTTP server and worker message loop. |
| `src/server/workers/sparkplug-worker.js`| Dedicated Node.js worker managing MQTT broker connections, Sparkplug B protobuf encoding/decoding, and metric state caching. | Telemetry data dropped under high load, broker disconnects, protobuf decode errors on non-standard PLC metrics. | MQTT client and worker message loop. |
| `src/server/io/ioHub.js` | Realtime Nexa IO hub on server. Aggregates client WebSocket connections and broadcasts cyclic binary delta packets. | High CPU usage on server WebSocket, client disconnected due to buffer overflow. | `IoHub`. |
| `src/server/io/ioProtocol.js` | Binary packet serialization and packet protocol encoders for server-to-client telemetry sync. | Protocol version mismatch, byte offset packing errors. | `packFrame()`, `unpackFrame()`. |
| `src/server/sparkplug/sparkplugCodec.js`| Encodes and decodes Sparkplug B payloads using Google Protobuf (`sparkplug_b.proto`). | Bad datatype conversion in metric value, rebirth CMD rejected by EoN. | `encodePayload()`, `decodePayload()`. |
| `src/server/sparkplug/deltaBatcher.js` | Batches high-frequency metric changes over 50-100ms intervals before publishing to avoid network congestion. | High latency on metric updates, batch queue overflowing. | `DeltaBatcher`. |
| `src/server/assets.js` | Local filesystem asset storage (`<userDir>/nexa-assets/`), content-addressed SHA-256 naming, SVG sanitization. | Image upload failing, corrupted SVG upload, permission denied on asset folder. | `saveAsset()`, `deleteAsset()`, `sanitizeSvg()`. |

---

### 4.10 Shared Cross-Environment Code (`src/shared/`)

| File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/shared/io/protocol.js` | Defines shared binary message opcodes, frame headers, and status flags used by both server and browser IO clients. | Client/Server opcode mismatch, packet alignment errors. | Protocol constants and opcodes. |

---

### 4.11 Sidebar Panels & Optix Hierarchy (`src/sidebar/`)

| File | Primary Responsibility | If Bug / Feature Relates To... | Key Exports / APIs |
| :--- | :--- | :--- | :--- |
| `src/sidebar/sidebar-content.js` | Shell container for the 10 sidebar tabs. Manages tab switching, active tab state (`state.sidebarTabs.selected`), and pane visibility. | Clicking a tab fails to show pane, active tab desyncs when switching tools. | `buildSidebarContent()`. |
| `src/sidebar/screens-panel.js` | "Screens & Flows" tab. Renders the Optix-style hierarchy tree (`<nx-tree>`), handles screen/template/flow creation, reparenting, and component selection. | Tree item inline rename activating on double-click, component click not selecting component on canvas or jumping to Properties tab. | `renderScreenList()`, `buildScreensFlowsTreeNodes()`, `selectComponentFromTree()`, `openPropertiesDialogForId()`. |
| `src/sidebar/hierarchy-panel.js` | "Hierarchy" tab. Displays outline DOM tree of the currently active screen, manages visibility toggles, locks, and layer reordering. | Element lock/hide button not updating canvas, unplaced components not appearing in Unplaced group. | `renderHierarchyPanel()`. |
| `src/sidebar/properties-panel.js` | "Properties" tab. Contextual inspector dispatcher. Routes to Frame Inspector, Component Inspector, or Screen properties. | Properties panel blank when element selected, inspector not refreshing after undo. | `renderPropertiesPanel()`. |
| `src/sidebar/frame-inspector.js` | Inspector for Auto-Layout Frames: Flex direction, wrap, alignment, gap, padding, and child constraint settings. | Frame padding input not applying, child constraint dropdown disabled. | `renderFrameInspector()`. |
| `src/sidebar/kit-inspector.js` | Renders dynamic property forms for custom Lit components using the NexaKit property kit. | Component prop edit not creating undo history entry, typing in text field causes focus loss. | `renderKitInspector()`. |
| `src/sidebar/palette-events-panel.js` | "Components" and "Events" tabs. Renders draggable component palette and Logic canvas event chip shortcuts. | Draggable palette component not spawning on canvas, event chips missing for custom actions. | `buildPalette()`, `renderEventsPanel()`. |
| `src/sidebar/sparkplug-panel.js` | "MQTT Sparkplug" tab. Live interactive explorer for discovered Sparkplug B topics, devices, and metric tags. | Sparkplug tree not populating, dragging tag onto canvas doesn't create bound widget. | `renderSparkplugPanel()`. |
| `src/sidebar/theme-panel.js` | "Theme" tab. Color scheme management, primary/neutral palettes, typography, and live token previews. | Custom color token not saving, theme changes not reflecting immediately. | `renderThemePanel()`. |
| `src/sidebar/types-panel.js` | "Types" tab. Schema editor for User-Defined Types (UDT) and data structures. | UDT field addition failing, nested object schema corruption. | `renderTypesPanel()`. |
| `src/sidebar/assets-panel.js` | "Assets" tab. Upload, preview, and drag project images, SVG symbols, and media into the canvas. | Image upload failing, drag-and-drop asset onto canvas creates broken image. | `renderAssetsPanel()`. |
| `src/sidebar/breakpoints-panel.js`| "Breakpoints" tab. Configure custom screen responsive breakpoint widths and test simulated resolutions. | Custom breakpoint width not saving, responsive preview glitching. | `renderBreakpointsPanel()`. |
| `src/sidebar/variables-inspector.js`| "Variables" sub-inspector. Manages scoped variables on selected frames, groups, or screens. | Container-scoped variable leaking to parent, variable deletion not removing bindings. | `renderVariablesInspector()`. |

---

### 4.12 Node-RED Backend Nodes (`nodes/`)

| File | Node Type | Responsibility & Debugging |
| :--- | :--- | :--- |
| `nodes/nexa-project.js` | `kufayeka-nexa-project` | Core project configuration node. Persists all screens, templates, flows, folders, and project variables into Node-RED `flows.json`. If project data is lost or not saving on Deploy, check this file. |
| `nodes/nexa-project.html` | `kufayeka-nexa-project` | Node-RED edit dialog for project node (status display, Sparkplug connection link). |
| `nodes/nexa-sparkplug.js` | `kufayeka-nexa-sparkplug` | Sparkplug B configuration node. Manages MQTT broker credentials, client IDs, and delegates connection to `sparkplug-worker.js`. |
| `nodes/nexa-sparkplug.html`| `kufayeka-nexa-sparkplug` | Node-RED edit dialog for configuring MQTT broker host, port, TLS, username, and password. |

---

### 4.13 Build Outputs & Artifacts (`dist/`)

All files in `dist/` are strictly generated by `build.js`. **Never edit these files by hand.**

- `dist/nexa-editor.bundle.js`: Bundled IIFE containing all of `src/` needed inside the Node-RED editor.
- `dist/nexa-runtime.bundle.js`: Modular runtime client served to browser clients as `/nexa/_runtime.js`.
- `dist/nexa-sdk.bundle.js`: Minified Lit runtime and Nexa Component SDK served as `/nexa/_sdk.js`.
- `dist/nexa-sdk-kit.bundle.js`: Property kit `<nx-*>` inspector widgets served to the editor as `/nexa-dashboard/_sdk-kit.js`.
- `dist/nexa-model.js`: Pure data model compiled as CommonJS for Node-RED and worker threads.
- `dist/nexa-model-client.js`: Pure data model compiled as an IIFE (`window.NexaModel`) for browser pages.
- `dist/nexa-registry-client.js`: Component registry bundle served to deployed pages as `/nexa/_registry.js`.
- `dist/nexa-plugin.js`: CommonJS entrypoint module referenced by `package.json`.
- `dist/nexa-plugin.html`: Node-RED editor plugin definition with script tags wrapping `nexa-editor.bundle.js`.

---

## 5. Build Pipeline & Development Workflow

The build system is powered by `esbuild` and orchestrated via `build.js`.

### Commands

```bash
# Clean build of all bundles and artifacts into dist/
npm run build

# Watch mode: Automatically recompile dist/ on any change under src/
npm run watch

# Run master test suite (rebuilds and executes all 56+ tests)
npm test
```

### What `build.js` Does

1. Compiles `src/index.js` into `dist/nexa-editor.bundle.js`.
2. Wraps the editor bundle into `dist/nexa-plugin.html` with script tags for the SDK, kit, and built-in plugins.
3. Compiles `src/sdk/runtime-entry.js` into `dist/nexa-sdk.bundle.js`.
4. Compiles `src/sdk/kit/index.js` into `dist/nexa-sdk-kit.bundle.js`.
5. Compiles `src/model/index.js` into `dist/nexa-model.js` (CJS) and `dist/nexa-model-client.js` (IIFE).
6. Compiles `src/runtime/index.js` into `dist/nexa-runtime.bundle.js`.
7. Compiles `src/sdk/registry-entry.js` into `dist/nexa-registry-client.js`.

---

## 6. Testing & Verification Guide

Nexa Dashboard maintains an exhaustive suite of 56+ automated tests covering model validation, mock DOM testing, and real headless-Chrome browser tests.

### Running Tests

```bash
# Run all tests in sequence
npm test

# Run a specific test suite
node test/test-tree-variables-sidebar.js
node test/test-p0-p1-screens-flows.js
node test/test-p2-spa-navigation.js
node test/test-p2-flow-routing.js
```

### Key Test Categories

- **Model Tests (`test/model-*.test.js`)**: Tests pure tree algorithms, layout calculation, slots, and breakpoints in pure Node.js.
- **Mock Editor Tests (`test/mock-*.js`)**: Tests canvas resizing, multi-selection, grouping, clipboard, and Logic graph drawing using a lightweight jQuery/DOM shim.
- **Screens & Flows Suites (`test/test-p*.js` & `test/test-tree-*.js`)**: Tests Optix hierarchy generation, drag-and-drop reparenting, SPA screen transitions, route triggers, protected tree rename, and component selection routing.
- **Headless Chrome Browser Tests (`test/*-browser.test.js`)**: Spins up a local test server and verifies live DOM rendering, CSS animations, virtual scrolling, and theme switches in headless Chrome via Chrome DevTools Protocol (CDP).

> [!IMPORTANT]
> **Safety Rule**: Never run tests or point Node-RED development instances at your live `data/` directory. Use isolated ports (e.g. `1899` / `1898`) and temporary userDirs during development.

---

## 7. License

Copyright (c) 2026 Kufayeka. All rights reserved.
Licensed under the Apache License 2.0.
