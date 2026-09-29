'use strict';

// Update Component -> "Run: <action>" on a deployed page (headless Chrome): the node's own
// action with its parameters, msg.payload instead of them, msg.action still works.
// Needs `npm run build`.   node test/runtime-actions-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-actions.html', async ({ js, logs }) => {
            const emit = async (event, payload) => { await js(`(function () { window.__ctx.ctl.emit(${JSON.stringify(event)}, ${JSON.stringify(payload === undefined ? null : payload)}); return 1; })()`); await js('new Promise(function (r) { setTimeout(r, 80); })'); };
            const last = () => js('window.__calls[window.__calls.length - 1]');
            await ok('the node\'s action, no parameters', async () => {
                await emit('reload');
                assert.deepStrictEqual(await last(), ['P', 'reload', null]);
            });
            await ok('its parameters when msg.payload has none; msg.payload instead when it has one', async () => {
                await emit('open');
                assert.deepStrictEqual(await last(), ['P', 'navigate', { url: '/a' }]);
                await emit('open', { url: '/b' });
                assert.deepStrictEqual(await last(), ['P', 'navigate', { url: '/b' }]);
            });
            await ok('msg.action (a Function) still runs an action', async () => {
                await emit('byMsg', { hi: 1 });
                assert.deepStrictEqual(await last(), ['P', 'postMessage', { hi: 1 }]);
            });
            await ok('no errors', async () => {
                assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            });
            return true;
        }, { width: 400, height: 300, ready: "!!(window.__ctx && window.__ctx.ctl)", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
