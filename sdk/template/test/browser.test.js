'use strict';
// node test/browser.test.js   (headless Chrome; build @kufayeka/node-red-nexa-dashboard first)
const assert = require('assert');
const path = require('path');
const { withHarness } = require('@kufayeka/node-red-nexa-dashboard/sdk/testkit');

withHarness({
    mounts: { '/acme-nexa-sample/vendor': path.join(__dirname, '..', 'dist') },
    modules: ['/acme-nexa-sample/vendor/sample.js']
}, async ({ js, logs }) => {
    await js('NexaTest.mount("i", "acme-sample-indicator", { inputValue: "{sparkplug:G::E::D::running}" })');
    await js('NexaTest.setTag("i", "true")');
    await js('NexaTest.settle()');
    assert.strictEqual(await js('NexaTest.wc("i").renderRoot.querySelector("button").textContent'), 'RUNNING');
    await js('NexaTest.wc("i").renderRoot.querySelector("button").click()');
    assert.deepStrictEqual(await js('NexaTest.item("i").writes'), [['inputValue', false]]);
    assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
    console.log('ok');
}).then((r) => { if (r === null) console.log('SKIP'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
