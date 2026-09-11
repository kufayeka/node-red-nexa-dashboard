# Nexa Dashboard (`@kufayeka/node-red-nexa-dashboard`)

> **Industrial HMI, SCADA & Responsive Visual Dashboard Platform for Node-RED**  
> Native dual-canvas visual editor (UI Canvas + Logic Flow), ISA-95 asset engine integration, extensible component plugin ecosystem, and standalone high-performance runtime delivery.

---

## 1. Executive Summary & Architecture Overview

Nexa Dashboard is an enterprise-grade Human-Machine Interface (HMI) and SCADA dashboard suite built natively into the Node-RED ecosystem. Rather than relying on simple dashboard widgets with static HTML/Angular bindings, Nexa provides a **full vector-grade design studio** directly within Node-RED's editor tray, coupled with a dedicated execution engine for edge and industrial deployments.

### Key Architectural Pillars

```
+-------------------------------------------------------------------------------+
|                             NODE-RED RUNTIME                                  |
|                                                                               |
|  +---------------------------+        +------------------------------------+  |
|  |   kufayeka-asset-engine   | <----> |     node-red-nexa-dashboard       |  |
|  | (ISA-95 Plant Model,      |  live  | (Express /nexa/* server,           |  |
|  |  Tags, Scripts, History)  |  tags  |  Project Config Node, Tray Editor) |  |
|  +---------------------------+        +-----------------+------------------+  |
+---------------------------------------------------------|---------------------+
                                                          |
                                      Component Discovery | Plugin Contract
                                      (type: "nexa-ui-component-package")
                                                          v
                                        +------------------------------------+
                                        | 3rd-Party Component Plugins        |
                                        | (@kufayeka/nexa-component-basic-   |
                                        |  shapes, gauges, charts, valves)   |
                                        +------------------------------------+
```

1. **Dual-Canvas Architecture**:
   - **UI Canvas**: Vector-grade layout designer supporting freeform positioning, resizing with aspect-ratio snap, rotation, horizontal/vertical flipping, grouping/ungrouping, layer z-indexing, marquee selection, and zoom focal navigation.
   - **Logic Canvas**: Embedded Node-RED-style micro-flow canvas inside each screen. Instead of writing inline JavaScript callbacks, UI interactivity is designed with nodes (`ui-event`, `function`, `ui-update`, `inject`, `open-url`) connected by SVG Bezier wires.
2. **Industrial Asset Integration (`kufayeka-asset-engine`)**:
   - Native binding to plant hierarchy tags (`Plant.Line.Equipment.Attribute`).
   - Direct two-way binding: tag updates stream to components via lightweight `onBind()` hooks; component actions write directly back to asset tags.
3. **Pluggable Component Ecosystem**:
   - Third-party packages can register custom UI widgets into Nexa via the standardized `window.NEXA.registerComponent()` contract.
   - Works with **plain DOM/CSS/SVG** or **Lit-based Web Components**.
4. **Independent High-Performance Runtime**:
   - Deployed screens are served under `/nexa/<screen-path>` as standalone, optimized web pages that execute independently from the authenticated Node-RED editor.

---

## 2. The Component Plugin System

Nexa discovers component packages dynamically via Node-RED's official plugin subsystem. Any npm package installed in the Node-RED environment that declares itself as a Nexa component plugin is automatically loaded into both the editor palette and the deployed runtime pages.

### How Discovery Works

1. In the package's `package.json`:
   ```json
   {
     "name": "@kufayeka/nexa-component-basic-shapes",
     "version": "0.1.0",
     "node-red": {
       "plugins": {
         "kufayeka-nexa-component-basic-shapes": "widgets/basic-shapes-plugin.js"
       }
     }
   }
   ```
2. In the plugin backend entry point (`widgets/basic-shapes-plugin.js`):
   ```javascript
   module.exports = function (RED) {
     RED.plugins.registerPlugin("kufayeka-nexa-component-basic-shapes", {
       type: "nexa-ui-component-package",
       runtimeScripts: [
         "/nexa-component-basic-shapes/vendor/text-label-element.bundle.js",
         "/nexa-component-basic-shapes/vendor/basic-shapes-components.js"
       ],
       onadd: function () {
         const staticDir = express.static(path.join(__dirname, "..", "dist"));
         if (RED.httpAdmin) {
           RED.httpAdmin.use("/nexa-component-basic-shapes/vendor", staticDir);
         }
         if (RED.httpNode) {
           RED.httpNode.use("/nexa-component-basic-shapes/vendor", staticDir);
         }
       }
     });
   };
   ```
3. When Node-RED starts, Nexa queries `RED.plugins.getByType("nexa-ui-component-package")` and injects the declared `runtimeScripts` into the editor and deployed pages automatically.

---

## 3. The `window.NEXA.registerComponent` Contract

Every custom component must register itself through `window.NEXA.registerComponent(id, definition)`.

### Safe Registration Queue Pattern (MANDATORY)

Because browser scripts can load asynchronously, plugin scripts should always start with the safe queue pattern:

```javascript
window.NEXA = window.NEXA || {
  _q: [],
  registerComponent: function (id, def) {
    this._q.push([id, def]);
  }
};
```

When Nexa core initializes, it flushes `window.NEXA._q` immediately.

---

### Component Definition Specification (Schema)

```typescript
interface NexaComponentDefinition {
  // Category under which this component appears in the palette
  category: string; // e.g. "Basic", "Gauges", "Controls", "Piping"

  // User-visible label in the palette and inspector
  label: string; // e.g. "Tank Level", "Rectangle"

  // FontAwesome icon class or SVG string
  icon: string; // e.g. "fa fa-square-o", "fa fa-tachometer"

  // Default width and height when dropped onto the artboard
  defaultSize: { w: number; h: number };

  // Editor manipulation capabilities
  capabilities: {
    resizable?: boolean; // Can user resize with handles? (default: true)
    rotatable?: boolean; // Can user rotate with rotate handle? (default: true)
    flippable?: boolean; // Can user flip horizontal/vertical? (default: true)
    lockable?: boolean;  // Can user lock position and editing? (default: true)
  };

  // Configurable properties shown in the Properties Inspector
  defaults: {
    [propName: string]: {
      value: any; // Default initial value
      type: "text" | "number" | "color" | "checkbox" | "select";
      options?: string[]; // Allowed options when type is "select"
    };
  };

  // Property paths that can be bound to real-time industrial Asset tags
  bindable: string[]; // e.g. ["props.fill", "props.value", "props.stroke"]

  // Events emitted by this component to trigger Logic Canvas flows
  events: Array<{
    name: string;  // Machine name (e.g. "click", "change", "alarm")
    label: string; // Human label (e.g. "Clicked", "Threshold Exceeded")
  }>;

  // Primary render function: called when component mounts or full rerender occurs
  render(el: HTMLElement, props: Record<string, any>, ctx: NexaRenderContext): void;

  // Optimized delta-update hook: called when a live tag/binding updates
  onBind?(el: HTMLElement, target: string, value: any): void;
}

interface NexaRenderContext {
  // Dispatches an event to the screen's Logic Canvas
  emit(eventName: string, payload?: Record<string, any>): void;
}
```

---

## 4. Render Lifecycle & Performance

### `render(el, props, ctx)`
- **`el`**: Container `div` positioned and sized by Nexa according to `x`, `y`, `w`, `h`, `rotation`, `flipH`, `flipV`.
- **Idempotency Rule**: `render()` may be re-invoked when the user alters properties in the inspector. **Always assign event listeners idempotently** (e.g. `el.onclick = ...` rather than `el.addEventListener("click", ...)` to prevent duplicate listener accumulation).
- **`ctx.emit(eventName, payload)`**: Invokes the corresponding `ui-event` logic node on the Logic Canvas.

### `onBind(el, target, value)` (High-Frequency Tag Updates)
In SCADA environments where tags update at 100ms intervals, re-rendering the full DOM via `render()` is too costly. The `onBind` method receives the exact target path (e.g. `"props.fill"`) and the new value. It allows surgical DOM or Web Component attribute updates with zero layout thrashing:

```javascript
onBind: function (el, target, value) {
  if (target === "props.fill") {
    el.style.backgroundColor = value;
  }
}
```

---

## 5. The Logic Canvas (Visual Event & Micro-Flow Engine)

Each screen houses an independent Logic Canvas featuring:
- **`ui-event` Node**: Triggers when a component emits an event (`ctx.emit("click")`).
- **`ui-update` Node**: Modifies properties or geometry (`x`, `y`, `w`, `h`, `rotation`, `flipH`, `flipV`, `props.*`) of any component on the screen.
- **`function` Node**: Asynchronous JavaScript sandbox with access to `msg` payload and industrial context.
- **`inject` Node**: Interval-based timer or startup trigger for the screen.
- **`open-url` Node**: Navigates to external web addresses or internal Nexa screen routes.

### Execution Guarantees
- **Message Isolation**: Every wire fan-out creates a deep clone of `msg` to prevent state contamination across branches.
- **Loop Safeguard**: Execution budget limits recursive loops to 2,000 steps to protect against unbounded wire cycles.

---

## 6. Step-by-Step: Creating a New Component Plugin

Here is how to create a complete custom industrial component (e.g., an LED Indicator):

### Step 1: Initialize Package
```bash
mkdir node-red-nexa-component-indicator
cd node-red-nexa-component-indicator
npm init -y
```

### Step 2: Configure `package.json`
```json
{
  "name": "node-red-nexa-component-indicator",
  "version": "1.0.0",
  "node-red": {
    "plugins": {
      "nexa-indicator": "plugin.js"
    }
  }
}
```

### Step 3: Create Plugin Backend (`plugin.js`)
```javascript
const path = require("path");
const express = require("express");

module.exports = function (RED) {
  RED.plugins.registerPlugin("nexa-indicator", {
    type: "nexa-ui-component-package",
    runtimeScripts: [
      "/nexa-indicator/client.js"
    ],
    onadd: function () {
      const staticDir = express.static(path.join(__dirname, "public"));
      if (RED.httpAdmin) RED.httpAdmin.use("/nexa-indicator", staticDir);
      if (RED.httpNode) RED.httpNode.use("/nexa-indicator", staticDir);
    }
  });
};
```

### Step 4: Implement Client Component (`public/client.js`)
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
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.borderRadius = "50%";
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

---

## 7. License
MIT &copy; Kufayeka Tech
