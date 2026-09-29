# Screens, Templates, Folders and Screen Flows

Nexa Dashboard organizes an application into **Screens**, **Templates**, **Folders (Groups)**, and **Screen Flows**.

- [1. Data Structures](#1-data-structures)
- [2. Unified Sidebar & `<nx-tree>`](#2-unified-sidebar--nx-tree)
- [3. Exchangeability (Screen $\leftrightarrow$ Template)](#3-exchangeability-screen--template)
- [4. Duplication & Deep Cloning](#4-duplication--deep-cloning)
- [5. Screen Flows (Logic-Only App Routing)](#5-screen-flows-logic-only-app-routing)
- [6. Testing & Handover](#6-testing--handover)

---

## 1. Data Structures

The application data is stored in the `kufayeka-nexa-project` configuration node:

```ts
interface ProjectConfig {
  screens: Screen[];
  templates: ProjectTemplate[];
  folders: Folder[];          // P0
  flows: ScreenFlow[];        // P0
  variables: Variable[];
  types: UserDefinedType[];
  breakpoints: Breakpoint[];
  theme: ProjectTheme;
}

interface Folder {
  id: string;                 // e.g. "f_auth_123"
  name: string;               // e.g. "Auth & Onboarding"
  parentId: string | null;    // null = root level, or parent folder ID
}

interface ScreenFlow {
  id: string;                 // e.g. "fl_main_flow"
  name: string;               // e.g. "Main Navigation Flow"
  endpoint: string;           // Starting endpoint, e.g. "/app" or "/login"
  description?: string;
  parentId: string | null;    // Folder ID or null
  logic: {
    nodes: LogicNode[];       // Wiring nodes (Start, Screen, Delay, Switch, etc.)
    wires: LogicWire[];
  };
}
```

---

## 2. Optix-Style Hierarchy & `<nx-tree>`

The sidebar tab **"Screens & Flows"** organizes application navigation assets into a clean FactoryTalk Optix-style hierarchy:
```
Screens (N)
- scr1
- scr2
- Folder/Group
  - scr3
Templates (N)
- temp1
- temp2
Flows (N)
- flow1
```

- **Top-Level Root Sections**:
  - `section:screens`: container for screens and screen-category folders.
  - `section:templates`: container for reusable screen templates and template folders.
  - `section:flows`: container for logic-only screen flows and flow folders.
  - Each root section displays child count badges and dedicated toolbar action buttons (`+` add item, `+📁` add group).
- **Categorized Folders**:
  - Folders now have a `category: 'screen' | 'template' | 'flow'`.
  - Creating a group while under a section automatically assigns that group to the matching category.
- **Node Badges & Icons**:
  - Folders: icon `fa-folder`, badge showing child count, `container: true`.
  - Screens: icon `fa-desktop`, badge `screen`.
  - Templates: icon `fa-clone`, badge `template`.
  - Flows: icon `fa-code-fork`, badge `flow`.
- **Drag & Drop Reparenting & Auto-Conversion (`nx-tree-move`)**:
  - Dragging between sections automatically converts the asset! Dragging a screen into `section:templates` (or any template folder) automatically converts it to a template via `convertScreenToTemplate()`. Dragging a template into `section:screens` automatically converts it to a screen via `convertTemplateToScreen()`.
  - Dragging onto a folder (`position: "inside"`) reparents the item into that folder.
  - Cycle detection prevents dragging a folder into itself or any descendant.
  - Dropping `"before"` or `"after"` reorders siblings and aligns `parentId`.
- **Inline Rename (`nx-tree-rename`)**:
  - Double clicking or triggering rename on any node updates its name in place.
- **Action Menus (`nx-tree-action`)**:
  - Screen: Open route in new tab, Convert to Template, Duplicate, Delete.
  - Template: Convert to Screen, Duplicate, Delete.
  - Flow: Duplicate, Delete.
  - Folder: Add Screen/Template/Flow inside (based on category), Add Group inside, Delete (deleting reparents children to parent or section).

---

## 3. Exchangeability (Screen $\leftrightarrow$ Template)

Screens and Templates are interchangeable assets:

- **`convertScreenToTemplate(screenId)`**:
  - Generates a slugified `identifier` from the screen name.
  - Preserves all UI components, constraints, auto-layout frames, and logic graph intact.
  - Removes the screen from `screens[]` and appends it to `templates[]`.
- **`convertTemplateToScreen(templateId)`**:
  - Generates a route path `/<identifier>` from the template identifier.
  - Preserves all components and logic.
  - Removes the template from `templates[]` and appends it to `screens[]`.

---

## 4. Duplication & Deep Cloning

Duplicating an asset produces a clean, independent copy:

- **`duplicateScreen(id)`**: clones components, auto-generates suffix `(Copy)`, updates path to `<path>-copy`, and deep clones the logic graph.
- **`duplicateTemplate(id)`**: clones parameters, components, and logic.
- **`duplicateFlow(id)`**: clones endpoint to `<endpoint>-copy` and deep clones the logic graph.
- **Deep Cloning Engine**:
  - `cloneLogic(logic, compIdMap)`: re-assigns fresh IDs to all logic nodes, remaps wire `from` and `to` endpoints, and remaps component tags/IDs (`comp:<id>:<prop>`).
  - `cloneSurfaceComponents(components)`: recursively clones the component tree with fresh IDs and maintains parent-child relationships.

---

## 5. Screen Flows (Logic-Only App Routing)

Screen Flows allow developers to design application navigation, lifecycle pipelines, and state machines with data passing between screens.

- **No UI Canvas**: Screen flows are purely flow and logic-driven.
- **Tab Visibility Switching (`updateCanvasTabsVisibility`)**:
  - When editing a Flow (`state.editingMode = "flow"`, `state.activeFlowId = id`), the UI canvas sub-tab in `state.canvasTabsUl` is automatically hidden (`display: none`).
  - The tray automatically activates the **Logic** canvas sub-tab.
  - When switching back to a Screen or Template (`editingMode = "screen"` or `"template"`), the UI sub-tab is restored.
- **Dynamic Routing in `getActiveScreen()`**:
  - Returns `findFlow(state.activeFlowId)` when in flow mode.
  - Returns `findTemplate(state.activeTemplateId)` when in template mode.
  - Returns active screen otherwise.
  - All standard logic canvas operations (dragging logic nodes, wiring ports, configuring dialogs) operate directly on the flow's `flow.logic` graph.

---

## 6. P2 Specification: Frontend Routing Pipeline

P2 translates modern frontend routing paradigms (Next.js App Router, Remix Loaders, Vue Router Guards) into a visual, transparent, and composable Node-RED flow architecture.

```text
[ 1. Route Trigger ]
  - Path: /devices/:id
  - Params, Query, Cookies
  - Device info: Mobile/Desktop, Res
          │
          ▼
[ 2. Scratch Middleware ] ────(Fail: 401)────► [ Goto Screen: Login ]
  - HTTP Request (verify token)
  - Function (decode / validate)
  - Switch (branching)
          │ (Authorized)
          ▼
[ 3. Data Loader & Sparkplug ]
  - Fetch REST data / read PLC tags
          │
          ▼
[ 4. Delay Node (e.g. 300ms) ]  <── Smooth UX, no abrupt screen flashes
          │
          ▼
[ 5. Goto Screen / Navigate ]
  - Named Screen: DeviceDetail
  - Pass loaded context payload
```

### 6.1 Route Trigger Node (Clean Ingress & Device Context)
Acts as the entrypoint for web client routing without "magic" black-box assumptions. Emits a rich context `msg`:

- **Path & Dynamic Matching**:
  - Pattern: `/devices/:id`, `/analytics/:timeframe`, or exact sub-paths.
  - Generates `msg.params` (e.g. `{ id: "42" }`).
  - Generates `msg.path` (e.g. `"/devices/42"`).
  - Generates `msg.query` (e.g. `{ tab: "overview", filter: "active" }`).
- **Selective Cookie Extractor**:
  - Configure target cookie keys (e.g. `token`, `session_id`, or `*` for all cookies).
  - Emitted onto `msg.cookies` without requiring client boilerplate.
- **Device & Client Context (`msg.device`)**:
  - `msg.device.type`: `"mobile"` | `"tablet"` | `"desktop"` (synchronized with Nexa's Tailwind breakpoint bands).
  - `msg.device.screen`: `{ width: number, height: number, orientation: "portrait" | "landscape" }`.
  - `msg.device.userAgent`: Browser user agent string.
  - `msg.device.ip`: Client IP address / network origin.

### 6.2 Composable Middleware & Data Loaders (Zero-Magic Scratch Logic)
Rather than introducing rigid, opaque "Guard" nodes, developers compose standard, transparent logic nodes:
- **`Function` Node**: Custom validation scripts, JWT payload inspection, business rules.
- **`HTTP Request` Node**: Call remote auth servers, microservices, or REST endpoints.
- **`Switch` Node**: Multi-way branching based on status codes, role flags, or device types.
- **`Sparkplug / Storage / Cookie` Nodes**: Check live PLC tags or local storage keys before granting screen access.

### 6.3 Delay Node (Smooth Transition & Throttle Control)
Available across **Screens**, **Templates**, and **Screen Flows**:
- **Purpose**: Prevent jarring, instantaneous UI cuts, add debouncing/throttles, or pace sequential automation steps.
- **Configuration**:
  - Duration: milliseconds or seconds (e.g. `300ms`, `1.5s`).
  - Pass-through: preserves and forwards `msg` unmodified once timer expires.
  - Can be cancelled if an abort or new navigation arrives.

### 6.4 Goto Screen / Navigate Node (First-Class Project Routing)
First-class palette node for Screens, Templates, and Screen Flows:
- **Target Selection**:
  1. **Named Screen (Dropdown)**: Pick directly from existing project screens (`Home`, `DeviceDetail`, `Alarms`). Ensures zero broken links or typos.
  2. **Dynamic Route (Interpolation)**: Supports path templates (e.g. `/devices/{msg.params.id}` or from `msg.target`).
  3. **History Navigation**:
     - `Push`: Standard navigation, adds to browser history.
     - `Replace`: Replaces current route (ideal for auth redirects to prevent back-looping).
     - `Back (-1)`: Navigate back in history.
     - `Forward (+1)`: Navigate forward in history.
- **Payload & Param Handover**:
  - Forwards `msg.payload` directly into the destination screen's `On Load` lifecycle, eliminating temporary global variable clutter.

---

## 7. Testing & Verification

- **P0/P1 Test**: `test/test-p0-p1-screens-flows.js` (Hierarchy, Folders, Duplication, Conversion, Reparenting).
- **P2 Test Suite**: `test/test-p2-routing-pipeline.js` (Route Trigger context, Device metadata, Delay node timing, Goto Screen navigation).
- **Run Tests**:
  ```bash
  node build.js
  node test/test-p0-p1-screens-flows.js
  node test/mock-templates-editor.js dist/nexa-editor.bundle.js
  ```
