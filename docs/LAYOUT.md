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
interface Surface {                 // a Screen or a ProjectTemplate
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

## 2. Selecting and arranging (Figma rules)

| Action | Result |
| --- | --- |
| Click | Selects the outermost unselected node under the pointer (a whole group first). |
| Double-click | Dives one level into the selected container. |
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

**Selecting on the canvas** (like Webflow / Framer):

- **A click selects what is under the pointer**: a component or a template instance, through the frames around it.
- **A frame's own empty area** (padding, gap) selects the frame.
- **A group stays one thing.** Double-click goes into it.
- **Shift+Enter** selects the parent, **Enter** the first child, **Ctrl/Cmd+click** the deepest node.
- **Hovering outlines what a click would select**, with its name.

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
| `src/model/index.js` | → `lib/nexa-model.js` (CommonJS, screen worker) and `lib/nexa-model-client.js` (`window.NexaModel`, deployed page), both generated by `build.js` |
| `src/canvas/drop-target.js` | where a drop goes (frame capture, flow index), reparenting |
| `src/canvas/layout-readback.js` | boxes back from the DOM |
| `src/canvas/constraints.js` | constraints on resize |
| `src/sidebar/hierarchy-panel.js` | the Hierarchy tab (`nx-tree`) |
| `src/sidebar/frame-inspector.js` | Frame / "In frame" / Constraints inspectors |
| `src/sidebar/variables-inspector.js` | the Variables block |
| `lib/nexa-runtime-client.js` | recursive mount, node visibility, layout CSS, scopes, Set Variable |

Tests:

| Test | Covers |
| --- | --- |
| `test/model-tree.test.js` | the model |
| `test/mock-tree.js`, `mock-group.js`, `mock-frames.js`, `mock-resize.js` | the editor |
| `test/runtime-layout-browser.test.js`, `runtime-variables-browser.test.js` | the deployed page in headless Chrome |
