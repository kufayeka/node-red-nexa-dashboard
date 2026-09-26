# Hierarchy, frames, auto layout, constraints and variables

A screen (and a template) is a **tree of nodes**, laid out the way Figma does
it: containers hold children, frames can lay them out automatically, children
keep to their frame's edges, and variables flow down the tree.

- [1. The node tree](#1-the-node-tree)
- [2. Selecting and arranging (Figma rules)](#2-selecting-and-arranging-figma-rules)
- [3. Frames and auto layout](#3-frames-and-auto-layout)
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
