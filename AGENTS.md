# Rules for AI agents (and people) changing the Nexa Dashboard

Read before you edit, in this order:

1. [ARCHITECTURE.md](ARCHITECTURE.md): where each thing lives and how data moves.
2. [CONTRIBUTING.md](CONTRIBUTING.md): the SOP, i.e. code rules, feature and bug checklists, definition of done, commits.
3. [docs/PLUGIN_RULES.md](docs/PLUGIN_RULES.md): the strict rules for component plugins and for every SDK change made for a plugin. Plugins are where most changes happen.
4. In the workspace: `.agents/README.md`, `.agents/rules/`, `.agents/memory/` (the user's recorded decisions).

## Before you edit (mandatory)

1. Say the change in one sentence, and pick its type: feature, bug fix, refactor (no behaviour change), SDK change, docs. One type per change.
2. Find where it goes on the ARCHITECTURE.md map, and every use of what you change.
3. A product decision (a new feature, a change in behaviour or look) is the user's. Propose first, and ask one question at most.

## Red lines

- **No component in this package.** Components live in plugin packages. This package holds the editor, the runtime, and the generic SDK only.
- **The SDK is a public contract.** Plugins depend on `sdk/nexa-component-sdk.js` exports, `defineComponent`'s schema, `NexaElement`'s API, the testkit, `sdk/package`, and `sdk/lint-plugin.js`.
  - Never remove or change one without a migration path, SDK.md updated, and every plugin's `npm test` green.
- **Saved data is a promise.** Never change the shape of `flows.json` content (screens, nodes, props, logic) without a migration (`src/model/migrate-*.js`, `scripts/migrate-project.js`) and its test.
- **The selection and the inspector:**
  - An edit never rebuilds the properties panel.
  - Inspector fields apply on Enter / blur.
  - A node property is a prop of an inspector SOURCE (`src/sidebar/inspector/sources/`), never DOM in `properties-panel.js`.
- **No new `node.type ===` chains:** register kinds (`src/features/logic/`).
- Never edit Node-RED core (`packages/node_modules/@node-red/*`, `node-red/`).
- Never run against the user's `data/` or their live Node-RED (1880 / 1881). Test in an isolated one (1899 / 1898).
- Never weaken or delete a test to pass.
- Commits are authored by `kufayeka` with NO AI attribution. Push only to `kufayeka/node-red-nexa-dashboard`, and only when asked.

## Done means

- `npm run build`, then `node test/run-all.js` is green. It includes `test/plugin-rules.test.js`, which lints every plugin in the workspace.
- The e2e tests in CONTRIBUTING.md for the area you touched are green, with screenshots you looked at for anything visible.
- An SDK change: every plugin's `npm test` is green too.
- Docs updated together with the code (docs/*.md, ARCHITECTURE.md, `.agents/NEXA_DASHBOARD_PROGRESS.md` when a feature lands).
