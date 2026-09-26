// Nexa SDK testkit — test a component plugin in a real browser (headless Chrome).
//
//   const { withHarness } = require("@kufayeka/node-red-nexa-dashboard/sdk/testkit");
//   withHarness({
//       mounts: { "/acme-nexa-gauges/vendor": path.join(__dirname, "..", "dist") },
//       modules: ["/acme-nexa-gauges/vendor/gauges.js"]
//   }, async ({ js, type, key, settle, logs }) => {
//       await js('NexaTest.mount("g", "acme-gauge", { valueIn: "{sparkplug:G::E::D::m}" })');
//       await js('NexaTest.setTag("g", "42")');
//       ...
//   });
//
// The page is the SDK harness (sdk/testkit/harness.html): registry + SDK +
// property kit + your modules, with window.NexaTest (testkit-browser.js).
// Resolves null (skip) when no Chrome / Edge is installed (CHROME_PATH).
// The dashboard must be built first (`npm run build` in node-red-nexa-dashboard).
const { withPage } = require("./cdp.js");
const { startServer } = require("./server.js");

async function withHarness(opts, fn) {
    opts = opts || {};
    const server = await startServer(opts);
    try {
        const url = server.url + "/__nexa_test__/harness.html?modules=" + encodeURIComponent(JSON.stringify(opts.modules || []));
        return await withPage(url, async function (page) {
            const err = await page.js("window.NexaTest.loadError || null");
            if (err) throw new Error("[nexa-test] a plugin module failed to load:\n" + err);
            return fn(page);
        }, { ready: "!!(window.NexaTest && window.NexaTest.ready)", readyTries: 150, width: opts.width, height: opts.height });
    } finally {
        await server.close();
    }
}

module.exports = { withHarness, withPage, startServer };
