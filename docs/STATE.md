# Variables and app state

How a live page keeps and shares data. It covers variables in a lexical
scope chain, global app state, the Logic nodes that read, change and watch
state, the Web & data nodes (HTTP Request, Storage, Cookie), and the
Function node API.

## 1. Where variables live

```
$route                  the page URL: params (:id in the screen path), query (?a=1), path, hash
 └ App                  variables every screen shares (the project) — global state
    └ Screen            this screen's variables
       └ Group / Frame  a container's variables (for what is inside it)
          └ the node    binds {name}: the NEAREST declaration going outwards wins
```

| Where | Declared in | Lives |
| --- | --- | --- |
| **App** | Screens tab → "App variables (every screen)" | The page. With **Kept for**: *tab session* (sessionStorage) or *browser* (localStorage), across pages and reloads. |
| **Screen** | Screens tab → "Variables" | The page. |
| **Group / Frame** | Properties → "Variables" | The page. |
| **Template** | Templates tab → "Parameters" and "Variables" (the same block as a screen's, types / UDT included) | Each instance / copy. |

- **Template boundary.** Inside an instance you see the app and the
  template's own params and variables, not the screen around the instance.
  Values cross through the instance's paramValues (e.g. `who = {label}`),
  which are passed again when that variable changes.
- **Variable shape:** `{ id, name, type, defaultValue, persist? }`, with
  types string / number / boolean / object / array / color. `persist`
  applies to app variables only.

## 2. Binding

Anywhere in a component's props, and in the text fields of the Web & data
nodes:

| Binding | Meaning |
| --- | --- |
| `{name}` | The variable's value. The binding picker lists what is in scope, nearest first. |
| `{name.a.b}`, `{list[0].x}` | A path into an object or array. |
| `{$route.params.id}` | `:id` of the screen path (`/orders/:id`). |
| `{$route.query.tab}` | `?tab=…`. |
| `{$route.path}` | The page path. |
| `{msg.payload.id}` | The message; only in HTTP Request / Storage / Cookie text fields. |

A value that is exactly one binding keeps its type (a whole object or
array). A binding inside more text becomes text. A name that can't be
resolved stays as written.

## 2b. Choosing where a prop's value comes from (⛓)

Every prop of a component can be bound; a plugin can opt a prop out with
`bindable: false`. Click ⛓ next to a field and pick the **source**:

| Source | Writes | Updates when |
| --- | --- | --- |
| **Variable** | `{speed}`, `{motor.speed}`: the nearest declaration, from frame to screen to app | the variable changes |
| **Tag** | `{sparkplug:G::N::D::Speed}` | a live value arrives |
| **Message** | `{msg.payload.speed}` | a Logic flow sends a message to the component (an **Update Component** node) |
| **Expression** | text mixing any of them: `Line {line}: {sparkplug:G::N::D::Speed} rpm, order {msg.payload.id}` | any part changes; a tag inside the text updates live too |

- **The source comes from the value itself.** The editor shows a preview of
  the result and warns about names that aren't declared around the node.
- **"Insert a binding…"** puts a variable, `msg.payload` or a known tag at
  the caret.
- **Message:** the component keeps the last message it was sent. A
  `{msg.*}` binding reads from that message, and shows as empty until one
  arrives.
- **The Update Component node** lists the props that take their value from
  the message (the list follows the component's bindings, it isn't fixed).
  For such a component, nothing is guessed from `msg.payload` and those props
  are never overwritten.
- **One value, many components:** use a variable. The flow does
  **Set Variable** once, and every component binds `{name}`.

**Writing (fields, buttons, knobs…):** a component's write target (its
"Write Tag", or its read binding when that is left empty) can be:
- a **tag**;
- a **variable** (`{speed}`, or a path into one, `{cfg.limit}`), set on the
  scope that declares it, so watchers fire;
- a **URL query parameter** (`{$route.query.status}`). The address bar
  updates without a reload, and whatever binds it re-renders.

The message, `$route.params`, `$route.path` and text expressions are
read-only. A field bound to `{speed}` with no write target writes `{speed}`
back: a two-way binding. Writes never fire component events.

## 3. Changing and watching (Logic)

| Node | Does |
| --- | --- |
| **Set Variable** | Changes a variable: **set**, **merge** (object), **append** / **remove** (array item or object key), **toggle** (boolean), **increment** (a number, or 1). The value comes from `msg.payload`, a msg property or a fixed value. The msg goes on. |
| **Get Variable** | Puts a variable's value into a msg property. |
| **On Variable Change** | Starts a flow when a variable really changes, from any source. `msg.payload` = new value, `msg.previous` = old value, `msg.variable` = the name. |

A variable is chosen by scope (App, this screen / template, or the group /
frame that declares it) and name. The Events tab has **Set …** and
**On change …** chips per variable.

## 4. Web & data nodes

| Node | Does |
| --- | --- |
| **HTTP Request** | See below. |
| **Storage** | local / session storage: get (into a msg property), set (payload or a fixed value) or remove a key. JSON values; the key takes bindings. |
| **Cookie** | get / set / remove, with days, path, SameSite and Secure. Cookies set from the page are not HttpOnly. A server's HttpOnly cookie is still sent with HTTP Request calls. |

**HTTP Request** in detail:
- **Request:** method and URL; headers as JSON, whose values take bindings;
  a body from `msg.payload` (JSON); a timeout; and a cookies setting.
  `msg.url`, `msg.method` and `msg.headers` override the node's own.
- **Response:** `msg.payload` gets the parsed JSON or text. Also set are
  `msg.statusCode`, `msg.ok` and `msg.headers`, plus `msg.error` on a
  non-2xx status, network error or timeout.
- **Timing:** it is async; the wire continues when the response is in.

## 4b. Lists: the repeater (Populate + Layout)

**Populate** (Events tab → Lists) repeats a **template**, one copy per item of
an array. The array comes from `msg.payload`, a msg property, or a fixed
list. The copies go into the frame(s) of the **Layout** node(s) it is wired
to.

**The Layout node.** Every frame of the screen (Row, Column, Grid) is listed
in the Events tab under **"Layouts on this screen"**, by name, id and kind,
so two Rows are told apart. Select a frame on the canvas and its chip lights
up; drag it into the Logic canvas.

```
[button: click] → [Function: msg.payload = {id, …}] → [Populate: Template 1 → param1, append] ─┬→ [Layout: Column #a928]
                                                                                               └→ [Layout: Grid #07fd]
```

- Wired to several Layout nodes, one Populate fills each with the same data;
  each frame keeps its own list.
- A frame's own children (e.g. a header) stay first.

**Modes:**

| Mode | Does |
| --- | --- |
| **replace** | The list becomes the items, by key: a copy whose key is still there is kept (and updated), a new one is added, a gone one is removed, then all are ordered as given. Use it for "show these", e.g. a product's images. |
| **append** / **prepend** | Always adds copies at the end / start, even for an item already there. |
| **update by key** | Updates a copy in place (not re-created), or adds it when new. |
| **remove by key** | Removes copies. |
| **clear** | Removes all copies. |

**The key** of an item:

- An object: its key field (Key = `id`: `{id: 7, …}` is 7). Objects without it are all new on each replace.
- A string or a number, e.g. an image URL from `product.images`: **the value itself**. The same URL keeps its copy, and the same value twice gives two copies.

**Populate → Populate → Layout**: a Populate without a frame of its own passes what it does on (`msg.populate`); the next Populate adds its own. The Layout node runs both, in order. Clear → Append, for example, empties the frame and then fills it. Replace alone does the same in one node.

```
[Param Input] → [Function: msg.payload = vars.get("param1").images] → [Populate: Slide → param1, replace] → [Layout: Carousel]
```

**The template declares a param** (Templates tab → Parameters, e.g.
`product`). Populate chooses the param each item goes into; inside, bind
`{product.name}`, and `{index}` for the position. The item is also
available as `{item}` / `msg.item`.
- **The template's own Logic runs per copy**, like a React component. For
  example, `[button: click] → [HTTP Request POST /api/order/{product.id}, body {product}]`.
- **Events from inside a copy** carry `msg.item` and `msg.index`.
- **"Each copy fills the frame's width"** makes list / table rows.
- **Send to Host** (inside a template, Events → Template) sends a message out
  of the template, to where it is used: to open a dialog or a popup, or to
  delete an item. Give each output a name (`msg.output`, e.g. `open-dialog`).
  - A copy a Populate made: the message comes out of the **Layout** node that
    holds it, with `msg.item` and `msg.index`. That is the Layout node's
    output; it no longer passes the Populate message on.
  - An instance placed on a screen: its **On Template Output** node there
    (Events → Components → "Instance … → on open-dialog"), for one output or
    for any.
  ```
  inside ProductCard:   [Buy: click] → [Send to Host: open-dialog]
  on the screen:        [Populate] → [Layout: Column] → [Function: msg.item → the dialog] → …
  ```
- **"Virtualize"** is for thousands to hundreds of thousands of items. Every
  item is kept, but only the copies in (or near) the frame's scrolled view
  exist, about a screenful plus 3 lines each side. Scrolling mounts what
  comes into view and unmounts what leaves it. 100 000 items populate in
  about 0.4 s, with about a dozen copies in the DOM.
  - The frame scrolls along its layout (a column vertically, a row
    horizontally, a grid by rows), even if its Scroll is off.
  - Every copy has the template's size (with "fills", the column's width).
  - A copy's own variables reset when it scrolls out: keep such state in the
    item or in a screen / app variable.
  - A browser caps an element at about 33 million px, so at 44 px a line
    that is about 750 000 lines.
- **Reading a param in the template's Logic:** `{product.id}` in a node's
  text field (e.g. an HTTP URL), Get Variable → scope "Template" → `product`,
  `getVariable("product")` in a Function, or "On Params Change"
  (`msg.payload.product`).

## 5. The Function node API

```js
vars.get("filter")                 // nearest declaration, up to the app
vars.get("user", "@app")           // explicit scope: "@app", "" (the screen) or a group / frame id
vars.set("filter", "open")         // on the scope that declares it (watchers fire)
vars.update("cart", "append", item)   // merge / append / remove / toggle / increment
getVariable("speed"); getVariable("user", "@app")      // the same as vars.get
setVariable("speed", 10); setVariable("cart", item, "@app", "append")   // vars.set, with an optional op
route.params.id; route.query.tab; route.path
storage.local.get("prefs"); storage.local.set("prefs", {...}); storage.session.remove("k")
cookies.get("session"); cookies.set("session", token, { days: 7 }); cookies.remove("session")
const r = await http.get("/api/orders");   // { ok, status, data, headers } — JSON in / out; post / put / patch / delete too
```

## 6. How it works

- **Scopes are plain objects** whose prototype is the enclosing scope
  (`src/model/scope.js`), so `scope[name]` walks the whole chain.
- **One write path.** `writeVariable` in `lib/nexa-runtime-client.js` sets
  the value on the declaring scope, re-renders what sees it, persists, and
  notifies watchers.
- **App variables** travel on the project config node (`variables`) to the
  page as `window.__NEXA_APP__`, and persist under `nexa:app:<name>`.

Tests:

| Test | Covers |
| --- | --- |
| `test/runtime-state-browser.test.js` | the state core and the Web & data nodes |
| `test/runtime-virtual-browser.test.js` | the virtual list: 100 000 items in a column, a grid and a row |
| `test/runtime-variables-browser.test.js` | the scope chain |
| `test/model-tree.test.js` | the scope model |
