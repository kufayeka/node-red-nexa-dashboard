# Nexa Component SDK

The Nexa Component SDK is how you write a component, or a Logic node, for Nexa Dashboard.

- Each component is **one declaration** (`defineComponent`) covering properties, inputs, outputs, events, actions, the property panel and the view.
- Each Logic node is **one declaration** too (`defineLogicNode`, [§12b](#12b-logic-nodes-definelogicnode)): its palette entry, its fields (the dialog is built from them) and what it does on the page.
- The view is a **Lit** component.
- The property panel is built from **`<nx-*>`** widgets. Every plugin therefore looks and behaves the same in the editor.
- Tags are **generic**. Sparkplug B is the first tag provider; OPC UA, SQL and UDT tags plug in later, and components need no changes.

> Reference plugins in this repo:
> - `@kufayeka/nexa-component-fields`: inputs; an inspector laid out with groups and sections; `FieldController`.
> - `@kufayeka/nexa-component-buttons`: a boolean control; per-state CSS; migration.
> - `@kufayeka/nexa-component-basic-shapes`: simple components, the inspector from `group` alone.
> - `test/fixtures/sdk-plugin/plugin.js`: every advanced feature in one file.
> - `test/fixtures/sdk-logic-plugin/plugin.js`: a Logic node.
>
> For a new plugin, start from `sdk/template/`.

---

## Contents

1. [A component in one file](#1-a-component-in-one-file)
2. [Packaging a plugin](#2-packaging-a-plugin)
3. [`defineComponent` reference](#3-definecomponent-reference)
4. [Properties](#4-properties)
5. [Inputs, outputs and generic tags](#5-inputs-outputs-and-generic-tags)
6. [Events and actions](#6-events-and-actions)
7. [The view (`NexaElement`)](#7-the-view-nexaelement)
8. [States, parts and Custom CSS](#8-states-parts-and-custom-css)
9. [The inspector](#9-the-inspector)
10. [The `<nx-*>` widget catalog](#10-the-nx--widget-catalog)
11. [Fields: `FieldController` and codecs](#11-fields-fieldcontroller-and-codecs)
12. [Tag providers](#12-tag-providers)
12b. [Logic nodes: `defineLogicNode`](#12b-logic-nodes-definelogicnode)
13. [Lifecycle: versions and migrations](#13-lifecycle-versions-and-migrations)
14. [Testing with the testkit](#14-testing-with-the-testkit)
15. [Rules and limits](#15-rules-and-limits)
16. [How it works (for core maintainers)](#16-how-it-works-for-core-maintainers)

---

## 1. A component in one file

```js
// dist/gauge.js — an ES module
import { defineComponent, NexaElement, html, css } from "../../nexa-sdk/nexa-component-sdk.js";

export default defineComponent({
    id: "acme-gauge",
    label: "Gauge", category: "Display", icon: "fa fa-tachometer",
    size: { w: 200, h: 120 },

    // 1. PROPERTIES: what the user configures (saved in the screen).
    //    `group` / `section` place them in the inspector's tree (§9)
    properties: {
        max:      { type: "number", default: 100, min: 1, group: "Scale",
                    warn: (v) => (v > 1000 ? "A very large scale" : "") },
        barColor: { type: "color",  default: "#16a34a", group: "Style" }
    },
    groups: ["Data", "Scale", "Style"],          // the inspector's group order

    // 2. INPUTS (tags read) and 3. OUTPUTS (tags written)
    inputs:  { value:    { type: "number", label: "Value" } },
    outputs: { setpoint: { label: "Setpoint" } },

    //    EVENTS (fired to Logic) and ACTIONS (called from Logic)
    events:  { overMax: { label: "On Over Max", payload: { value: "number" } } },
    actions: { reset:   { label: "Reset peak" } },

    // 4. THE VIEW: a Lit component; event handling lives here
    state: { peak: 0 },                          // internal, reactive, not saved
    view: class extends NexaElement {
        static styles = css`:host { display: block; }`;
        propsChanged() {
            const v = this.in.value;             // null while the tag is unknown
            if (v !== null && v > this.peak) this.peak = v;
            if (v !== null && v > this.p.max) this.emit("overMax", { value: v });
        }
        reset() { this.peak = 0; }               // the "reset" action
        render() {
            const pct = Math.min(100, ((this.in.value || 0) / this.p.max) * 100);
            return html`<div style="width:${pct}%;background:${this.p.barColor}">${this.in.value ?? "???"}</div>
                        <button @click=${() => this.out.write("setpoint", this.peak)}>Hold peak</button>`;
        }
    }
});
```

That is the whole component. You don't write a registry call, a custom element name, a property panel or tag-parsing code: the inspector is built from `properties`, `inputs` and `outputs`.

---

## 2. Packaging a plugin

A plugin is an ordinary Node-RED plugin package with three files:

```
acme-nexa-gauges/
  package.json            "node-red": { "plugins": { "acme-nexa-gauges": "widgets/plugin.js" } }
  widgets/plugin.js       backend: one call
  widgets/plugin.html     editor: one <script type="module">
  dist/gauge.js           your components (ES modules, no build step needed)
```

```js
// widgets/plugin.js
module.exports = function (RED) {
    require("@kufayeka/node-red-nexa-dashboard/sdk/package")(RED, {
        id: "acme-nexa-gauges",                          // the Node-RED plugin id
        name: "acme-nexa-gauges",                        // URL: <root>/acme-nexa-gauges/vendor/
        dir: require("path").join(__dirname, "..", "dist"),
        modules: ["gauge.js"]
    });
};
```

```html
<!-- widgets/plugin.html -->
<script type="module" src="acme-nexa-gauges/vendor/gauge.js"></script>
```

The helper does three things:
- It serves `dir` at `<root>/<name>/vendor/` on both the editor and deployed pages, with CORS. A deployed page runs on the screen worker's own port, so importing a module from Node-RED's port is cross-origin.
- It registers the package so the dashboard adds `<script type="module">` for your modules to every deployed page.
- It lets modules served from `<root>/<name>/vendor/` import the SDK with the same relative path in both places: **`../../nexa-sdk/nexa-component-sdk.js`**.

If your plugin bundles itself, alias the bare name `nexa-component-sdk.js` to that URL.

**Why an import and not a global?** The SDK module is a facade over the SDK bundle the host page already loads. There is one copy of Lit, one registry and one set of `<nx-*>` widgets per page. The editor runs plugin scripts in no guaranteed order, so the facade waits for the SDK with top-level await, and your module's code always runs with the SDK ready.

---

## 3. `defineComponent` reference

| Key | Type | Meaning |
|---|---|---|
| `id` | string, **required** | Unique component type id, stored in screens. Prefix it with your organisation. |
| `label`, `category`, `icon`, `help` | string | Palette entry. `icon` is a Font Awesome 4 class. |
| `size` | `{ w, h }` | Default size when dropped. |
| `capabilities` | `{ resizable, rotatable, flippable, lockable }` | Canvas behaviour. All default to `true`. |
| `properties` | object | [§4](#4-properties) |
| `inputs` / `outputs` | object | [§5](#5-inputs-outputs-and-generic-tags) |
| `events` / `actions` | object | [§6](#6-events-and-actions) |
| `states`, `parts`, `css` | object, object, string | [§8](#8-states-parts-and-custom-css). They declare selectors and the component's own CSS; Custom CSS **fields** come only from `properties` (`cssFields`). |
| `state` | object | Internal reactive fields of the view (`this.<name>`), not saved. |
| `groups` | `["Data", "Style", …]` | The inspector's group order ([§9](#9-the-inspector)); groups not named follow in the order the props declare them. There is no hand-written panel: a def's `inspector` is ignored (a warning). |
| `view` | class extending `NexaElement` | [§7](#7-the-view-nexaelement), **required** |
| `preview` | `{ inputs: { name: value } }` | Values shown **in the editor** while an input is unbound or unknown, so a chart is not empty while you design. |
| `editor` | `{ interactive: [selectors] }` | Parts of the view that still take clicks in the editor (tab headers, scrollbars). Everything else selects / drags the component. |
| `assets` | `{ base, scripts: [], styles: [] }` | External libraries. Scripts load once per page (`this.ready`, `this.assetsReady`); styles go into each component's shadow root. Pass `base: import.meta.url` so relative URLs resolve next to your module. |
| `version`, `migrate` | number, `(props, fromVersion) => props` | [§13](#13-lifecycle-versions-and-migrations) |
| `hideTagWatch` | boolean | Hide the editor's generic "Tag Watch" field. It is hidden automatically when the component declares inputs or outputs. |

`defineComponent` returns the registered definition (`def.nexa` holds the normalized metadata).

---

## 4. Properties

```js
properties: {
    decimals: { type: "number", default: 2, min: -1, max: 10, label: "Decimals", help: "…", group: "Format" }
}
```

| Type | Stored value | Default widget |
|---|---|---|
| `string` | string | `nx-text` (`prefix`, `suffix`, `mono`, `maxLength`, `secret`) |
| `text` | string | `nx-textarea` (`rows`, `mono`) |
| `number` | number, or `""` when empty | `nx-number` (`min`, `max`, `step`, `unit`) |
| `range` | number | `nx-slider` (`min`, `max`, `step`) |
| `boolean` | boolean | `nx-checkbox`, or `nx-toggle` with `style: "toggle"` |
| `enum` | any | `nx-segmented` (at most 3 short options) or `nx-select`; force one with `style: "segmented" \| "select" \| "combobox"`. `options: ["a", { value, label, icon }]`. |
| `color` | CSS colour string | `nx-color` (hex, rgb(a), named, `transparent`) |
| `css` | CSS string | `nx-code` (CSS tray) |
| `code` | string | `nx-code` (`lang: "javascript"`) |
| `json` | any JSON | `nx-code` (JSON) |
| `tag` | `"{provider:address}"` | `nx-tag` |
| `asset` | `"{asset:name}"`, a URL, or `""` | `nx-asset`: the app's images (the Assets tab) as thumbnails, Import…, a URL. In the view, `assetUrl(this.p.key)` gives what to show. See [MEDIA.md](MEDIA.md). |
| `list` | array | `nx-list`. `item` is one schema (a list of values) or `{ fields: {…}, row: true }` (a list of objects). |

These attributes apply to every type:
- `default`, `label` (the key is humanized when omitted), `help`, `placeholder`, `icon`.
- `group` (default "General") and `section`: where the prop sits in the inspector's tree ([§9](#9-the-inspector)).
- `required`; `validate(value, p) → message | null` (blocks: the row shows ⓘ); `warn(value, p) → message | ""` (does not block: a warning under the widget).
- `visibleWhen(p)` and `enabledWhen(p)`.
- `perState: "<state>"`, shown only while that state is previewed.
- `bindable` (default `true` for plain values), `noReset`, `hidden`.
- `options` (an enum) may be a function `(p) → list | Promise<list>`: loaded once per inspector.
- `summary(value, p) → text`: what the prop's tree row shows (default: a simple form of the value).
- `editor: "<tag>"`: the prop's own editor ([§9](#9-the-inspector)).
- A `list`: `noun` ("tab": `[3 tabs]`, "Add tab"), `itemLabel` (an item field's key, or `(item, i) → text`), `min`, `max`.

Keys you've saved must stay stable. If you rename one, bump `version` and add a `migrate` ([§13](#13-lifecycle-versions-and-migrations)).

---

## 5. Inputs, outputs and generic tags

```js
inputs: {
    value: { type: "number", label: "Value", throttle: 100 },           // this.in.value
    pens:  { type: "number", multiple: true, label: "Pens" },           // this.in.pens -> array
    sp:    { providers: ["opcua"], label: "Setpoint (OPC UA only)" }
},
outputs: {
    sp: { fallback: "sp", label: "Setpoint write" }                     // empty -> write to inputs.sp's tag
}
```

- An input or output is a **binding prop**. An input can read from any source:

  | Source | Saved as | Example |
  |---|---|---|
  | Tag | `{provider:address}` | `{sparkplug:Plant::Edge1::Mixer::Speed}`, `{opcua:ns=2;s=Motor.Speed}` |
  | Variable / template parameter | `{name}`, `{name.member}` | `{speed}`, `{param1.description}`, `{M101.Speed}` (a UDT member) |
  | Message | `{msg.path}` | `{msg.payload.speed}`, sent by an "Update Component" node |
  | Expression | text with bindings | `Line {line}: {sparkplug:G::E::D::Speed} rpm` |

  - An output (a write target) takes a tag, a variable / parameter member or `{$route.query.name}`. A message or an expression cannot be written.
  - It is saved as `prop` when you give one (keep old names stable, e.g. `prop: "readTag"`), otherwise as `input<Name>` / `output<Name>`.
- In the view:
  - `this.in.value` is the live value, typed by `type` (`number`, `boolean`, `string`, `any`), whatever the source. It is `null` while unknown: offline, no data yet, "???", or a variable not declared around the component. It is an array for `multiple`.
  - `throttle: ms` delivers at most one change every `ms`; the last value always arrives.
  - `this.out.write("sp", v)` returns a Promise. It resolves `{ local: true }` when nothing writable is bound (a local-only component) and in the editor.
    - An output left empty writes to its `fallback` input. A field whose Read Tag is `{param1.description}` therefore writes the text back to it: a two-way binding.
  - `this.out.canWrite("sp")` and `this.out.target("sp")` tell you where a write would go.
  - `this.status("value")` returns `{ bound, unknown, provider, providerLabel, address, display, valid }`.
- `providers` limits which tag providers the picker offers for that input or output.
- In the inspector (group "Data" unless the input / output gives `group` / `section`), its tag field shows a Source picker:
  - an input: Variable / Tag / Message / Expression;
  - an output: Variable / Tag.
  - `<nx-tag tags-only>` offers tags only.
- A **plain property** (a label, a colour, `disabled`…) needs no declaration: it is bindable by default (`bindable: false` turns it off).
  - Its ⛓ button binds it to the same four sources.
  - `this.p.key` is then the resolved value, so the view never parses a binding itself.

Components never parse tag strings themselves. The host resolves values and routes writes to the provider: Sparkplug goes through the dashboard's own write path, and any other provider through its `write()`.

---

## 6. Events and actions

```js
events:  { overMax: { label: "On Over Max", payload: { value: "number" } } },
actions: { reset: { label: "Reset peak" }, scrollTo: { label: "Scroll to row", params: { row: "number" } } }
```

- **Events** go out to Logic: `this.emit("overMax", { value })`. They appear as "On …" chips in the editor's Events tab.
- **Actions** come in from Logic. Declare them, then implement a method of the same name on the view: `reset()` / `scrollTo(params)`. On a deployed page, a Logic *Update Component* node whose message has `msg.action = "reset"` (and optionally `msg.payload` as params) calls it.

---

## 7. The view (`NexaElement`)

`view` is a Lit class extending `NexaElement`. It renders in its own shadow root, so your CSS never leaks. Everything below is available on `this`:

| Member | |
|---|---|
| `p` | Properties, defaults filled in. |
| `raw` | The stored props as saved (tag strings intact). |
| `in.<name>`, `out.write()`, `status()` | [§5](#5-inputs-outputs-and-generic-tags) |
| `emit(event, payload)` | Fire a Logic event. |
| `setProp(key, value)` | Change one of its own properties (two-way). |
| `mode`, `isEditor`, `previewState` | Editor vs deployed page; the state picked in the inspector's preview switcher. |
| `size` | `{ w, h }`, reactive (a ResizeObserver). |
| `every(ms, fn)`, `after(ms, fn)`, `listen(target, type, fn)`, `onDestroy(fn)` | Timers and listeners cleaned up automatically. |
| `mounted()`, `unmounted()`, `propsChanged()` | Hooks. Register timers in `mounted()`; derive state in `propsChanged()`. |
| `ready`, `assetsReady` | The `assets` scripts are loaded. |
| `format(value, numberOptions)` | Number / text formatting helper (decimals, separators). |
| `state` keys | Reactive fields declared in `state: {…}`. |

Also:
- In the editor the component is not interactive (the canvas selects and drags it), except the parts listed in `editor.interactive`.
- If you override `connectedCallback`, `disconnectedCallback` or `updated`, call `super`.
- Reusable behaviour belongs in a **Lit ReactiveController** (see `FieldController`).

---

## 8. States, parts and Custom CSS

```js
css: "button { border-radius: 4px; }",                 // the component's own CSS, always applied
states: {
    false: { label: "State 0", selector: "button.state-false", css: "",                   color: "#94a3b8" },
    true:  { label: "State 1", selector: "button.state-true",  css: "background: green;", color: "#22c55e" },
    hover: { label: "Hover",   selector: "button:hover",       css: "filter: brightness(.95)", preview: false }
},
parts: { label: { label: "Field label", selector: ".x-label", css: "font-weight: 600;" } },
properties: {
    // Custom CSS fields: only if the component offers them (the SDK adds none on its own)
    ...cssFields({ base: true, parts, states, group: "Custom CSS" })
}
```

- `css` is the component's own stylesheet. It is always applied, base first, in the component's shadow root.
- `states` and `parts` declare **selectors**. A state's selector styles that state; a part is a piece of the view (a label, a helper line).
- **Custom CSS fields are the component's choice.** The SDK does not add them. A component that wants them declares `type: "css"` properties:
  - with no target: the base field. The user's text replaces `css` when they fill it in.
  - with `part: "<name>"`, `state: "<name>"`, or `selector: "<css selector>"`: that piece. The user writes declarations and the SDK wraps them in the selector (a block holding `{` is used as-is).
- `cssFields({ base, parts, states, group })` writes those fields for you, with the keys screens already use: `css`, `css<Part>` (`cssLabel`), `css<State>` (`cssTrue`, `cssHover`). `base` is `true` (an empty "Base CSS" field), a default text, or `false` (no base field).
- A CSS field that targets a part or a state the component doesn't declare is refused.
- Stylesheet order: base, then parts / selectors, then states, so a state can still restyle a part.
- States with `preview !== false` appear in the inspector's preview switcher, above its tree. The view reads `this.previewState` to show that state in the editor.

---

## 9. The inspector

Every component gets the same inspector, built from its schema. There is nothing to write for it.

```
 Search properties and values
 ▾ DATA                        3
     Read Tag      {sparkplug:G::E::D::Speed}
   ▾ Tabs          [3 tabs]
     ▸ Overview
     ▸ Alarms
 ▾ STYLE                       4
   ▾ Text                      2
       Size        14 px
       Weight      Semibold
     Background    ■ #0f62fe
     Custom CSS    3 lines · .x {
 ─────────────────────────────── (drag to resize)
 Style › Text
 Size          [ 14        px ]
```

- **The tree.** `group` makes the top rows (ordered by `groups`), `section` a level inside a group, then one row per prop. A list's items are rows under it, and an item's fields under the item.
  - A row shows the value in a simple form only: a text's first line, a number with its unit, a check, a colour swatch, `[3 tabs]`, `4 lines · …`, a binding with ⛓. It never shows a control. Markers: a dot (changed from the default), ⓘ (invalid), ⚠ (`warn`), 📱 (set per breakpoint).
  - Search (above the tree) matches labels, keys and values. Arrow keys move the selection, Left / Right collapse / expand, Enter goes to the editor.
  - Which row is picked, what is open and the search are remembered per component type, so editing the same field on ten buttons is ten clicks on the canvas.
- **The editor pane** (below) edits the ONE picked row:
  - a prop: its widget. Bound widgets get the value, label, help, limits, options, validation, the reset button, the **⛓ bind button** (a tag / variable / message / expression instead of a value, with its **Fallback**, `props.__fallback[key]`), the **◆ theme token** picker (`color`, or `tokens: "fontSizes"`; docs/THEME.md) and, in the editor, the **📱 responsive button** (a value per breakpoint, chips above the widget; `noResponsive: true` opts out). Code, CSS, JSON and long text can make the pane bigger (⤢).
  - a list: its items with move up / down / remove, and Add. The new item is picked.
  - a list item: its fields, with Up / Down / Duplicate / Remove. An item's field: that field alone.
  - a group or a section: its props with their values; click one to go to it.

  Every change is applied live with undo, and consecutive edits of one field are one undo step. A field being typed in is applied when you pick another row or another component, to the prop it was typed for.
- **The selection is kept.** Any re-render (an edit, a breakpoint switch, undo, a plugin loading) keeps the picked row. When its node is gone (an item removed, `visibleWhen` false) the nearest one is picked.

### A prop's own editor: `definePropertyEditor`

When a prop needs more than a widget (a curve, a drawing, a picker that asks your server), give it an editor:

```js
import { definePropertyEditor } from "../../nexa-sdk/nexa-component-sdk.js";

definePropertyEditor("acme-curve-editor", ({ PropertyEditor, html }) => class extends PropertyEditor {
    static kind = "dialog";              // "inline" (in the pane, default) | "large" (the pane can grow) | "dialog"
    static plugin = "acme-nexa-gauges";  // whose admin routes this.api calls (sdk/package `name`)
    static summary(value, props) { return value ? value.points.length + " points" : ""; }   // its tree row
    static properties = { curves: { state: true } };

    async connectedCallback() { super.connectedCallback(); this.curves = await this.api.get("/curves", { q: "pump" }); }
    render() {
        return this.frame(html`${(this.curves || []).map((c) => html`
            <button class="nx-btn" @click=${() => this.commit(c)}>${c.name}</button>`)}`);
    }
});

// properties: { curve: { type: "json", default: null, editor: "acme-curve-editor" } }
```

- It is a `KitElement`, the same contract as the built-in widgets: `this.value` in, **`this.commit(value)`** out (one undo step), **`this.preview(value)`** to show a value on the canvas while picking (no undo step, not saved). `this.frame(control)` adds the label, help, reset / ⛓ / 📱 buttons.
- `this.prop` is the prop's schema, `this.props` the component's props.
- `kind: "dialog"`: the pane shows the summary and **Edit…**. The editor opens in a dialog with its own draft, and only **Apply** commits.
- **`this.api`** calls your plugin's own server routes (below): `get(path, query)`, `post(path, body)`, `put(path, body)`, `del(path, query)`, JSON in and out, with the editor's login. A route that fails rejects with `error.message` and `error.status`. Outside an editor: `NexaSDK.adminApi(name)`.
- It is defined only in the editor (queued until the property kit loads), never on a deployed page, so a page never pays for it.
- `defineInspectorWidget(tag, factory)` (a plain `KitElement`) still works and can be named by `editor:` too.

**Your plugin's admin routes.** Give `sdk/package` an `adminApi`:

```js
require("@kufayeka/node-red-nexa-dashboard/sdk/package")(RED, {
    id: "acme-nexa-gauges", name: "acme-nexa-gauges", dir, modules: ["gauge.js"],
    adminApi: (router, RED) => {
        router.get("/curves", async (req, res) => res.json(await loadCurves(req.query.q)));
        router.post("/curves", async (req, res) => res.json(await saveCurve(req.body)));
    }
});
```

They are mounted at `<admin root>/<name>/api/` on the editor only (never on deployed pages), behind Node-RED's login: GET needs `flows.read`, the rest `flows.write`. JSON bodies are parsed, and a handler that throws or rejects answers `500 { error }`. Secrets (an API key, a database password) stay on the server.

## 10. The `<nx-*>` widget catalog

Every widget follows the same contract:
- `.value` holds the value, and there is **one** event, `nx-change` (`detail.value`).
- Attributes: `label`, `help`, `icon`, `placeholder`, `badge`, `disabled`, `readonly`, `required`, `invalid` + `message`.
- `.binding` shows a tag picker in place of the control.

They render in light DOM (Font Awesome icons work) and are styled by the kit's tokens (`--nx-*`), which follow the editor theme, dark mode included.

| Widget | Use | Specific |
|---|---|---|
| `nx-text` | Single-line text | `mono`, `addon-before`, `addon-after`, `maxlength`, `type="password"` |
| `nx-textarea` | Multi-line text | `rows`, `mono` |
| `nx-number` | Number (`""` = empty; 0 is a value) | `min`, `max`, `step`, `unit` |
| `nx-slider` | Range with a number box | `min`, `max`, `step` |
| `nx-select` | Choice (any value type) | `.options=[{ value, label }]` |
| `nx-segmented` | Short choice as buttons | `.options`, `icons-only` |
| `nx-combobox` | Text with filtered suggestions | `.options` or `.source(query)`, `.free` |
| `nx-checkbox`, `nx-toggle` | Boolean | `indeterminate` (checkbox) |
| `nx-color` | Colour (text + swatch + picker + clear) | |
| `nx-code` | Code launcher (preview + "Edit…" → CM6 tray) | `language="css\|javascript\|json"` |
| `nx-tag` | Generic tag picker (provider chips, suggestions, validity) | `access`, `.providers` |
| `nx-list` | Rows: add / remove / drag-reorder | `.renderItem`, `.newItem`, `add-label`, `min`, `max` |
| `nx-state-switcher` | Preview-state chips | `.states` |
| `nx-alert`, `nx-badge` | Notes / pills | `tone="info\|warn\|error\|success"`, `text` |
| `nx-field` | The frame around your own `.content` | |
| `nx-tabs` + `nx-tab` | Tabs (children are yours) | `persist-key`; `nx-tab label icon badge` |
| `nx-section` | Collapsible block | `heading`, `icon`, `badge`, `collapsed`, `persist-key` |
| `nx-row` | Children side by side | `cols` |

---

## 11. Fields: `FieldController` and codecs

`FieldController` is a Lit ReactiveController that runs the edit cycle of an input:

```
idle -focus-> editing -input-> (live validation)
   commit -> parse + validate -x-> invalid (stays in edit)
          -> same value? -> idle        confirmWrite? -> declined -> idle
          -> pending -write fails-> error (reverts)
          -> ack -> idle once the INPUT tag reports the value (or 3 s after the ack)
```

```js
view: class extends NexaElement {
    field = new FieldController(this, { codec: "float" });   // input/output "value" by default
    updated(c) { super.updated(c); this.field.sync(this.renderRoot.querySelector("input")); }
    render() {
        const f = this.field;
        return html`<div class="nexa-field ${f.classes}" title=${f.message}>
            <input @focus=${f.onFocus} @blur=${f.onBlur} @input=${f.onInput} @keydown=${f.onKeyDown}>
        </div>`;
    }
}
```

- **Options:** `codec`, `input`, `output`, `multiline` (Enter = new line, Ctrl+Enter commits), `sensitive` (password), `validate: [(value, p) => reason | null]`.
- **API:** `text`, `classes`, `message`, `value`, `editing`, `align`, `inputMode`, `maxLength`; `begin()`, `input(text)`, `commit(text)`, `cancel()`, `end(text)`; the DOM helpers `onFocus`, `onBlur`, `onInput` (live thousands grouping), `onKeyDown` and `toggleReveal`; and `sync(el)`, which never overwrites text being typed.
- **Declarations to spread:**
  - `FieldController.properties(codec, extra)`: codec props plus prefix, suffix, align, placeholder, previewValue, commitOnBlur, confirmWrite, selectOnFocus, readonly, disabled and opacity.
  - `FieldController.states(wrapperSelector)`.
  - `FieldController.events()`.
- **Codecs:** `text`, `int` and `float` are built in (decimals, decimal and thousands separators, min/max). Add your own with `defineCodec(name, { kind, props, parse, format, editText, equals, live, inputMode, align })`. Codecs are pure and synchronous.

---

## 11b. The theme

The app's design tokens, in the current colour mode, from the SDK (docs/THEME.md):

```js
import { theme } from "../../nexa-sdk/nexa-component-sdk.js";
theme.token("colors.primary.solid");  theme.cssVar("colors.bg");  theme.mode();  theme.list("spacing");  theme.onChange(fn);
```

In a view: `this.token(path)` / `this.tokenVar(path)`; the view redraws when the theme or the mode changes. Prefer `var(--nexa-…)` in CSS.

## 11b-1. Popups above the page: `this.lift(on)`

Each component is drawn in its own box, and a box that comes later on the page paints over an earlier one. A popup inside a component (a select's menu, a tooltip) would be hidden under the components below it. Call `this.lift(true)` while it is open: the component's box, and every frame around it, is raised above the rest. Call `this.lift(false)` when it closes (it also runs when the component goes away). Nexa UI's Select and Combobox call it from zag's `onOpenChange`.

## 11b-2. Slots: a component that holds other components

A component can hold other components, the way a Tabs holds a panel per tab. It declares **slots**. The editor gives each slot a frame of the page (a **slot frame**), and the user drops components into it on the canvas. The component only decides where each slot is drawn and whether it shows.

```js
defineComponent({
    id: "acme-tabs", label: "Tabs",
    properties: { tabs: { type: "list", default: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } },
    // a list ([{ name, label }] or names), or a function of the props: one slot per tab
    slots: (p) => p.tabs.map((t) => ({ name: t.value, label: t.label })),
    editor: { interactive: [".tab"] },   // tab headers take clicks on the canvas
    view: class extends NexaElement {
        render() {
            return html`<div class="head">…</div>
                ${this.renderSlot(this.shown, { style: "position:absolute;inset:0" })}`;
        }
        revealSlot(name) { this.shown = name; this.requestUpdate(); }   // the editor wants it seen
    }
});
```

- `this.renderSlot(name, opts)` draws the place of slot `name`: a `position: relative` box with a native `<slot>` in it. The slot frame fills that box. Give it a size with CSS (`.nx-slot`, `opts.class`, `opts.style`). Style it from outside as `::part(slot)` or `::part(slot-<name>)`.
- If you don't render a slot, it isn't shown (an inactive tab). Its content stays mounted and keeps its state.
- `this.slotList` gives the slots declared right now.
- `revealSlot(name)` is called when the user picks something inside that slot (in the Hierarchy); switch to it. `this.slotShown(name)` tells the editor which slot is shown after a click on the canvas, so the canvas keeps it when it redraws.
- A slot frame is a normal frame: auto layout, padding, fill, variables. In Properties you see its layout and look; the component sets its position and size. It can't be moved, resized or taken out of its component. A double click on the component selects the slot frame.
- If a slot goes away (a tab is removed or its value renamed), its frame is **kept** (`slotUnused`) and not drawn. Its content comes back if the slot comes back.
- Deleting the component turns what its slots held into orphans (Hierarchy → Unplaced).
- **On the live page**, a plugin's modules usually register *after* the page was drawn. What a component's slots hold is mounted at that moment, and everything the first mount does is done for it too: its tags subscribed, its teleports, its templates' param-input, its Logic's onload / onrender (`beginLateMount` / `endLateMount` in `src/runtime/mounting/render.js`, bundled into `dist/nexa-runtime.bundle.js`). Without this, a tag-bound component in a Tabs panel showed `???` forever.
- The data: the component node has `slots: true`, and its `children` are the slot frames (`@frame`, `inSlot: "<name>"`, `slotLabel`). On the live page each slot frame is a light-DOM child of the component's element with `slot="<name>"`. Tests: `test/model-slots.test.js`, `test/runtime-slots-browser.test.js`.

## 11c. zag.js (accessible widgets)

The SDK includes [zag.js](https://zagjs.com): state machines for keyboard, focus, ARIA and positioning of complex widgets. Take it from the SDK, not from npm:

```js
import { NexaElement, html, zag } from "../../nexa-sdk/nexa-component-sdk.js";
const { ZagController, spread, select } = zag;

class MySelect extends NexaElement {
    sel = new ZagController(this, select, () => ({
        collection: select.collection({ items: this.p.options }),
        value: [this.p.value],
        onValueChange: (d) => this.setProp("value", d.value[0])
    }));
    render() {
        const api = this.sel.api;
        return html`<button ${spread(api.getTriggerProps())}>${api.valueAsString || "Pick…"}</button>
            <div ${spread(api.getPositionerProps())}><ul ${spread(api.getContentProps())}>
                ${api.collection.items.map((it) => html`<li ${spread(api.getItemProps({ item: it }))}>${it.label}</li>`)}
            </ul></div>`;
    }
}
```

- **`ZagController(host, module, props)`** runs the machine while the view is on the page. Its shadow root is the machine's root, and each view gets its own id. The view redraws on every change of the machine, and `props()` is read each time, so a bound prop reaches the machine.
- **`spread(props)`** puts zag's attributes and listeners on an element, diffed between renders.
- **Machines**: `select`, `combobox`, `slider`, `tagsInput`, `pinInput`, `ratingGroup`, `numberInput`.
- **Lower level**: `VanillaMachine`, `normalizeProps`, `spreadProps`, `mergeProps`.

## 12. Tag providers

A provider teaches Nexa one kind of tag:

```js
import { defineTagProvider } from "../../nexa-sdk/nexa-component-sdk.js";
defineTagProvider("opcua", {
    label: "OPC UA", icon: "fa fa-plug", placeholder: "ns=2;s=Path",
    parse:   (address) => /^ns=\d+;[isgb]=.+$/.test(address) ? { ns: …, id: … } : null,   // REQUIRED, pure
    format:  (ref) => "ns=" + ref.ns + ";" + ref.id,
    display: (ref) => "ns" + ref.ns + " " + ref.id,
    list:    () => [{ address: "ns=2;s=Motor.Speed", label: "Motor.Speed" }],           // tag-picker suggestions
    write:   (ref, value) => fetch(…)                                                    // how a deployed page writes
});
```

- Every tag picker then offers the provider, validates its addresses and shows its suggestions, and `this.out.write()` routes to its `write()`.
- `extendTagProvider(name, parts)` adds pieces later. The editor, for instance, fills in Sparkplug's `list()` from the live tree.
- `parseTag`, `makeTag`, `isTag`, `getTagProvider` and `listTagProviders` are exported too.
- Value *resolution* on a deployed page is a host concern: Sparkplug is built into the dashboard, and a new provider's live values need its host side.

---

## 12b. Logic nodes: `defineLogicNode`

A plugin adds nodes to the Events (Logic) palette the same way it adds components, from the same module, in the same package (§2):

```js
import { defineLogicNode } from "../../nexa-sdk/nexa-component-sdk.js";

export const modbusRead = defineLogicNode({
    type: "acme-modbus-read",              // required, unique: lower-case words joined by "-", your prefix first
    label: "Modbus Read",                  // the palette chip, and the canvas label by default
    help: "Reads a holding register.",     // shown at the top of its dialog
    palette: { section: "Industrial", icon: "fa-plug", color: "#2f6f8f", chipColor: "#d9e8f0" },
    inputs: 1,                             // 0 = a source (it starts chains); default 1
    outputs: 2, outputLabels: ["value", "error"], exclusivePorts: true,
    properties: {                          // the node's dialog is built from these (§4 property types)
        address: { type: "number", default: 40001 },
        unit:    { type: "string", default: "{msg.payload.unit}", label: "Unit (a binding is fine)" }
    },
    nodeLabel: (node) => "Read " + node.props.address,     // optional: the label on the canvas
    run(node, msg, ctx) {                  // on the page
        const unit = ctx.resolve(node.props.unit, msg);
        readRegister(node.props.address, unit).then(
            (v) => ctx.nextPort(0, { ...msg, payload: v }),
            (e) => ctx.nextPort(1, { ...msg, error: e.message }));
    }
});
```

- **Settings live in `node.props`**, the same as every built-in node: `{ id, type, x, y, props: {...} }`.
- **The editor** puts a chip in `palette.section` (default "Plugins"). A new node starts with the fields' defaults. Double-click opens a dialog built from `properties` with the property kit, the same widgets as a component's inspector. A field can hold a value or a binding: Variable, Message or Expression (Tag bindings aren't offered: the page doesn't subscribe tags for a Logic node).
- **`run(node, msg, ctx)`**: return a msg to pass it on through output 1. Or return nothing, and call `ctx.next(msg)` / `ctx.nextPort(port, msg)` when ready (async). Return nothing and call neither for a sink. `ctx` gives you:

| | |
|---|---|
| `ctx.next(msg)` | pass `msg` on through output 1 |
| `ctx.nextPort(port, msg)` | through output `port` (0-based) |
| `ctx.resolve(text, msg)` | a field's bindings filled in: `{variable}`, `{msg.payload.id}`, `{$route.params.id}`, text mixing them |
| `ctx.vars.get(name, scope?)` / `ctx.vars.set(name, value, scope?, op?)` | variables, as a Function node sees them |
| `ctx.log(...)` | the console, tagged with the node |

- **Loading.** The module loads in the editor and on every deployed page, like a component plugin. On the page it runs after the runtime started: a chain that reaches the node before the plugin registered waits for it (up to 10 s), then runs it. A type nobody registers (the plugin isn't installed) is reported in the console and stops the chain there.
- **Refused:** a `type` without a prefix or not in lower case, a built-in type, a missing `run`, a `nodeLabel` that isn't a function.
- Tests: `test/sdk-logic-node.test.js` (definition), `test/runtime-logic-plugin-browser.test.js` (a plugin module on a page), and the fixture `test/fixtures/sdk-logic-plugin/plugin.js` as an example.

## 13. Lifecycle: versions and migrations

```js
version: 2,
migrate: (props, fromVersion) => {
    if (fromVersion < 2) { props.readTag = props.stateValue; delete props.stateValue; }
    return props;
}
```

Saved props carry `__v`. Props from an older version are migrated:
- In the editor the first time the component is rendered, and saved (the project is marked dirty).
- On deployed pages, in memory.

Components without `version` are version 1.

---

## 14. Testing with the testkit

```js
const { withHarness } = require("@kufayeka/node-red-nexa-dashboard/sdk/testkit");
withHarness({
    mounts:  { "/acme-nexa-gauges/vendor": path.join(__dirname, "..", "dist") },
    modules: ["/acme-nexa-gauges/vendor/gauge.js"]
}, async ({ js, type, key, logs }) => {
    await js('NexaTest.mount("g", "acme-gauge", { inputValue: "{sparkplug:G::E::D::m}" })');
    await js('NexaTest.setTag("g", "42")');
    // bound to a variable / template parameter or the message instead of a tag:
    await js('NexaTest.setVariable("param1", { speed: 12 })');       // {param1.speed}, for every mounted component
    await js('NexaTest.setMode("dark")');                             // the theme's colour mode: {token:…} props, NexaSDK.theme
    await js('NexaTest.setMessage("g", { payload: { v: 7 } })');      // {msg.payload.v}, for one
    await js('NexaTest.settle()');
    const text = await js('NexaTest.wc("g").renderRoot.textContent');
    // NexaTest.item("g").writes / .events, NexaTest.ack("g", true | false), NexaTest.invoke("g", "reset"),
    // NexaTest.inspector("acme-gauge", props, host) -> { box, props, sets, destroy, select(id), field(id) }:
    //   await ins.field("max") picks the row and resolves the widget in the pane; NexaTest.rows(ins.box) lists the rows
    //   (ids: a prop's key, "tabs#2" an item, "tabs#2.label" an item's field, "@Style" a group)
    // NexaTest.mount(…, { design: true }) mounts in editor mode
});
```

The harness loads the registry, the SDK, the property kit and your modules in headless Chrome (set `CHROME_PATH` if it is not found). Typing uses real keyboard events (`type`, `key`). Build the dashboard first (`npm run build`).

---

## 15. Rules and limits

The strict version, with the change recipes and the definition of done, is [PLUGIN_RULES.md](PLUGIN_RULES.md). Its machine-checkable part runs in every plugin's `npm test` (`npm run lint` → `sdk/lint-plugin.js`).

- A view renders **only inside its own element**. It doesn't reach into the canvas, other components or `window.RED`.
- Props, event payloads and action params are **JSON-serializable**.
- Writes go **only** through `this.out.write()` to declared outputs; components don't open their own connections to devices.
- Codecs, validators and tag-provider `parse` / `format` are **pure and synchronous**.
- The inspector is built from the schema; your own UI in it is a `definePropertyEditor` editor, using `<nx-*>` widgets and no own styling.
- Stored prop names are a compatibility promise: rename them only with a migration.
- `NEXA.registerComponent(id, def)` (the pre-SDK contract, README §11) still works but is **legacy**.

---

## 16. How it works (for core maintainers)

**Source layout.** The source lives in `src/sdk/`, and `build.js` produces three browser files:
- `dist/nexa-sdk.bundle.js`: Lit, the registry and the SDK runtime (`defineComponent`, `NexaElement`, `FieldController`, codecs, tags, `bind`). It is loaded by the editor (`/nexa-dashboard/_sdk.js`) and by deployed pages (`/nexa/_sdk.js`).
- `dist/nexa-sdk-kit.bundle.js`: the property kit (`<nx-*>` widgets and the inspector: `src/sdk/kit/prop-tree/`: `model.js` the pure tree (nodes, summaries, search, list ops; `test/kit-prop-tree.test.js`), `view.js` the tree + pane, `editors.js` `PropertyEditor` / `adminApi`). Editor only. It uses the SDK's Lit and waits for it if loaded first.
- `dist/nexa-registry-client.js`: the deployed page's registry, generated from the same `src/sdk/registry.js` the editor bundles.

**Facade.** `sdk/nexa-component-sdk.js` is served at `<root>/nexa-sdk/` on httpAdmin and httpNode.

**Hosts.**
- The editor passes `ctx.mode = "editor"` and `getRawProps()`.
- The runtime passes `ctx.mode = "runtime"`, `getRawProps()` and `writeTag(propKey, value)`, which is generic: Sparkplug goes through the existing write path, and other providers through `write()`.
- Both resolve `{sparkplug:…}` in string and array props, index `multiple` inputs for live re-render, run `migrateProps`, and re-render components whose plugin registered late.
- The runtime also routes `msg.action` of an *Update Component* node to `def.invoke()`.

**Editor inspector.** `src/sidebar/kit-inspector.js` hands `def.nexa` to `NexaKit.renderInspector`, which returns `{ update, destroy, select(id), selected(), search(q) }`. Changes become `props` history events, and the same field within 1.5 s is merged into one undo step.

**Tests.**
- `test/sdk-schema.test.js`, `test/sdk-format.test.js`: Node.
- `test/sdk-kit-browser.test.js`: Chrome, against `test/fixtures/sdk-plugin`.
- Each plugin's `test/browser.test.js`.
- `test/fixtures/legacy-buttons-components.js` keeps proving that a legacy plugin still works.
