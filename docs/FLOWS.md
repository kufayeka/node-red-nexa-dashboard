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

Screen Flows allow developers to design application navigation and state machines (e.g. Splash $\rightarrow$ Auth Guard $\rightarrow$ Role Switch $\rightarrow$ Menu $\rightarrow$ Detail) with data passing between screens.

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

## 6. Testing & Handover

- **Dedicated Test**: `test/test-p0-p1-screens-flows.js` (12 sections testing data model, folder nesting, flow creation, cloning, exchangeability, tabs switching, Optix hierarchy, free position clamping, and nx-tree event dispatching).
- **Run Tests**:
  ```bash
  node build.js
  node test/test-p0-p1-screens-flows.js
  node test/run-all.js
  ```
