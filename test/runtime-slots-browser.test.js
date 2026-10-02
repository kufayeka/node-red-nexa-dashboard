'use strict';

// Components with slots on a deployed page, in headless Chrome: each slot frame goes into
// the component's element (slot="<name>") and its <slot> shows it; the frame lays out what
// it holds (its auto layout, from the panel's corner); what is in a slot is on the page's
// Logic like anything else; Layer Control brings a node back into its slot; a component
// whose plugin registers late gets its slots then; a slot no longer declared isn't drawn.
// Needs `npm run build`.   node test/runtime-slots-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-slots.html', async ({ js, logs }) => {
            const wait = (ms) => js(`new Promise(function (r) { setTimeout(r, ${ms}); })`);
            const emit = async (id, event, payload) => { await js(`(function () { window.__ctx[${JSON.stringify(id)}].emit(${JSON.stringify(event)}, ${JSON.stringify(payload === undefined ? null : payload)}); return 1; })()`); await wait(80); };
            const el = (id) => `document.querySelector('[data-id="${id}"]')`;
            const shown = (id) => js(`(function () { var e = ${el(id)}; return !!e && e.getClientRects().length > 0; })()`);
            const rect = (id) => js(`(function () { var b = ${el(id)}.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })()`);

            await ok('each slot frame is in the component\'s element with slot="<name>"; the shown slot draws, the other not', async () => {
                const r = await js(`(function () { var host = ${el('T')}.__host; return Array.from(host.children).map(function (c) { return c.getAttribute("data-id") + ":" + c.getAttribute("slot"); }); })()`);
                assert.deepStrictEqual(r, ['sa:a', 'sb:b'], 'the one no longer declared (slotUnused) is not mounted');
                assert.deepStrictEqual([await shown('sa'), await shown('sb'), await shown('la'), await shown('lb')], [true, false, true, false]);
            });
            await ok('the slot frame fills its slot; its auto layout places what it holds (padding 16, gap 8)', async () => {
                assert.deepStrictEqual(await rect('sa'), [100, 140, 400, 260], 'the panel: under the 40px header');
                assert.deepStrictEqual((await rect('la')).slice(0, 2), [116, 156]);
                assert.deepStrictEqual((await rect('ba')).slice(0, 2), [116, 184], '20 + 8 below');
            });
            await ok('another slot shown: its frame draws there', async () => {
                await js(`${el('T')}.__show("b"); 1`); await wait(50);
                assert.deepStrictEqual([await shown('sa'), await shown('sb'), await shown('lb')], [false, true, true]);
                assert.deepStrictEqual(await rect('sb'), [100, 140, 400, 260]);
                await js(`${el('T')}.__show("a"); 1`); await wait(50);
            });
            await ok('what is in a slot is on the Logic: its button runs its flow', async () => {
                await emit('ba', 'click');
                assert.strictEqual(await js(`${el('res')}.textContent`), 'clicked in A');
            });
            await ok('Layer Control: removed and back — into its slot frame, in its place', async () => {
                await emit('ctl', 'remove');
                assert.strictEqual(await js(`!${el('named')}`), true, JSON.stringify(logs));
                await emit('ctl', 'show');
                assert.strictEqual(await js(`${el('named')}.parentNode.getAttribute("data-id")`), 'sa');
                assert.deepStrictEqual((await rect('named')).slice(0, 2), [116, 212], 'after the button: 184 + 20 + 8');
            });
            await ok('a component whose plugin registers after the page was drawn: its slots are mounted then', async () => {
                assert.strictEqual(await js(`!${el('xa')}`), true, 'not yet');
                await js('window.__registerLate(); 1'); await wait(50);
                assert.deepStrictEqual([await shown('xa'), await shown('xb')], [false, true], 'its "b" is shown');
                assert.deepStrictEqual(await rect('lb2'), [600, 140, 300, 160]);
                // what it holds is subscribed too (else a bound value stays "???")
                assert.ok((await js('window.__nexaRuntime.subscribedTags()')).indexOf('G::E::D::Late') !== -1, 'its tag is asked for');
            });
            await ok('no errors', async () => {
                assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            });
        });
        if (r && r.skipped) { console.log('skipped: ' + r.reason); return; }
        console.log(`\n${passed} passed\nALL OK`);
    } finally {
        server.close();
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
