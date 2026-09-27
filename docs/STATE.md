# App state: variables, queries and web / data logic

This page is for people building screens and developers extending Nexa. It
covers how a live page keeps and shares data: variables in a lexical scope
chain, global app state, queries filled from an API, and the Logic nodes and
Function API that read and change it. The ideas are the ones front-end
developers know from Jotai / Redux (state and watchers) and React Query
(server data with loading / error state), wired with Nexa's Logic flows.

- [1. Where state lives](#1-where-state-lives)
- [2. Binding](#2-binding)
- [3. Changing and watching state (Logic)](#3-changing-and-watching-state-logic)
- [4. Queries: data from an API](#4-queries-data-from-an-api)
- [5. Web and data nodes](#5-web-and-data-nodes)
- [6. The Function node API](#6-the-function-node-api)
- [7. Recipes](#7-recipes)
- [8. How it works](#8-how-it-works)

## 1. Where state lives

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

- **A template instance is a boundary.** Inside it you see the app and the
  template's own params and variables, not the screen around the instance.
  Values cross through the instance's paramValues, e.g. `who = {label}`,
  which are passed again when that variable changes.
- **Variable shape:** `{ id, name, type, defaultValue, persist?, source? }`,
  with types string / number / boolean / object / array / color. `persist`
  applies to app variables only; `source` makes the variable a query (§4).

## 2. Binding

Anywhere in a component's props, or in text fields of the web / data nodes:

| Binding | Meaning |
| --- | --- |
| `{name}` | The variable's value. The binding picker (⛓ / tag fields) lists what is in scope, nearest first. |
| `{name.a.b}`, `{list[0].x}` | A path into an object or array. |
| `{$route.params.id}` | `:id` of the screen path (`/orders/:id`). |
| `{$route.query.tab}` | `?tab=…`. |
| `{$route.path}` | The page path. |
| `{$status.orders.loading}` | A query's state; also `.error`, `.statusCode`, `.updatedAt`. |
| `{msg.payload.id}` | The message, inside HTTP Request / Storage / Cookie text fields only. |

A value that is exactly one binding keeps its type (a whole object or array).
A binding inside more text is turned into text. A name that can't be resolved
stays exactly as written.

## 3. Changing and watching state (Logic)

| Node | Does |
| --- | --- |
| **Set Variable** | Changes a variable: **set**, **merge** (object), **append** / **remove** (array item or object key), **toggle** (boolean), **increment** (a number, or 1). The value comes from `msg.payload`, a msg property (`payload.data.items`) or a fixed value. The msg goes on. |
| **Get Variable** | Puts a variable's value into a msg property. |
| **On Variable Change** | Starts a flow when a variable changes, from any source (a node, a Function, a query). `msg.payload` = new value, `msg.previous` = old value, `msg.variable` = the name. |
| **Refetch Query** | Fetches a query again now (§4). |

- **Choosing a variable:** it is a scope (App, this screen / template, or the
  group / frame that declares it) plus a name. The Events tab has **Set …**
  and **On change …** chips per declared variable (and **Refetch …** per
  query), plus blank ones.
- **What a change does:** the value is set on its declaring scope. Everything
  bound to it re-renders, unless it declares the name itself. Template
  instances bound to it get it passed in. Persisted app variables are saved.
  Watchers fire, but only when the value really changed (deep compare).

## 4. Queries: data from an API

A **query** is a variable filled from an API. Declare it next to the
variables (Screens tab or Properties → "Queries (from an API)"):

| Field | |
| --- | --- |
| Name | Bind the data as `{name}`. |
| Method / URL | The URL takes bindings, e.g. `/api/orders?line={line}`. |
| Keep | A path into the response, e.g. `data.items`; empty keeps all of it. |
| Every | Seconds between re-fetches (polling); 0 = none. |
| Fetch when the page opens | On by default. |

- **When it fetches:** when the page opens; every *N* seconds; when a
  variable used in its URL changes (like a React Query key); and on a
  **Refetch Query** node.
- **Stale responses:** a response that arrives after a newer request started
  is dropped.
- **Status:** `{$status.name.loading}`, `.error` (`"HTTP 404"`, `"timeout"`,
  or the network error), `.statusCode` and `.updatedAt` (ms).
- **Change events:** the data goes through the same write path as any
  variable, so On Variable Change and persistence work for queries too. A
  re-fetch that returns the same data is not a change.

## 5. Web and data nodes

| Node | Does |
| --- | --- |
| **HTTP Request** | See below. |
| **Storage** | local / session storage: get (into a msg property), set (payload or fixed value) or remove a key. JSON values; the key takes bindings. |
| **Cookie** | get / set / remove, with days, path, SameSite and Secure. Cookies set from the page are not HttpOnly. A server's HttpOnly session cookie is still sent with HTTP Request calls (`credentials`). |

**HTTP Request** in detail:
- **Request:** method, URL, headers (JSON; values take bindings), and the body
  from `msg.payload` (JSON), timeout, and cookies (same-origin / include /
  omit). `msg.url`, `msg.method` and `msg.headers` override the node's.
- **Response:** `msg.payload` = the parsed JSON or text, plus
  `msg.statusCode`, `msg.ok`, `msg.headers`, and `msg.error` on a non-2xx
  status, network error or timeout.
- **Timing:** the wire continues when the response is in.

## 6. The Function node API

Besides `msg`, a Function node gets:

```js
vars.get("orders")                 // nearest declaration (from the node's screen / template), up to the app
vars.get("user", "@app")           // explicit scope: "@app", "" (the screen) or a group / frame id
vars.set("filter", "open")         // set on the scope that declares it (watchers fire)
vars.update("cart", "append", item)   // an operation: merge / append / remove / toggle / increment
route.params.id; route.query.tab; route.path
storage.local.get("prefs"); storage.local.set("prefs", {...}); storage.session.remove("k")
cookies.get("session"); cookies.set("session", token, { days: 7, sameSite: "Lax", secure: true }); cookies.remove("session")
const r = await http.get("/api/orders");            // { ok, status, data, headers } — JSON in / out
await http.post("/api/orders", { qty: 2 }, { headers: { Authorization: "Bearer " + vars.get("token") } });
```

## 7. Recipes

- **Load on open, refresh every 5 s:** a query `orders` with URL
  `/api/orders`, *Every* 5. Bind `{orders}` in a table and
  `{$status.orders.loading}` on a spinner.
- **Filter:** a screen variable `status`, and a query URL of
  `/api/orders?status={status}`. A button → **Set Variable** `status = "open"`
  re-fetches automatically.
- **Save, then refresh:** Button click → **HTTP Request** `POST /api/orders`
  (body = msg.payload) → **Refetch Query** `orders`.
- **Login / session:** submit → **HTTP Request** `POST /api/login` →
  **Function**:

  ```js
  if (!msg.ok) return null;
  cookies.set("session", msg.payload.token, { days: 7 });
  vars.set("user", msg.payload.user, "@app");
  return msg;
  ```

  Keep `user` as an app variable, *Kept for: browser*. Other screens bind
  `{user.name}`, and their queries send `Authorization: Bearer {token}`.
- **React to a value (watch):** **On Variable Change** `alarmCount` →
  **Function** (`msg.payload > msg.previous`) → **Layer Control** to show a
  popup.
- **Detail page:** screen path `/orders/:id`, query URL
  `/api/orders/{$route.params.id}`.

Coming later: an app-wide Logic flow (runs on every screen, like `_app`) and
screen flow / route guards for login and roles (like Next.js middleware).

## 8. How it works

- **Scopes are plain objects.** Each one's prototype is the enclosing scope
  (`Object.create(parent)`, `src/model/scope.js`). Interpolation reads
  `scope[name]`, which walks the whole chain for free.
- **One write path.** `writeVariable` in `lib/nexa-runtime-client.js` sets
  the value, re-renders the components whose scope chain contains that
  scope (`scope.isPrototypeOf`), persists, notifies watchers and re-runs
  dependent queries.
- **App variables** travel on the project config node (`variables`) to the
  screen worker, which gives them to the page as `window.__NEXA_APP__`.
  Persisted values use the `nexa:app:<name>` storage keys.

Tests:

| Test | Covers |
| --- | --- |
| `test/runtime-state-browser.test.js` | routes, the boundary, operations, the watch, the Function API, web / data nodes, persistence across a reload |
| `test/runtime-queries-browser.test.js` | queries |
| `test/runtime-variables-browser.test.js` | the scope chain |
| `test/model-tree.test.js` | the scope model |
