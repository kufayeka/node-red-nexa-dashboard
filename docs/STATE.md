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
| **Template** | Its params (and variables) | Each instance. |

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

## 4b. Lists: the repeater (Populate)

**Populate** (Events tab → Lists) fills a **container** (a Row, Column or
Grid frame) with a **template**, one card per item of an array. The array
comes from `msg.payload`, a msg property, or a fixed list.

**Modes:**

| Mode | Does |
| --- | --- |
| **replace** | By key: cards are kept, updated, added or removed, then ordered as given. Without a key, everything is replaced. |
| **append** / **prepend** | Adds cards at the end / start. |
| **update by key** | Updates a card in place, or adds it when new. |
| **remove by key** | Removes cards. |
| **clear** | Removes all cards. |

The **key** is the item field that identifies a card (e.g. `id`). A known
key updates the same card in place, which matters for realtime data and
tables. The container's own children (a header) stay; cards come after them.

**The template declares a param** (Templates tab → Parameters, e.g.
`product`), and the Populate node chooses which param each item goes into
("Pass each item into the template's param"). Inside the template, bind
`{product.name}`, `{product.price}`, and `{index}` for the position. The
item is also always available as `{item}` / `msg.item`.

**Which container: the Layout node.** Every frame of the screen is also a
Logic node. Select a Row / Column / Grid on the canvas, and its chip lights
up in the Events tab under **"Layouts on this screen"** (labelled with name,
id and kind, so two Rows are told apart). Drag it into the Logic canvas and
wire a Populate into it:

```
[button: click] → [Function: msg.payload = {id, …}] → [Populate: Template 1 → param1, append] ─┬→ [Layout: Column #a928]
                                                                                               └→ [Layout: Grid #07fd]
```

A Populate wired to several Layout nodes fills each of them with the same
data, and each container keeps its own list. A Populate can still name a
container itself instead.
- **The template's own Logic runs per card**, like a React component. For
  example, `[Buy: on click] → [HTTP Request POST /api/order/{item.id}, body {item}]`
  (the body can be a binding).
- **Events from inside a card** carry `msg.item` and `msg.index`, for a flow
  outside the card that handles every card.
- **"Cards fill the container's width"** makes list / table rows.

Example:

```
[On Load] → [HTTP Request GET /api/products] → [Populate: Grid "Products" × ProductCard, key id, items msg.payload]
```

## 5. The Function node API

```js
vars.get("filter")                 // nearest declaration, up to the app
vars.get("user", "@app")           // explicit scope: "@app", "" (the screen) or a group / frame id
vars.set("filter", "open")         // on the scope that declares it (watchers fire)
vars.update("cart", "append", item)   // merge / append / remove / toggle / increment
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
| `test/runtime-variables-browser.test.js` | the scope chain |
| `test/model-tree.test.js` | the scope model |
