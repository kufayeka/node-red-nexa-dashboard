# The Lit Component Node — Complete Guide

This is the deep-dive companion to [README.md §9](../README.md#9-the-lit-component-node).
That section covers the basics (authoring UI, the compile/cache model, why Lit loads as
a separate script); this document is the practical "how do I actually build things with
it" reference — internal functions, internal state, conditional rendering, loops,
embedding an already-made Screen Template, and a set of full worked use cases.

Everything here describes the **actual current implementation**, verified against the
source in this package (`src/canvas/component-renderer.js` for the editor,
`lib/nexa-runtime-client.js` for deployed pages — the two are kept in lockstep by hand).
Anything not yet supported is called out explicitly under [§9](#9-what-doesnt-work-yet)
rather than described as if it already worked.

---

## Table of Contents

1. [The mental model](#1-the-mental-model)
2. [Defining internal functions (methods)](#2-defining-internal-functions-methods)
3. [Internal variables — reactive state vs. plain fields](#3-internal-variables--reactive-state-vs-plain-fields)
4. [Conditional rendering](#4-conditional-rendering)
5. [Loops — rendering lists](#5-loops--rendering-lists)
6. [Handling your own markup's events](#6-handling-your-own-markups-events)
7. [Fetching/loading data asynchronously](#7-fetchingloading-data-asynchronously)
8. [Embedding an already-made Screen Template — `this.mountTemplate(...)`](#8-embedding-an-already-made-screen-template--thismounttemplate)
9. [What doesn't work yet](#9-what-doesnt-work-yet)
10. [Full worked use cases](#10-full-worked-use-cases)
11. [Debugging checklist](#11-debugging-checklist)

---

## 1. The mental model

What you type into the **"Class body"** code editor (Properties panel → **"Edit Code..."**,
after dropping a **Lit Component** — opens a dialog, the same pattern as the Function
node's own code editor) becomes the INSIDE of a class:

```js
class extends NexaLitBase {
  // <-- your "Class body" text goes here -->
}
```

`NexaLitBase` is a thin wrapper around the real `LitElement` that adds two methods for
free: `this.emit(name, payload)` and `this.mountTemplate(...)` (§8). Everything else is
**plain, standard Lit** — no custom templating language, no restrictions beyond "this runs
inside a real `LitElement` subclass." If you already know Lit, everything in this guide
will feel familiar; if you don't, every section below is self-contained.

Three things are auto-generated for you and should **not** be written by hand in your
class body:
- `static properties = {...}` — generated from the **Bindable Properties** list in the
  Properties panel (see §3).
- `static styles = css\`...\`;` — generated from the **CSS** field.
- The custom element registration itself (`customElements.define(...)`) and its
  auto-generated tag name.

You always have exactly one required piece: a `render()` method returning an `html`
template. `html`, `css`, and `nothing` are available as bare identifiers inside your code
— you don't need to import or declare them.

---

## 2. Defining internal functions (methods)

Any class body can have as many methods as you like — just write them as normal
JavaScript methods, one after another. Call them from `render()`, from each other, or
from event handlers:

```js
render() {
  return html`
    <div>Total: ${this._formatCurrency(this.amount)}</div>
    <button @click=${this._handleReset}>Reset</button>
  `;
}

_formatCurrency(value) {
  return "$" + Number(value || 0).toFixed(2);
}

_handleReset() {
  this.amount = 0;
  this.emit("reset", {});
}

// A standard Lit lifecycle hook — also just a method
firstUpdated() {
  console.log("mounted with amount =", this.amount);
}
```

A leading underscore for "private-ish" helper methods (`_formatCurrency`) is a common Lit
convention, not a requirement — it's just a naming signal that a method isn't part of the
component's declared public surface (Bindable Properties / Events).

You can also define a `constructor()` if you need to run setup logic once, per instance —
just remember to call `super()` first, exactly like any JS subclass:

```js
constructor() {
  super();
  this._startedAt = Date.now();
}
```

---

## 3. Internal variables — reactive state vs. plain fields

There are two different things people usually mean by "internal variable," and they need
different handling in Lit:

### 3.1 Reactive state (changing it should re-render the component)

**The simplest and safest way: declare it as a Bindable Property too**, even if you never
intend to wire anything to it from the Logic canvas. Properties panel → Bindable
Properties → **"+ add"** → give it a name (e.g. `isOpen`) and set its Value field's
typedInput type to `bool`. This makes `this.isOpen` a real Lit reactive property —
assigning to it automatically schedules a re-render, no extra code needed:

```js
render() {
  return html`
    <button @click=${() => { this.isOpen = !this.isOpen; }}>Toggle</button>
    ${this.isOpen ? html`<div class="panel">Panel content</div>` : nothing}
  `;
}
```

**Do not write `static properties = {...}` yourself in the class body** — the Bindable
Properties list already generates one, placed BEFORE your own code. If you also declare
`static properties` in your own code, JavaScript's class-field semantics mean **yours
silently wins** (fields with the same name overwrite in declaration order), which erases
every Bindable Property you configured through the UI. If you need a reactive field you
don't want to expose as bindable, adding it to the Bindable Properties list anyway (and
simply never wiring a Logic node to it) is the supported way to get one — it costs
nothing to declare an "internal" one there.

### 3.2 Plain, non-reactive instance variables

For a value that doesn't need to trigger a re-render by itself (a cached computation, a
timer handle, a flag read only inside your own methods) — a normal instance field is
fine, set in the constructor or lazily:

```js
constructor() {
  super();
  this._intervalHandle = null;
}

connectedCallback() {
  super.connectedCallback();
  this._intervalHandle = setInterval(() => this._tick(), 1000);
}

disconnectedCallback() {
  super.disconnectedCallback();
  clearInterval(this._intervalHandle);
}
```

If a plain field's value DOES need to show up in `render()`, either promote it to a
Bindable Property (§3.1), or call `this.requestUpdate()` (a real method your component
inherits from `LitElement`) right after changing it — both work, the Bindable Property
route is simpler for most cases.

---

## 4. Conditional rendering

Standard JavaScript inside a template expression — no special directive needed for the
common case:

```js
render() {
  return html`
    ${this.status === "ok"
      ? html`<div class="ok">All good</div>`
      : html`<div class="error">Problem detected</div>`}
  `;
}
```

To render **nothing** (cleanly remove content, not just an empty string), use the `nothing`
sentinel — available as a bare identifier, same as `html`/`css`:

```js
render() {
  return html`
    <div>Value: ${this.value}</div>
    ${this.showHint ? html`<small>Hint text</small>` : nothing}
  `;
}
```

Multiple conditions read naturally as chained ternaries or a small helper method (§2):

```js
_statusLabel() {
  if (this.level > 90) return "Critical";
  if (this.level > 60) return "Warning";
  return "Normal";
}

render() {
  return html`<div class="status">${this._statusLabel()}</div>`;
}
```

---

## 5. Loops — rendering lists

Declare an `array`-typed Bindable Property (e.g. `items`), then `.map()` it inside
`render()` — this is the exact mechanism behind the "render N cards/rows from an array"
use case:

```js
render() {
  return html`
    <ul>
      ${(this.items || []).map(item => html`
        <li>${item.name} — ${item.value}</li>
      `)}
    </ul>
  `;
}
```

A real table:

```js
render() {
  return html`
    <table>
      <thead><tr><th>Asset</th><th>Status</th></tr></thead>
      <tbody>
        ${(this.rows || []).map(row => html`
          <tr>
            <td>${row.name}</td>
            <td class="${row.ok ? 'ok' : 'bad'}">${row.ok ? 'OK' : 'FAULT'}</td>
          </tr>
        `)}
      </tbody>
    </table>
  `;
}
```

`(this.items || [])` guards against the property being `undefined` before its first
value arrives (e.g. before a `set-template-param`/`ui-update` node has fired yet) — always
default-guard an array-typed Bindable Property this way.

---

## 6. Handling your own markup's events

Use Lit's `@eventname=${handler}` binding syntax directly in your template — this is
standard `lit-html`, not a Nexa-specific mechanism:

```js
render() {
  return html`
    <input @input=${this._onInput} .value=${this.text} />
    <button @click=${this._onSave}>Save</button>
  `;
}

_onInput(e) {
  this.text = e.target.value;
}

_onSave() {
  this.emit("save", { text: this.text });
}
```

`.value=${...}` (a leading dot) binds a JS **property** rather than an HTML attribute —
the standard Lit convention for form-control values.

---

## 7. Fetching/loading data asynchronously

`render()` itself must stay synchronous (it returns a template, not a Promise) — do async
work in a lifecycle hook instead, then assign the result to a Bindable Property so the
normal reactive re-render picks it up:

```js
async firstUpdated() {
  const res = await fetch("/some/endpoint");
  this.data = await res.json();   // "data" is a declared Bindable Property (type: object/array)
}

render() {
  return html`<div>${this.data ? this.data.value : "Loading..."}</div>`;
}
```

`firstUpdated()` runs once, after the component's first render — the right place for a
one-time initial fetch. For data that should refresh, prefer feeding it from the Logic
canvas instead (an `inject` node → Function node → this component's **"→ Update"** node,
per README §6/§7) — that keeps the data flow visible in the Logic graph rather than
hidden inside component code, and is the officially supported "live data" pattern for
Bindable Properties.

---

## 8. Embedding an already-made Screen Template — `this.mountTemplate(...)`

This is how you reuse a Template (README §8) — an already-designed multi-component
layout with its own declared params — from **inside** your own Lit Component's code,
rather than only being able to drop a Template as its own separate instance on the
canvas. The classic motivating use case: *"loop an array of assets and render one copy of
my 'Monitor Card' Template per item, each showing that item's own data."*

### 8.1 API

```
this.mountTemplate(hostEl, templateIdOrName, paramValues, opts)
```

| Param | Type | Meaning |
| --- | --- | --- |
| `hostEl` | `Element` | Where to mount it — an element from YOUR OWN template, found via `this.shadowRoot` (see below) |
| `templateIdOrName` | `string` | The Template's id, `name`, **or** `identifier` (whichever is easiest to find/remember — set a Template's Identifier field in its settings form specifically so you have a stable, human-readable name to reference here) |
| `paramValues` | `object` | Plain object, keyed by the Template's declared param names — exactly what you'd type into a dropped instance's Properties panel fields |
| `opts` | `object` (optional) | `{ width, height, key }` — `width`/`height` override the Template's own intrinsic size (default: rendered 1:1, no scaling); `key` disambiguates multiple mounts from the same Lit instance (**required** when calling it in a loop — see §8.3) |

**Call it from `updated()` or `firstUpdated()`, never from `render()`.** `render()` must
stay a pure, synchronous "return a template" function — `mountTemplate` does real,
imperative DOM manipulation (clearing and rebuilding a subtree), which has to happen
*after* Lit has finished applying your own `render()` output to the shadow DOM:

```js
render() {
  return html`<div id="card-slot"></div>`;
}

firstUpdated() {
  const slot = this.shadowRoot.getElementById("card-slot");
  this.mountTemplate(slot, "monitor-card", { assetName: this.assetName, value: this.value });
}
```

### 8.2 Passing data in

`paramValues` works exactly like a normally-dropped `@template` instance's Properties
panel fields — plain values, or (if you want the embedded template's OWN nested
instances to declaratively bind further down, per README §8.5) a `{path}` string is
resolved the same way. Re-call `mountTemplate` whenever the data changes and you want the
embedded template to reflect it — it fully re-renders the embed's subtree each call
(simple and always-correct, not a surgical diff):

```js
updated(changedProps) {
  if (changedProps.has("value")) {
    const slot = this.shadowRoot.getElementById("card-slot");
    this.mountTemplate(slot, "monitor-card", { assetName: this.assetName, value: this.value });
  }
}
```

Checking `changedProps.has(...)` (a real Lit API — `updated()` receives a `Map` of what
changed) avoids needlessly tearing down and rebuilding the embed on every unrelated
property change, which would otherwise cause visible flicker.

### 8.3 Looping — mount one Template instance per array item

This is the repeater use case. Give each mounted copy a unique `opts.key` (its own
container element, and a distinct `key` so their namespaces never collide):

```js
render() {
  return html`<div id="list"></div>`;
}

updated(changedProps) {
  if (!changedProps.has("items")) return;
  const list = this.shadowRoot.getElementById("list");
  list.innerHTML = "";
  (this.items || []).forEach(item => {
    const container = document.createElement("div");
    container.style.marginBottom = "8px";
    list.appendChild(container);
    this.mountTemplate(container, "monitor-card", { assetName: item.name, value: item.value }, { key: item.id });
  });
}
```

`items` would be an `array`-typed Bindable Property, fed from a Logic Function node
(e.g. one that calls an Asset Engine multi-read and builds an array of `{id, name,
value}` objects) via this component's **"→ Update"** node, exactly as in §7.

### 8.4 Nested templates inside the embedded template

If the Template you're embedding itself contains a further nested `@template` instance
(README §8.6), that nesting resolves normally — `mountTemplate` reuses the same recursive
mounting code a normally-dropped instance uses, just entered from a different starting
point. You don't need to do anything extra for this to work.

### 8.5 What this does NOT do (see §9 for the full picture)

`mountTemplate` is **visual-only**: it renders the embedded template's component tree
with its params correctly interpolated, but it does **not** fold the embedded template's
own Logic graph into execution — an `onload`/`ui-event`/`param-input`/`inject` node
authored on that Template's own Logic canvas will **not** run when reached this way. If
the Template you want to embed genuinely needs its own Logic to execute, drop it normally
via the palette (a static `@template` instance) instead of embedding it from code.

---

## 9. What doesn't work yet

Documented honestly, matching this package's overall convention (README §13):

- **`mountTemplate`'s embedded copies don't run their own Logic graph** (§8.5) — visual
  + params only, by design, for the reasons explained there (it mounts dynamically, after
  the screen's one-time Logic-wiring pass has already completed).
- **No visual code-completion/type-checking for `html`/`css`/`nothing`** beyond whatever
  the code editor widget (`RED.editor.createEditor`) provides generically for JavaScript —
  there's no Lit-specific IntelliSense.
- **Real Shadow-DOM rendering hasn't been verified against a real browser DOM in this
  package's own automated test suite** (no `jsdom` in this environment) — the mount/
  compile/cache/`mountTemplate` wiring itself is tested with a stand-in fake `LitElement`
  base; boot-test any non-trivial Lit Component by hand before relying on it in
  production.
- **A `@lit-component`'s Bindable Properties don't support the `{path}` declarative
  binding syntax** that a `@template` instance's own params support (README §8.5) — a
  Lit Component's props are only ever set via a static default, a `ui-update`/
  `set-template-param` Logic node's `msg.properties`, or your own code (§7/§8).

---

## 10. Full worked use cases

### Use case A — Toggle switch (internal state + conditional rendering + emit)

**Bindable Properties:** none required (purely internal state, still declared as a
Bindable Property per §3.1 so it's reactive) → add `on` (type `boolean`, default `false`).
**Events:** add `toggled`.

```js
render() {
  return html`
    <button @click=${this._toggle} style="padding:8px 16px; border-radius:4px; border:none; cursor:pointer;
      background:${this.on ? '#4caf50' : '#9e9e9e'}; color:white;">
      ${this.on ? "ON" : "OFF"}
    </button>
  `;
}

_toggle() {
  this.on = !this.on;
  this.emit("toggled", { on: this.on });
}
```

### Use case B — Status badge (conditional styling from a bindable prop)

**Bindable Properties:** `level` (type `number`, default `0`).
**CSS:**
```css
:host { display: inline-block; font-family: sans-serif; }
```

```js
_color() {
  if (this.level > 90) return "#d32f2f";
  if (this.level > 60) return "#f9a825";
  return "#388e3c";
}

render() {
  return html`
    <span style="padding:4px 10px; border-radius:12px; color:white; background:${this._color()};">
      ${this.level}%
    </span>
  `;
}
```
Feed `level` from a Function node reading an Asset Engine tag, wired into this
component's **"→ Update"** node (`msg.properties = { level: yourValue };`).

### Use case C — Data table from an array (loop, no Templates involved)

**Bindable Properties:** `rows` (type `array`, default `[]`).

```js
render() {
  return html`
    <table style="width:100%; border-collapse:collapse;">
      <thead><tr><th>Asset</th><th>Value</th></tr></thead>
      <tbody>
        ${(this.rows || []).map(r => html`
          <tr><td>${r.name}</td><td>${r.value}</td></tr>
        `)}
      </tbody>
    </table>
  `;
}
```
Feed `rows` via `msg.properties = { rows: [...] };` from a Function node — e.g. one
built from a `kufayeka-asset-multi-read` node's result.

### Use case D — Monitoring dashboard: N Template cards from an array (`mountTemplate` loop)

Combines §8.3 with a real Template. Assumes a Template named/identified `monitor-card`
already exists (README §8.1–§8.3), declaring params `assetName` (string) and `value`
(number).

**Bindable Properties:** `assets` (type `array`, default `[]`).

```js
render() {
  return html`<div id="cards" style="display:flex; gap:8px; flex-wrap:wrap;"></div>`;
}

updated(changedProps) {
  if (!changedProps.has("assets")) return;
  const container = this.shadowRoot.getElementById("cards");
  container.innerHTML = "";
  (this.assets || []).forEach(asset => {
    const slot = document.createElement("div");
    container.appendChild(slot);
    this.mountTemplate(slot, "monitor-card", { assetName: asset.name, value: asset.value }, { key: asset.id });
  });
}
```
Feed `assets` from a Function node building `[{id, name, value}, ...]` from an Asset
Engine multi-read, wired into this component's **"→ Update"** node.

### Use case E — Live counter (internal reactive state, no external wiring at all)

**Bindable Properties:** `count` (type `number`, default `0`) — internal-only, per §3.1.

```js
connectedCallback() {
  super.connectedCallback();
  this._timer = setInterval(() => { this.count = this.count + 1; }, 1000);
}

disconnectedCallback() {
  super.disconnectedCallback();
  clearInterval(this._timer);
}

render() {
  return html`<div>Uptime: ${this.count}s</div>`;
}
```
Demonstrates that a Lit Component doesn't need any Logic-canvas wiring at all if its
state is fully self-contained — the same `connectedCallback`/`disconnectedCallback`
pair from §3.2, combined with a Bindable Property for the reactive display.

---

## 11. Debugging checklist

- **`TypeError: Cannot set properties of undefined`** from a Function node feeding this
  component's **"→ Update"** node — you're mutating `msg.properties.xxx` before
  `msg.properties` exists. Assign the whole object: `msg.properties = { xxx: value };`
  (README §6/§7 has the full explanation).
- **A Bindable Property never updates even though the Update node clearly fires** — check
  you didn't accidentally redeclare `static properties` in your own class body (§3.1);
  it silently wins over the auto-generated one and erases every declared Bindable
  Property's reactivity.
- **"Lit compile error: ..." shown where your component should render** — a JavaScript
  syntax error in your class body (missing `}`, unterminated template literal inside
  `html\`...\``, etc.) — the exact error message is the same one your browser's console
  would show for the equivalent `new Function(...)` call.
- **Editing the code doesn't seem to take effect** — the code editor lives in a modal
  dialog (Properties panel → **"Edit Code..."**), not inline in the sidebar; did you
  click **"Done"** (not "Cancel", and not just closed the dialog some other way)? Only
  "Done" reads the editors and commits `litCode`/`litStyles`.
- **`mountTemplate` shows "(mountTemplate: unknown template ...)"** — check the
  `templateIdOrName` you passed matches the Template's `name` or `identifier` field
  exactly (case-sensitive), or use its raw id instead.
- **Hard-refresh before assuming a fix didn't take** — `_lit-vendor.js`/`_runtime.js` on a
  deployed page have no cache-busting query string (README §13).
- **A boolean Bindable Property renders as "always true" no matter what default you set**
  — this was a real, fixed bug from an earlier UI: a separate type dropdown let a prop's
  `defaultValue` get left as a leftover string like `"false"` after switching its type —
  and `Boolean("false")` is TRUTHY in plain JS. The current Bindable Properties list has
  no separate type dropdown at all — the type is *derived* from the Value field's own
  typedInput selection every time it changes, so type and value can no longer drift apart.
  The runtime still defensively coerces every value to its declared type regardless (see
  `coerceLitBindableValue`), which also protects any data saved before this UI existed —
  if you still see this on current code, that coercion path is the first place to check.
