# Rules for AI agents (and people) changing this plugin

This is a Nexa component plugin, started from the SDK template. Every change follows **the plugin rules**:
`@kufayeka/node-red-nexa-dashboard/docs/PLUGIN_RULES.md` (installed:
`node_modules/@kufayeka/node-red-nexa-dashboard/docs/PLUGIN_RULES.md`). Read it before you edit. The SDK reference is
`node_modules/@kufayeka/node-red-nexa-dashboard/docs/SDK.md`.

## Before you edit (mandatory)

1. Say the change in one sentence, and pick its type (PLUGIN_RULES §8): new component, new prop, behaviour change, bug fix, removal, restyle, SDK change. One type per change.
2. Read the component's whole definition, `test/browser.test.js`, and what uses it.
3. A new component, or a change to what a component does on a page or how it looks, is the user's decision. Ask first.

## Red lines (never, unless the user said yes to that case)

- Rename, remove or retype a stored component id, prop key, input / output prop, event, action, slot, part or state. Changing a `default` counts too. The only way is `version` + `migrate` + a test (PLUGIN_RULES §5).
- Write an `inspector:`, import anything other than `../../nexa-sdk/nexa-component-sdk.js` and this plugin's `./x.js`, or use `NEXA.registerComponent`.
- Use `setInterval` (use `this.every`), network calls, browser storage, `eval`, `RED`, `document.querySelector` in `dist/`. A justified exception is written in the code: `// nexa-lint-allow <rule>: <reason>`.
- Edit another plugin, Node-RED core, or put component code into `node-red-nexa-dashboard`.
- Weaken or delete a test to make a change pass.
- Run anything against the user's `data/` or live Node-RED (1880 / 1881). Test in an isolated Node-RED (1899 / 1898).
- Commit with AI attribution, or push without being asked.

## Done means

- `npm test` is green. It runs `npm run lint` (`sdk/lint-plugin.js`) first, then `test/browser.test.js`.
- An SDK change: `node test/run-all.js` in the dashboard is green too, and every plugin's `npm test`.
- Tags, bindings or writes changed: `nexa-component-ui-library/test/tags-e2e.test.js` is green.
- Something visible changed: an e2e with screenshots you looked at.
- README updated (what each component does, its props, inputs, outputs, events).
- A bug fix comes with a test that failed before the fix.

## This plugin

- Modules: `dist/` (rename `acme-nexa-sample` everywhere first)
- Tests: `test/browser.test.js` (SDK testkit, headless Chrome).
