# Hierarchy, frames, auto layout, constraints and variables

A screen (and a template) is a **tree of nodes**, laid out the way Figma does
it: containers hold children, frames can lay them out automatically, children
keep to their frame's edges, and variables flow down the tree.

- [1. The node tree](#1-the-node-tree)
- [2. Selecting and arranging (Figma rules)](#2-selecting-and-arranging-figma-rules)
- [3. Frames and auto layout](#3-frames-and-auto-layout)
- [3b. The screen in the browser window](#3b-the-screen-in-the-browser-window)
- [4. Constraints](#4-constraints)
- [5. Variables and the scope chain](#5-variables-and-the-scope-chain)
- [6. Where the code lives](#6-where-the-code-lives)

## 1. The node tree

```ts
interface Surface {                 // a Screen, a ProjectTemplate, or a ScreenFlow (see docs/FLOWS.md)
  components: Node[];               // the root's children, bottom of the stack first
  orphans: Node[];                  // taken out of the tree, not deleted (Hierarchy → "Unplaced")
  variables?: Variable[];           // §5
  treeVersion: 1;
  // ...name, path / identifier, width, height, gridSize, snap, logic
}

interface Node {
  id: string;
  type: string;                     // a component id, "@template", "@lit-component", "@group" or "@frame"
  name?: string;                    // shown in the Hierarchy; Layer Control targets nodes by name
  x: number; y: number; w: number; h: number;   // relative to the parent container
  rotation?: number; flipH?: boolean; flipV?: boolean;
  visibility?: "hide" | "remove";   // unset = show
  locked?: boolean;
  children?: Node[];                // @group / @frame only
  layout?: Layout; style?: FrameStyle;         // @frame only (§3)
  layoutChild?: LayoutChild;                    // a child of an auto-layout frame (§3)
  constraints?: { h: string; v: string };       // §4
  minW?: number; maxW?: number; minH?: number; maxH?: number;
  variables?: Variable[];           // @group / @frame (§5)
  props?: Record<string, any>;      // components
}
```

- **Order is stacking.** Later siblings are drawn on top. The Hierarchy lists
  the top of the stack first, as Figma does.
- **Every container is a coordinate space.** A child's `x` / `y` are relative
  to its parent.
- **A group hugs its children.** Its box is always their bounds. Moving a
  member re-fits the group, and a group left empty by a move or delete is
  removed.
- **Visibility:** the most restrictive of a node and its ancestors wins.
  `hide` still draws the node (display: none, instant to show again);
  `remove` doesn't draw it at all. A locked container locks everything in
  it.
- **Deleting a container doesn't delete its children.** They become
  orphans, listed under **Unplaced** in the Hierarchy and kept in screen
  coordinates. Drag one back into the tree to use it again, or delete it
  for good.

**Old projects** (flat `components` with `layerId`, `layers`, `groups`) are
migrated on open, and again by the screen worker for the deployed page. The
migration lives in `src/model/migrate.js` and is idempotent:

- The first layer melts into the root.
- Every other layer becomes a group of the same name, so Layer Control nodes
  keep working.
- Old groups become "Group N".
- Nothing moves on screen.

## 2. Selecting and arranging

| Action | Result |
| --- | --- |
| Hover | Outlines what a click would select, with its name. |
| Click | Selects the component or template instance under the pointer, through the frames around it (like Webflow / Framer). A frame's own empty area (padding, gap) selects the frame. A group is selected whole. With something selected, a click keeps to its depth (a sibling of it). |
| Double-click | Dives one level into the selected container. |
| `Shift+Enter` / `Enter` | Selects the parent / the first child. |
| Ctrl / Cmd + click | Selects the deepest node directly. |
| Shift + click | Adds to / removes from the selection. |
| `Ctrl+G` | Group the selected siblings. |
| `Ctrl+Alt+G` | Frame the selected siblings. |
| `Ctrl+Shift+G` | Ungroup / remove the frame (children stay where they are). |
| Drag onto a frame | Goes into it (§3). Dragged out of every frame, it goes to the root. Groups don't capture. |
| Hierarchy drag | Before / after / inside a row, or onto **Unplaced**. The node keeps its place on screen. |

Every structural change (add, delete, group, reparent, paste, orphan) is one
undo step.

## 3. Frames and auto layout

A frame is a container with a box of its own:

```ts
style = { fill, stroke, strokeWidth, radius, clip }
```

It can also **lay out its children**:

```ts
layout = {
  mode: "none" | "horizontal" | "vertical" | "grid",
  padding: { t, r, b, l },
  gap: number | "auto",            // "auto" = space between (row / column)
  rowGap?: number,                 // wrap / grid; unset = the gap
  alignX, alignY: "start" | "center" | "end",   // the 3×3 alignment pad
  wrap?: boolean,                  // row only
  columns, rows: [{ size, unit: "px" | "fr" | "auto" }],   // grid tracks
  sizeW, sizeH: "fixed" | "hug"    // hug = the frame fits its content
}

// on a child of such a frame:
layoutChild = {
  w, h: "fixed" | "fill" | "hug",  // hug: only a child that lays out its own content
  absolute?: true,                 // out of the flow: keeps its own x / y
  col?, row?, colSpan?, rowSpan?   // grid placement (1-based)
}
```

- **It is plain CSS** (flexbox / grid), computed once in
  `src/model/layout.js`. The editor and the deployed page share it (the page
  loads it as `/nexa/_model.js` → `window.NexaModel`).
- **The editor reads the boxes back.** After drawing, the positions and
  sizes the browser gave the children (and a hugging frame) are written into
  their `x` / `y` / `w` / `h` (`canvas/layout-readback.js`). This keeps
  selection, handles and hit-testing working as for any other node. These are
  derived values: no undo step.
- **A child in the flow isn't dragged freely.** Dragging shows a blue line
  where it would go, which reorders it or moves it into another frame.
  Dropped outside every frame, it lands where it was let go.
- **Resizing an axis makes it Fixed** (Figma). The siblings re-flow live.
- **A child in the flow never rotates.**
- **Palette:** the "Layout" section has Frame, Row, Column and Grid. A drop
  over a frame goes into it.
- **Selected auto-layout frame:** it shows its padding and gaps as pink
  bands.

**Scrolling:** `style.scroll` is `"none" | "vertical" | "horizontal" | "both"`.
A scrolling frame scrolls its overflow on the live page, which is how a long
list goes in a fixed-size box. In the editor the frame follows **Clip
content** instead, so what's outside stays visible and editable, as in
Figma.

## 3b. The screen in the browser window

`screen.displayMode` (Screens tab → "On the live page", next to the
**Device** presets):

| Mode | The live page |
| --- | --- |
| `fixed` (default) | Exactly the screen's size (a known panel / device), centred. |
| `fit` | Scaled so the whole screen fits the window; proportions kept (letterbox). |
| `fitWidth` | Scaled to the window's width; taller content scrolls down. Good for web pages. |
| `fill` | The screen *is* the window, and nothing is scaled. The top-level items keep to the window's edges by their constraints (§4); use frames with auto layout inside. This is the responsive mode. |

## 4. Constraints

A node that no auto layout places keeps to its parent's edges when the
parent's size changes. This covers a frame's child, a root node and an
absolute child.

```ts
constraints = {
  h: "left" | "right" | "leftRight" | "center" | "scale",
  v: "top" | "bottom" | "topBottom" | "center" | "scale"
}
```

- **Editor:** resizing a frame moves / stretches its children, recursively
  for child frames. This happens for a handle drag (live, one undo step), for
  its W / H in the inspector, and for a frame the layout re-flows. Changing
  the screen's width / height does the same for root nodes. A group only
  moves.
- **Deployed page:** constraints become CSS (`right`, `left` + `right`,
  `calc(50% + …)`, `%`). A frame that fills or hugs is a different size live
  than it was designed, and what it holds still follows.

## 4b. Templates on the live page, scrolling, zoom

**A template's size where it is used** is set in Templates → **On the live page**. It holds for every use: a Populate's copies, a carousel's slides, a list row or a grid cell.

- **Per axis**, Width and Height are each one of:
  - **Fixed**: the template's design size;
  - **Fill**: the space its host gives it. What is inside then does what "When its box is another size" says (below).
- **Min / max** width and height are optional.
- **The host only places it**: alignment, padding and gap. A carousel's slide is a cell: Slides → padding ↔ ↕ and the alignment of a fixed-size template in it.
- A Populate's older "each copy fills the width" still makes the width fill.
- **An instance placed on a screen is a box**, like a frame with one thing in it:
  - a dashed outline shows it on the canvas;
  - drag its handles to resize it (an axis set to Fill becomes Fixed);
  - Properties → **Box**: X, Y, W, H and "Content in this box" (the template's setting, or its own);
  - it clips its content.


**When its box is another size** (filling, or a resized instance), the template's content does one of three things. The editor's canvas and the live page do the same:

| Setting | What happens |
|---|---|
| **Follow constraints** (the default) | Like a frame: each element follows its constraints against the design size. Left & Right stretches with the width, Right keeps to the right edge, Scale keeps its share. An auto layout frame as the background lays its content out. |
| **Scale to fit** | The whole design gets bigger or smaller, proportions kept, centred, like an image. Text scales too. It follows a box that resizes on the page. |
| **Stretch** | Scaled to the box on each axis: text and shapes are squeezed. |

**Auto constraints** (Templates → On the live page) sets every element's constraints from where it sits, as a start to adjust:

- over a third of the width (height) → Left & Right (Top & Bottom);
- about centred → Center;
- nearer the far edge → Right (Bottom);
- else Left (Top).

It goes into frames without an auto layout too. Undo with Ctrl+Z.

**When scrolling** (live page):

- **A node its parent does not lay out** has Constraints → When scrolling:
  - **Scrolls with the content** (the default);
  - **Fixed**: it stays where it is on the view, e.g. a header. With the **Bottom** (or Right) constraint it keeps that distance from the view's bottom (right) edge, e.g. a footer;
  - **Sticky**: it scrolls until it reaches the top (left) edge, then stays there.
- **Its scroll container** is the nearest frame that scrolls, else the page. It also works while the screen is scaled (Fit width).
- **A child of an auto layout** has "Sticky while the frame scrolls", for example the header row of a scrolling column. This uses CSS sticky, at the start of the flow.

**Zoom & pan** (a frame, live page): Frame → **Zoomable**. It works exactly like the editor's canvas.

- **The frame** always clips and scrolls both ways while it is zoomable; the inspector locks Clip content and Scroll.
  - Its scrollbars stay as they are and are not zoomed. Their length follows the zoom: zoomed in, there is more to scroll.
  - Zoomed out below the frame, the content is centred.
  - Nothing is drawn outside the frame.
- **Zoom**:
  - Ctrl + wheel (or a trackpad pinch) zooms at the pointer, 20 % a step like the editor. Optionally the wheel zooms without Ctrl.
  - A two-finger pinch zooms on a touch screen.
  - The editor's toolbar: **− 100% ○ + ⤢** (zoom out, the level, reset, zoom in, fit). "Show the zoom toolbar" shows or hides it.
- **Pan** (scrolling): a plain wheel, a drag on the background, the middle button, or one finger. A drag that starts on a component (a button, a field) stays that component's, and no text gets selected while you drag.
- **Double-click / double-tap** goes back to the start. The start is **Fit** (all its content in view) or **100 %**, within a min / max zoom.
- The rest of the screen keeps its size, e.g. a P&ID drawing that zooms between a fixed header and a fixed side panel.
- A frame inside the zoomed content zooms with it, its own scrollbars too (it is content).
- A frame's scrollbar can be hidden: Fill & stroke → Hide the scrollbar. It still scrolls.

Tests: `test/runtime-pin-browser.test.js`, `test/runtime-zoom-browser.test.js`, `test/runtime-carousel-browser.test.js`, `test/runtime-virtual-browser.test.js`.

## 4d. Dialogs and drawers (overlays)

**A frame becomes a dialog or a drawer** in Properties → **Overlay → Show as**. It keeps everything else a frame has: auto layout, style and variables. It can hold a template instance.

**Its scope is its parent.** A root node's scope is the page (the window). A node inside a frame has that frame as its scope, so every container can have its own dialogs and drawers. The scope is where:

- the backdrop covers;
- a dialog is placed;
- a drawer runs along;
- dragging is kept.

**Placement**:

- **Dialog**: by its alignment (9 points) and a margin from the edges, at its W × H.
- **Drawer**: along one side (left, right, top or bottom). Its width (height for top / bottom) is W (H), and it spans the scope on the other axis.

**Settings**:

- the **backdrop**: Dim, Blur or None, and how dark it is;
- **Modal**: what is behind it cannot be used. Not modal with no backdrop, the page behind stays usable;
- **how it closes**: a click on the backdrop, Esc, and a timer ("close by itself after").
- **draggable**, inside its scope or anywhere, by any part that is not a control;
- the **animation**: Auto (a dialog scales, a drawer slides), Scale, Fade, Slide or None, and its duration;
- **open when the page opens**.

Everything except the preview can differ per breakpoint (📱). For example, a dialog 600 wide on the desktop is full width at xs, or a drawer comes from the right on the desktop and from the bottom on a phone.

**Logic** (Events tab → Overlays):

| Node / event | Does |
| --- | --- |
| **Open …** | Opens it, on top of any open one: dialogs stack. Opened again while it is open, it comes to the top and this Open node gets the result. **Its output fires when it closes**, with `msg.payload` = the result and `msg.closedBy` = `node` / `backdrop` / `esc` / `timer`. |
| **Close …** | Closes it with `msg.payload` as the result (or none: `null`). "Close the top overlay" closes the one on top. |
| **… on Open** / **… on Close** | Its events. `msg.payload` is what it was opened with, or its result. |

For example, a form dialog: `Button Edit → Open Edit dialog → [saved?] → HTTP POST`. Inside the dialog, `Save → Function (msg.payload = the fields) → Close Edit dialog`.

**The stack**: Esc closes the top one first. A modal one on top keeps Esc from the ones below.

**In the editor** a dialog / drawer is hidden on the canvas until you preview it:

- **Overlay → Preview on the canvas** (the editor only);
- or **pick it (or something in it) in the Hierarchy**.

It shows where the page opens it, over its backdrop.

**The data**: `frame.overlay = { kind: "dialog" | "drawer", alignX, alignY, margin, side, backdrop, backdropOpacity, modal, closeOnBackdrop, closeOnEsc, autoClose, draggable, dragWithin, animation, duration, startOpen }`. See `src/model/layout.js` `overlayOf`. Tests: `test/runtime-overlay-browser.test.js`.

## 4e. Teleport

**Any node can be drawn in another place of the page**: a component, a frame, a template instance, a node inside a template, a Populate's copies, a dialog. Properties → **Teleport → Teleport to**:

- **a target's name**: a frame named with "This frame is a teleport target named …". It is drawn inside that frame, which places it by its layout: a row puts it in the row.
- **The page**: drawn on the page itself at its X / Y, above every frame. It is out of any frame's clip.

**When** (Properties → Teleport → When):

- **When the page opens**: it is drawn there from the start.
- **When a Logic Teleport node runs**: it stays where it is until a **Teleport** node sends it.

**The Teleport node** (Events → Teleport) moves any node, set to teleport or not:

- to a target, to the page, or **home** (back exactly where it is in the tree);
- where to is fixed, or taken from `msg.payload` (a target's name, `@page`, or `home`);
- the message goes on.

For example, a Settings panel teleports into the header while an admin is logged in, and goes home after.

**Only where it is drawn changes.** Its place in the tree stays, so its Logic, its template's params, the variables around it and its bindings work as before. For example:

- a card in a Populate list teleports its "cart" badge into the header (one per copy, gone with its copy);
- a template's toolbar buttons show in the screen's header;
- a dialog inside a clipped card opens over the whole page.

**Notes:**

- A target that is not on the page leaves the node where it is.
- Teleported nodes go into a target after its own children, in the order they are drawn.
- Hiding the node's parent (Hierarchy, Layer Control) does not hide what it teleported; hide the node itself.
- On the canvas a teleported node stays where it is in the tree, marked ⇢ with its target; a target is marked ⇠ with its name.

**The data**: `node.teleport = "<name>" | "@page"`, `node.teleportOn = "logic"` (absent: when the page opens), `frame.slot = "<name>"`; the Logic node `{ type: "teleport", node, to, toSource }`. Tests: `test/runtime-teleport-browser.test.js`.

## 4g. Position, margin, padding and layer

Every node (a component, a frame, a group, a template instance) has a **Position** section in Properties.

**Where it is placed** (`Layout.placeOf`):

| Position | What it does |
| --- | --- |
| **In the layout** | Its frame's auto layout places it. Only offered inside an auto layout; there it's the default. |
| **Free** | Its own X / Y inside its parent, like in a frame without auto layout. Inside an auto layout this is `layoutChild.absolute`. |
| **On the screen** | Its X / Y are the **screen's**, wherever it sits in the tree. It leaves a clipped card and is drawn on the screen itself. Its Logic, variables and params stay those of its place in the tree. Inside a template, "the screen" is the template. |
| **Docked** | It sits at an edge or a corner of its parent, picked on a 3×3 pad like Alignment. **It stays there while the parent scrolls.** Docked to the screen, it stays in the window while the page scrolls (a toast, a footer). *Stretch along the edge* makes a top / bottom dock full width and a left / right dock full height (a header, a side bar). |

- **Margin** (`node.margin {t,r,b,l}`):
  - in a layout, the space around the node;
  - docked, its distance from the edges.

  A free node has no margin: its X / Y say where it is.
- **Padding** (`node.padding`): the space inside a component's box, around what it draws. A frame has its layout's padding instead.
- Both use the spacing field. The button next to it switches between one value, horizontal / vertical, and each side.
- **Layer (Z)** (`node.z`): higher is on top of its siblings. With equal Z, the Hierarchy's order decides (top of the list = on top). **Front / Back** set a Z one past every sibling's.
  - Use Z when a node must stay in its place in an auto layout (the order sets its position) but be drawn above the others.
- Z, margin, padding and the dock may differ per breakpoint 📱. The position itself doesn't.

**How it works:**
- It is plain CSS from `Layout.boxCss`, for both the editor and the live page.
- A docked node is anchored with `left` / `right` / `top` / `bottom` (the centre by `calc`, no transform).
- On the live page it is drawn in a **dock layer** over what is in view of its parent (`dockLayerOf` in the runtime). For a frame that is its visible box wherever it is scrolled to; for the screen it is the screen's part of the window. The layer takes no pointer; the docked node does.
- An "On the screen" node is mounted on the artboard (or its template's surface). `Tree.absBox` uses its own X / Y.
- In the editor a docked node isn't dragged (its dock places it; its box is read back). Frames don't capture an on-screen or docked node when it's dragged.

Tests: `test/model-place.test.js`, `test/runtime-place-browser.test.js`.

## 4f. Components with slots (Tabs…)

Some components hold other components: a Tabs has one panel per tab. Each panel is a **slot frame**, an ordinary frame made and kept in step by the editor (`Tree.syncSlots`).

- **Drop** onto the visible panel and the component goes into that panel's frame. Clicking a tab header on the canvas switches the panel, and the canvas keeps that tab while you edit.
- **Select**: a click selects what is under the pointer through the panel, as with frames. A click on the panel's empty area selects the component. A double click selects the panel's frame, so you can set its auto layout, padding and fill.
- **Hierarchy**: the panels are listed under the component by their tab's name. Picking something in a hidden panel switches the component to it.
- A panel can't be moved, resized, grouped or taken out. What goes in the component goes into one of its panels.
- When a tab is removed, its panel is kept, marked "(not used)", and not drawn. Its content comes back with the tab.

The data: `node.slots = true`, and `children` = `@frame`s with `inSlot: "<name>"`. See `docs/SDK.md` §11b-2.

## 4c. Breakpoints (desktop-first)

**The app's breakpoints** (the **Breakpoints** tab) are bands of window widths, the Tailwind way. Each one starts at its "from" width and runs up to the next:

| xs | sm | md | lg | xl | 2xl | 3xl |
|---|---|---|---|---|---|---|
| 0 | 640 | 768 | 1024 | 1280 | 1536 | 1920 |

- Rename, add or delete them, or change where they start. Renaming keeps a breakpoint's id, so what was set for it stays.
- Each one has a **preview width** (a device preset: iPhone, iPad, HMI 800 × 480, Full HD, … or any width in the band) and a device label.

**The design**: a screen is designed in the band of its own width. A 1920 screen is 3xl, a 1280 one xl. It is ★ on the canvas bar.

**The cascade goes away from the design**:

- A narrower band inherits from the next wider one: xl → lg → md → sm → xs. What is set at md also holds at sm and xs, unless they change it.
- A band wider than the design inherits from the next narrower one, so a 3xl value (a big wall screen) never reaches the laptop.

**Two ways to set a value per breakpoint** (both store the same thing):

1. **A field's 📱** (every field of the Properties panel: a frame's layout, a child's sizing, constraints, and every prop of every component, plugins included). It shows the breakpoint chips, like Tailwind classes: `★ md 8 · sm 20 · xs`. Pick a chip and edit the field: the value is kept for that breakpoint, without switching the canvas. A chip with a value set has a border; its × makes it inherit again.
2. **The canvas bar** (`3xl · 2xl · xl · lg · md★ · sm · xs`). It shows the screen at that band's preview width with its values applied. Anything changed there is kept for that band: a row made a column, a node hidden in the Hierarchy, another width, a text. The Properties panel says which band is being edited, lists what the node sets there (●), and offers **Reset**.

In both, the design stays as it is, and the project always stores the design plus the changes. Nodes placed freely follow their constraints to the band's width (Right, Center, Scale…), like the page does.

**What a breakpoint may change**:

- position and size, min / max;
- visibility;
- a frame's layout (mode, gap, padding, alignment, wrap, grid columns / rows, a carousel's settings);
- how a child fills;
- the frame's style, constraints and When scrolling;
- a component's props.

It cannot change a frame's zoom & pan settings or the variable a carousel's slide goes to.

**On the page**:

- The window's width picks the band before anything is drawn.
- Crossing one while the page is open applies it **in place**: a Populate's copies, variables and a carousel's slide stay.
- `{$breakpoint}` is the band in use (`"md"`, …).
- Events → **On Breakpoint Change** fires with `msg.payload`, the new one.

**The data**: `project.breakpoints = [{ id, name, min, preview, device }]` (empty = the defaults) and `node.overrides = { md: { layout: { mode: "vertical" } }, sm: { visibility: "hide" } }`. Object fields (`layout`, `layoutChild`, `style`, `constraints`, `props`) merge key by key; the rest is replaced. Overrides saved as `tablet` / `phone` (before the bands) are read as `md` / `sm` and renamed when the screen is opened. See `src/model/breakpoints.js`.

### Fallbacks of bound props

A prop bound to a tag, a variable, the message or an expression can have a **fallback**: what it shows while the binding has no value. That covers no value yet, `null`, `???` (offline), no message yet, or a variable not declared around it. An expression falls back when any binding inside it has no value.

In the Properties panel, a bound field (⛓) shows its own control below the binding, labelled **Fallback**. A Read Tag input shows a text field. The editor's canvas shows the fallback too. The data is `props.__fallback = { key: value }`.

## 5. Variables and the scope chain

```ts
interface Variable { id: string; name: string; type: "string" | "number" | "boolean" | "object" | "array" | "color"; defaultValue: any }
```

Declare variables on the **screen** (Screens tab) and on any **group or
frame** (Properties → Variables). Bind one anywhere in a prop as `{name}`;
paths such as `{name.a}` and `{list[0]}` work too.

A binding resolves to the **nearest declaration going outwards**:

```
the node → its containers, innermost first → the screen
```

- An inner declaration **shadows** an outer one of the same name.
- An unresolved `{name}` stays exactly as written.
- **Template instances are a boundary.** Inside one, only the template's
  params and variables are visible. What crosses is passed in through the
  instance's paramValues (`{name}` there resolves outside the instance), and
  it is passed again whenever that variable changes.
- **Changing a value live:** use the Logic node **Set Variable**.
  - Settings: scope (the screen, or the container that declares it), name,
    and value (`msg.payload` or a fixed value). The msg goes on unchanged.
  - Everything inside that scope that binds the name, and doesn't shadow it,
    re-renders.
  - The Events tab has a "Set `<scope>.<name>`" chip per declared variable.
- **In the editor:** the canvas shows the default values resolved. The
  binding picker (⛓ / tag fields) suggests the variables in scope, nearest
  first, and says whose they are.

**How it works:** a scope is a plain object whose prototype is the enclosing
scope (`Object.create(parent)`, `src/model/scope.js`). Interpolation's
`scope[name]` walks the whole chain. A value set on a scope is seen by every
scope inside it. The runtime finds who to re-render with
`scope.isPrototypeOf(node's scope)`.

## 6. Where the code lives

| File | What |
| --- | --- |
| `src/model/tree.js` | walk, locate, insert / move / remove, wrap / unwrap, absBox, group hugging, effective visibility / lock |
| `src/model/migrate.js` | layers / groups → the tree |
| `src/model/layout.js` | frame / child CSS, sizing, constraints |
| `src/model/scope.js` | scopes, visible variables |
| `src/model/index.js` | → `dist/nexa-model.js` (CommonJS, screen worker) and `dist/nexa-model-client.js` (`window.NexaModel`, deployed page), both generated by `build.js` |
| `src/canvas/drop-target.js` | where a drop goes (frame capture, flow index), reparenting |
| `src/canvas/layout-readback.js` | boxes back from the DOM |
| `src/canvas/constraints.js` | constraints on resize |
| `src/sidebar/hierarchy-panel.js` | the Hierarchy tab (`nx-tree`) |
| `src/sidebar/frame-inspector.js` | Frame / "In frame" / Constraints inspectors |
| `src/sidebar/variables-inspector.js` | the Variables block |
| `src/runtime/` (`dist/nexa-runtime.bundle.js`) | recursive mount, node visibility, layout CSS, scopes, Set Variable, overlays, teleport |

Tests:

| Test | Covers |
| --- | --- |
| `test/model-tree.test.js` | the model |
| `test/mock-tree.js`, `mock-group.js`, `mock-frames.js`, `mock-resize.js` | the editor |
| `test/runtime-layout-browser.test.js`, `runtime-variables-browser.test.js` | the deployed page in headless Chrome |
