# Nexa plugin rules (strict)

These rules apply to every change to a Nexa component plugin (`@kufayeka/nexa-component-*`, and any plugin built on the SDK), and to every SDK change made for a plugin. They apply to people and to AI agents alike.

- **MUST / NEVER** are not suggestions. To break one you need the user's explicit "yes" for that specific case, recorded in the commit message.
- `sdk/lint-plugin.js` checks the rules a machine can check. Every plugin's `npm test` runs it first, and so does the dashboard's `test/plugin-rules.test.js` for every plugin in the workspace. A red lint is a failed change.
- The SDK reference is [SDK.md](SDK.md). This file says what you may do with it and how.

---

## 1. Before you change anything

You MUST do these, in order, before editing a file:

1. **Name the change in one sentence**, and pick its type from §8 (new component, new prop, behaviour change, bug fix, removal, restyle, SDK change). A change that is two types is two changes: do them one after the other.
2. **Read what you will touch:** the component's whole definition, the plugin's `test/browser.test.js`, and the SDK.md sections it uses.
3. **Find every use** of what you change: other components of the plugin, shared files (`core.js`), tests, docs, and saved screens (`props` keys are in users' flows).
4. **Check the recorded decisions:** `.agents/memory/` and `.agents/rules/working-rules.md` in the workspace. A decision recorded there is not yours to undo.
5. **Product decision? Ask.** A new component, a change in what an existing component does on a live page, or a change in its look is the user's call. Propose first ("diskusi dulu"), with one question at most.

---

## 2. The package

- **Layout:**
  ```
  package.json                 node-red.plugins, scripts.lint + scripts.test (lint first)
  widgets/<name>-plugin.js     backend: sdk/package (+ adminApi)
  widgets/<name>-plugin.html   editor: one <script type="module">
  dist/*.js                    the components (ES modules, no build step)
  test/browser.test.js         the SDK testkit
  README.md                    what each component does, its props, inputs, outputs, events
  AGENTS.md (+ CLAUDE.md)      the guard for AI agents: points here
  ```
- `scripts.test` MUST be `npm run lint && node test/browser.test.js`. Start a new plugin from `sdk/template/`.
- **Ids:**
  - The plugin id is `<org>-nexa-component-<name>`.
  - A component id is `<org>-<name>` (kufayeka: `kufayeka-…` or `nexa-ui-…` in the UI library).
  - An id is stored in screens: NEVER change it (§5).
- One file per family of components (`containers.js`, `form.js`). Shared code goes in one shared module (`core.js`), never copied between files.

---

## 3. The contract

- **`defineComponent` only.** NEVER use `NEXA.registerComponent` (the legacy contract) in new code. *(lint: `no-legacy-register`)*
- **One import.** Import ONLY `../../nexa-sdk/nexa-component-sdk.js` and the plugin's own `./x.js` files. NEVER import npm packages or URLs. If a library is needed, it is bundled into the SDK and re-exported (an SDK change, §8 G). *(lint: `sdk-import-only`)*
- **Lit only.** A view extends `NexaElement`.
- **Explicit declarations.** `properties`, `inputs`, `outputs`, `events`, `actions`, `states`, `parts` and `slots` are written out in each component. Shared ones are spread explicitly (`...FieldController.properties("int")`), never inherited silently.
- **Tags are generic** (`{provider:address}`). NEVER hard-code a provider (Sparkplug) in a component.
- **Writes go only through `outputs`** (`this.out.write`) to a variable, a tag or `$route.query`. NEVER write through an event or a side channel.
- **Events** carry what happened (`this.emit(name, payload)`). **Actions** are what Logic can call. Both are declared.
- A component does ONE thing. Two behaviours behind a mode prop is two components.

---

## 4. The inspector

The inspector is built from the schema. There is no hand-written panel.

- NEVER write `inspector:` *(lint: `no-inspector`)*. Lay out with:
  - `group` / `section` (the tree) and `groups: [...]` (the group order);
  - `visibleWhen(p)` / `enabledWhen(p)`;
  - `help`, `placeholder`, `unit`, `min`, `max`, `options` (or `options: (p) => Promise`);
  - `validate(v, p)` (blocks) and `warn(v, p)` (does not block);
  - `summary(v, p)` (the row's text);
  - for lists: `noun` and `itemLabel`.
- Inputs and outputs take `group` / `section` too. Custom CSS comes ONLY from `cssFields(...)`, declared, never automatic.
- **A prop that needs more than a widget** gets `editor: "<tag>"` and `definePropertyEditor(tag, ({ PropertyEditor, html }) => class …)`:
  - `static kind` is `"inline"` / `"large"` / `"dialog"`.
  - Call `commit(value)` ONCE per real change. Use `preview(value)` while dragging.
  - Define `static summary` for the tree row.
  - Use `<nx-*>` widgets inside, with NO own styling.
  - It is editor-only: it never runs on a page.
- **Editor-side server calls** go only through `this.api` → the plugin's `adminApi` routes (`sdk/package`):
  - Validate every input on the server.
  - NEVER send a secret (API key, password) to the browser.
  - GET routes read; anything else writes (Node-RED checks `flows.read` / `flows.write`).
- Inspector fields apply on **Enter / blur**, never on a typing debounce. Never rebuild the panel from a component.

---

## 5. Compatibility: what is stored is a promise

Users' screens store these: component **ids**, **prop keys** and their **types and meaning**, input / output prop keys (`prop: "readTag"`), **event names and payload fields**, **action names and params**, **slot names**, and **part / state names** (their CSS keys).

- NEVER rename, remove or retype one, and NEVER change what it means. When you must:
  1. bump `version`;
  2. write `migrate(props, fromVersion)`;
  3. add a test that loads old props and checks the migrated ones (testkit: `NEXA.getComponent(id).migrateProps(old)`).
- **Changing a `default` changes every screen that never set it.** It is a behaviour change (§8 C): ask, and say so in the commit.
- Adding a prop is safe only with a default that keeps today's behaviour.
- Deprecate before you remove: hide the prop (`hidden: true`) and keep reading it for at least one release.

---

## 6. Runtime safety and performance

A view runs on live industrial pages, for hours, with tags changing every 20–100 ms.

- **Timers and listeners only through the SDK:** `this.every(ms, fn)`, `this.after(ms, fn)`, `this.listen(target, type, fn)`, `this.onDestroy(fn)`. They stop with the component.
  - NEVER `setInterval` *(lint: `no-set-interval`)*.
  - NEVER assign over an SDK method (`this.every = …` broke a component once).
- **No network from a plugin's code:** data comes in through inputs and goes out through outputs. *(lint: `network`)*
- **No browser storage** *(lint: `storage`)*; **no `eval` / `new Function`** *(lint: `no-eval`)*; **no `RED`** (modules also run on pages) *(lint: `no-red-global`)*.
- **A view stays inside its own element:** `this.renderRoot`, never `document.querySelector` *(lint: `no-document-query`)*. Overlays and popups use `this.lift(on)`.
- **No global state:** no `window.x = …`, no prototype patching. Shared caches live in the module, keyed and bounded.
- **`render()` is cheap and pure:** no heavy computing (cache in `propsChanged`), no writes, no events. Never throw from `render`: an unknown value (`null`) renders as unknown (`???`), not as an error.
- **Inputs that change fast** get `throttle` on the input. Never accumulate unbounded arrays (a trend buffer has a maximum).
- **Editor mode** (`this.isEditor`): no writes, no timers that change data, no network. Show the preview values.
- **A justified exception** is written where it happens, with its reason: `// nexa-lint-allow <rule>: <reason>`. The reason is reviewed like code. Example: the UI library's Iframe calls its own admin route.

---

## 7. The look

- Follow the Nexa visual identity: IBM Carbon, a little softer (radius 4, IBM Plex, filled fields; SDK.md and the UI library's `core.js` `BASE_CSS`).
- Use theme tokens (`var(--nexa-…)`, `{token:…}` defaults), never a hex value where a token exists. Check both light and dark.
- A restyle is its own change (§8 F), with screenshots, never mixed into a fix.

---

## 8. Change recipes (follow the one that fits, step by step)

**A. A new component** (after the user agreed to it)
1. Write it in the family's file: declarations first, view last.
2. Write its tests:
   - it mounts; inputs show;
   - outputs write (and nothing is written in the editor);
   - events and actions;
   - the inspector rows (`NexaTest.rows`, `ins.field`);
   - light / dark.
3. Document it in the plugin README: what it does, props, inputs, outputs, events, actions.
4. Done when §9 is.

**B. A new prop**
1. Pick a default that keeps today's behaviour.
2. Put it in the right `group` / `section`, and give it `help`.
3. Test it: the prop changes the view, and the inspector row shows it.
4. Document it in the README.

**C. A behaviour change** (what an existing component does)
1. Ask first.
2. Make the change.
3. Update its tests (they fail before, pass after).
4. Migrate if anything stored changes meaning (§5).
5. Document it; name it in the commit as a behaviour change.

**D. A bug fix**
1. Write a test that reproduces the bug and FAILS.
2. Fix the cause, the smallest change that does it. Don't fix the symptom, and don't add a try/catch to hide it.
3. The test passes. Look for the same bug elsewhere in the plugin (same pattern) and list what you found.
4. No unrelated edits in the same commit.

**E. Removing or renaming** anything stored: §5 (version + migrate + test). Removing a component: ask; it breaks the screens that use it.

**F. A restyle**
1. Only CSS and tokens, no behaviour.
2. Screenshots before and after, light and dark, that you looked at.
3. Its own commit.

**G. The plugin needs the SDK to change**
1. The change goes in `node-red-nexa-dashboard`, and it is GENERIC: useful to any plugin, named for what it does (not for your component), documented in SDK.md, tested there (`test/run-all.js`).
2. Commit it first (its own commit). Commit the plugin change after.
3. NEVER put a component, or code for one plugin only, into the dashboard.

---

## 9. Definition of done

A change is done when ALL of these hold, and you can show them:

- [ ] `npm test` in the plugin is green: lint, then its browser test.
- [ ] The SDK was touched: `node test/run-all.js` in the dashboard is green, and every plugin's `npm test`.
- [ ] Tags, bindings or writes were touched: the UI library's `test/tags-e2e.test.js` is green (real Node-RED + broker).
- [ ] Something visible changed in the editor or on a page: an e2e in an isolated Node-RED (ports 1899 / 1898, never the user's `data/`), with screenshots you actually looked at.
- [ ] Docs: the plugin README, SDK.md (for an SDK change), and `.agents/NEXA_DASHBOARD_PROGRESS.md` when a feature lands.
- [ ] No stray files (scratch scripts, screenshots, stack dumps, `.extracted-*`), no debug `console.log`.
- [ ] You report honestly what passed, what failed and what you could not test.

---

## 10. Commits and git

- One logical change per commit. The message says what changed for the user, and why. Use `feat(…)`, `fix(…)`, `refactor(…)`, `docs(…)`, `test(…)`; a breaking change is marked `!` and explained.
- Commits are authored by `kufayeka`, with NO AI co-author or "generated by" lines.
- Several repos: the SDK (dashboard) commit first, then the plugins.
- Commit only what you changed. Work of someone else in the same tree is committed only when the user says so.
- Push only to `kufayeka/*` repos, and only when the user asks. NEVER push to `node-red/node-red`. Never force-push a shared branch.

---

## 11. Stop and ask: the drift signals

If any of these happens, STOP and ask the user before going on:

- You want to edit a file the change type (§1) does not need ("while I'm here…"), or a second plugin, or Node-RED core.
- You are about to rename, remove or retype something stored (§5), or change a default.
- You want to add a dependency, a build step, or a new global.
- A test fails and you are tempted to change the TEST rather than the code, or to skip it. Only change a test when the expected behaviour itself changed, and say so.
- You are adding a `nexa-lint-allow`, a try/catch that swallows errors, or a timeout "to make it work".
- The change grows past what the one sentence of §1 says.
- You are not sure the user wants it.

## 12. Never (the short list)

- An `inspector:`; an import other than the SDK facade and the plugin's own files; `NEXA.registerComponent`.
- `setInterval`, network calls, browser storage, `eval`, `RED`, `document.querySelector` in a plugin's code (unless justified, §6).
- Renaming or retyping a stored id / key / event / action / slot without version + migrate + test.
- A component inside `node-red-nexa-dashboard`.
- Running anything against the user's `data/` or their live Node-RED (1880 / 1881).
- Weakening or deleting a test to make a change pass.
- Committing with AI attribution, or pushing without being asked.
