'use strict';

// The Join node on a deployed page, in headless Chrome: Wait All sends one combined message
// once both slots spoke (not one per message, as before), and its timeout sends what came.
// Needs `npm run build`.   node test/runtime-join-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-join.html', async ({ js, logs }) => {
            const wait = (ms) => js(`new Promise(function (r) { setTimeout(r, ${ms}); })`);
            const click = (id) => js(`(function () { window.__ctx[${JSON.stringify(id)}].emit("click", null); return 1; })()`);
            await ok('one slot alone sends nothing', async () => {
                await click('bp');
                await wait(50);
                assert.deepStrictEqual(await js('window.__out'), []);
            });
            await ok('the second slot completes it: one message with both payloads', async () => {
                await click('bs');
                await wait(50);
                assert.deepStrictEqual(await js('window.__out'), [{ price: 9.5, stock: 3 }]);
            });
            await ok('it starts over: another round needs both again', async () => {
                await click('bs');
                await wait(50);
                assert.strictEqual((await js('window.__out')).length, 1);
                await click('bp');
                await wait(50);
                assert.strictEqual((await js('window.__out')).length, 2);
            });
            await ok('a timeout sends what came, the missing slot null, complete false', async () => {
                await click('bt');
                await wait(350);
                assert.deepStrictEqual(await js('window.__timedOut'), { payload: { price: 1, stock: null }, complete: false });
            });
            assert.deepStrictEqual(logs.filter((l) => !/favicon/.test(l)), [], 'no page errors');
            return true;
        }, { width: 600, height: 200, ready: 'document.readyState === "complete" && !!window.__ctx.bp' });
        if (r === null) return;
    } finally {
        server.close();
    }
    console.log(passed + ' passed');
    console.log('ALL OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
