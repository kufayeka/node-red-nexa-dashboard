# Nexa Component SDK

The Nexa Component SDK is how you write a component for Nexa Dashboard.

- Each component is **one declaration** covering properties, inputs, outputs, events, actions, the property panel and the view.
- The view is a **Lit** component.
- The property panel is built from **`<nx-*>`** widgets. Every plugin therefore looks and behaves the same in the editor.
- Tags are **generic**. Sparkplug B is the first tag provider; OPC UA, SQL and UDT tags plug in later, and components need no changes.

> Reference plugins in this repo:
> - `@kufayeka/nexa-component-fields`: inputs; hand-written inspector; `FieldController`.
> - `@kufayeka/nexa-component-buttons`: a boolean control; per-state CSS; migration.
> - `@kufayeka/nexa-component-basic-shapes`: simple components with the automatic inspector.
> - `test/fixtures/sdk-plugin/plugin.js`: every advanced feature in one file.
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
8. [States and per-state CSS](#8-states-and-per-state-css)
9. [The inspector](#9-the-inspector)
10. [The `<nx-*>` widget catalog](#10-the-nx--widget-catalog)
11. [Fields: `FieldController` and codecs](#11-fields-fieldcontroller-and-codecs)
12. [Tag providers](#12-tag-providers)
13. [Lifecycle: versions and migrations](#13-lifecycle-versions-and-migrations)
14. [Testing with the testkit](#14-testing-with-the-testkit)
15. [Rules and limits](#15-rules-and-limits)
16. [How it works (for core maintainers)](#16-how-it-works-for-core-maintainers)

---

## 1. A component in one file

```js
// dist/gauge.js — an ES module
import { defineComponent, NexaElement, html, css, bind } from "../../nexa-sdk/nexa-component-sdk.js";

export default defineComponent({
    id: "acme-gauge",
    label: "Gauge", category: "Display", icon: "fa fa-tachometer",
    size: { w: 200, h: 120 },

    // 1. PROPERTIES: what the user configures (saved in the screen)
    properties: {
        max:      { type: "number", default: 100, min: 1, group: "Scale" },
        barColor: { type: "color",  default: "#16a34a", group: "Style" }
    },

    // 2. INPUTS (tags read) and 3. OUTPUTS (tags written)
    inputs:  { value:    { type: "number", label: "Value" } },
    outputs: { setpoint: { label: "Setpoint" } },

    //    EVENTS (fired to Logic) and ACTIONS (called from Logic)
    events:  { overMax: { label: "On Over Max", payload: { value: "number" } } },
    actions: { reset:   { label: "Reset peak" } },

    // 4. THE PROPERTY PANEL, written with <nx-*> widgets
    inspector: ({ p, ui }) => html`
        <nx-tabs>
            <nx-tab label="Data">
                <nx-tag ${bind("inputs.value")}></nx-tag>
                <nx-tag ${bind("outputs.setpoint")}></nx-tag>
            </nx-tab>
            <nx-tab label="Scale">
                <nx-number ${bind("max")}></nx-number>
                ${p.max > 1000 ? ui.alert("A very large scale", "warn") : ""}
            </nx-tab>
            <nx-tab label="Style">
                <nx-color ${bind("barColor")}></nx-color>
            </nx-tab>
        </nx-tabs>`,

    // 5. THE VIEW: a Lit component; event handling lives here
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

That is the whole component. You don't write a registry call, a custom element name, inspector jQuery or tag-parsing code.

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
| `states`, `parts`, `css` | object, object, string | [§8](#8-states-and-per-state-css) |
| `state` | object | Internal reactive fields of the view (`this.<name>`), not saved. |
| `inspector` | `({ p, ui, bind }) => TemplateResult` | [§9](#9-the-inspector). Optional; the default is an automatic panel. |
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
| `list` | array | `nx-list`. `item` is one schema (a list of values) or `{ fields: {…}, row: true }` (a list of objects). |

These attributes apply to every type:
- `default`, `label` (the key is humanized when omitted), `help`, `placeholder`, `icon`, `group`.
- `required`; `validate(value, p) → message | null`.
- `visibleWhen(p)` and `enabledWhen(p)`, used by the automatic panel.
- `perState: "<state>"`, shown only while that state is previewed.
- `bindable` (default `true` for plain values), `noReset`, `hidden`.

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

- An input or output is a **tag prop**. Its value is a generic tag reference, `"{provider:address}"`, for example `{sparkplug:Plant::Edge1::Mixer::Speed}`, `{opcua:ns=2;s=Motor.Speed}` or `{sql:plantdb/line1}`.
  - It is saved as `prop` when you give one (keep old names stable, e.g. `prop: "readTag"`), otherwise as `input<Name>` / `output<Name>`.
- In the view:
  - `this.in.value` is the live value, typed by `type` (`number`, `boolean`, `string`, `any`). It is `null` while unknown (offline, no data yet, "???") and an array for `multiple`.
  - `throttle: ms` delivers at most one change every `ms`; the last value always arrives.
  - `this.out.write("sp", v)` returns a Promise. It resolves `{ local: true }` when no tag is bound (a local-only component) and in the editor.
  - `this.out.canWrite("sp")` and `this.out.target("sp")` tell you where a write would go.
  - `this.status("value")` returns `{ bound, unknown, provider, providerLabel, address, display, valid }`.
- `providers` limits which tag providers the picker offers for that input or output.
- A template parameter `{name}` is accepted wherever a tag is.
- In the inspector, `bind("inputs.value")` / `bind("outputs.sp")` binds the tag picker.

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

## 8. States and per-state CSS

```js
css: "button { border-radius: 4px; }",
states: {
    false: { label: "State 0", selector: "button.state-false", css: "",                   color: "#94a3b8" },
    true:  { label: "State 1", selector: "button.state-true",  css: "background: green;", color: "#22c55e" },
    hover: { label: "Hover",   selector: "button:hover",       css: "filter: brightness(.95)", preview: false }
}
```

- `css` becomes the `css` prop (the base stylesheet, editable in the panel).
- **Parts** are pieces of the view with their own CSS, a label or a helper line for example:
  `parts: { label: { label: "Field label", selector: ".x-label", css: "font-weight: 600;" } }`
  gives a `cssLabel` prop that works like a state's (declarations wrapped in the selector) and is always applied.
  The stylesheet order is base, parts, then states, so a state can still restyle a part.
- Each state with a `selector` gets a `css<State>` prop (`cssTrue`, `cssHover` …). The user writes declarations, and the SDK wraps them in the selector, or uses the block as-is when it contains `{`.
- The result is injected into the component's shadow root, base first.
- States with `preview !== false` appear in the inspector's preview switcher (`ui.stateSwitcher()`). The view reads `this.previewState` to show that state in the editor.

---

## 9. The inspector

Write the panel with `<nx-*>` widgets and `bind()`:

```js
inspector: ({ p, ui }) => html`
    <nx-tabs persist-key="acme-gauge">
        <nx-tab label="Data" icon="fa fa-exchange">
            <nx-section heading="Tags">
                <nx-tag ${bind("inputs.value")}></nx-tag>
            </nx-section>
        </nx-tab>
        <nx-tab label="Style">
            ${ui.stateSwitcher()}
            <nx-row>
                <nx-number ${bind("min")}></nx-number>
                <nx-number ${bind("max")}></nx-number>
            </nx-row>
            ${p.showAdvanced ? html`<nx-code ${bind("css")}></nx-code>` : ""}
        </nx-tab>
    </nx-tabs>`
```

- **`bind(key)`** connects a widget to a property (`"inputs.x"` / `"outputs.x"` for tags). The widget gets:
  - the value;
  - the property's label, help, placeholder, limits, options, access and providers, **unless you wrote that attribute yourself**;
  - validation messages;
  - a modified dot, a reset button and, for plain values, the **⛓ bind button**, which switches the same widget to a tag / parameter binding.

  Changes are applied live with undo, and consecutive edits of one field are one undo step.
- **`p`** holds the current props. Show or hide parts with ordinary template logic.
- **`ui`** helpers:
  - `ui.stateSwitcher()`: the preview-state chips.
  - `ui.field(key)`: the widget the automatic panel would use.
  - `ui.alert(text, tone)`, `ui.badge(text, tone)`.
  - `ui.async(cacheKey, loader)`: loads options once, returning `[]` until they arrive, e.g. `.options=${ui.async("units", fetchUnits)}`.
  - `ui.dialog({ title, content, buttons })`: returns a Promise of the clicked button's value.
  - `ui.action(label, fn)`, `ui.refresh()`.
- **No `inspector`?** The panel is generated from `properties`, grouped by `group`: sections for up to two groups, tabs beyond that. The automatic panel honours `visibleWhen`, `enabledWhen` and `perState`.
- **Custom inspector widgets:**

  ```js
  import { defineInspectorWidget } from "../../nexa-sdk/nexa-component-sdk.js";
  defineInspectorWidget("acme-curve-editor", ({ KitElement, html }) => class extends KitElement {
      render() { return this.frame(html`…`); }   // same contract: .value + this.change(v)
  });
  ```

  Use it like any widget: `<acme-curve-editor ${bind("curve")}></acme-curve-editor>`. It is defined only in the editor.
- **Never** style the panel yourself (no inline styles, no own CSS). The `<nx-*>` widgets are the look.

---

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
    await js('NexaTest.settle()');
    const text = await js('NexaTest.wc("g").renderRoot.textContent');
    // NexaTest.item("g").writes / .events, NexaTest.ack("g", true | false), NexaTest.invoke("g", "reset"),
    // NexaTest.inspector("acme-gauge", props, host) -> { box, props, sets, destroy }, { design: true } mounts in editor mode
});
```

The harness loads the registry, the SDK, the property kit and your modules in headless Chrome (set `CHROME_PATH` if it is not found). Typing uses real keyboard events (`type`, `key`). Build the dashboard first (`npm run build`).

---

## 15. Rules and limits

- A view renders **only inside its own element**. It doesn't reach into the canvas, other components or `window.RED`.
- Props, event payloads and action params are **JSON-serializable**.
- Writes go **only** through `this.out.write()` to declared outputs; components don't open their own connections to devices.
- Codecs, validators and tag-provider `parse` / `format` are **pure and synchronous**.
- The inspector uses **only `<nx-*>` widgets** (and your `defineInspectorWidget` widgets), with no own styling.
- Stored prop names are a compatibility promise: rename them only with a migration.
- `NEXA.registerComponent(id, def)` (the pre-SDK contract, README §11) still works but is **legacy**.

---

## 16. How it works (for core maintainers)

**Source layout.** The source lives in `src/sdk/`, and `build.js` produces three browser files:
- `dist/nexa-sdk.bundle.js`: Lit, the registry and the SDK runtime (`defineComponent`, `NexaElement`, `FieldController`, codecs, tags, `bind`). It is loaded by the editor (`/nexa-dashboard/_sdk.js`) and by deployed pages (`/nexa/_sdk.js`).
- `dist/nexa-sdk-kit.bundle.js`: the property kit (`<nx-*>` widgets and the inspector renderer). Editor only. It uses the SDK's Lit and waits for it if loaded first.
- `lib/nexa-registry-client.js`: the deployed page's registry, generated from the same `src/sdk/registry.js` the editor bundles.

**Facade.** `sdk/nexa-component-sdk.js` is served at `<root>/nexa-sdk/` on httpAdmin and httpNode.

**Hosts.**
- The editor passes `ctx.mode = "editor"` and `getRawProps()`.
- The runtime passes `ctx.mode = "runtime"`, `getRawProps()` and `writeTag(propKey, value)`, which is generic: Sparkplug goes through the existing write path, and other providers through `write()`.
- Both resolve `{sparkplug:…}` in string and array props, index `multiple` inputs for live re-render, run `migrateProps`, and re-render components whose plugin registered late.
- The runtime also routes `msg.action` of an *Update Component* node to `def.invoke()`.

**Editor inspector.** `src/sidebar/kit-inspector.js` hands `def.nexa` to `NexaKit.renderInspector`. Changes become `props` history events, and the same field within 1.5 s is merged into one undo step.

**Tests.**
- `test/sdk-schema.test.js`, `test/sdk-format.test.js`: Node.
- `test/sdk-kit-browser.test.js`: Chrome, against `test/fixtures/sdk-plugin`.
- Each plugin's `test/browser.test.js`.
- `test/fixtures/legacy-buttons-components.js` keeps proving that a legacy plugin still works.
