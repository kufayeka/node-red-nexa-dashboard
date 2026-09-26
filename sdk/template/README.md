# acme-nexa-sample — Nexa component plugin template

Copy this folder, rename `acme-nexa-sample` / `acme-sample-indicator` everywhere, and edit
`dist/sample.js`. Guide: `@kufayeka/node-red-nexa-dashboard/docs/SDK.md`.

```
widgets/plugin.js     backend (one call to the SDK's package helper)
widgets/plugin.html   editor (<script type="module">)
dist/sample.js        the component(s) — plain ES modules, no build step
test/browser.test.js  headless-Chrome test with the SDK testkit
```
