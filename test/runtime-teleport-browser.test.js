'use strict';

// Teleport on a deployed page, in headless Chrome: nodes drawn in another place — a
// frame named as a target (the header's "actions", laid out by its row) or the page
// (out of a clipped card) — while their params, Logic and bindings stay those of where
// they are in the tree; a Populate's copies teleport too and go when they go; a dialog
// teleported to the page opens over the page.
// Needs `npm run build`.   node test/runtime-teleport-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-teleport.html', async ({ js, logs }) => {
            const wait = (ms) => js(`new Promise(function (r) { setTimeout(r, ${ms}); })`);
            const emit = async (id, event, payload) => { await js(`(function () { window.__ctx[${JSON.stringify(id)}].emit(${JSON.stringify(event)}, ${JSON.stringify(payload === undefined ? null : payload)}); return 1; })()`); await wait(80); };
            const parentOf = (id) => js(`(function () { var e = document.querySelector('[data-id="${id}"]'); var p = e.parentNode; return p.getAttribute("data-id") || p.id || "?"; })()`);
            const rect = (id) => js(`(function () { var b = document.querySelector('[data-id="${id}"]').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })()`);
            const kids = (id) => js(`Array.from(document.querySelector('[data-id="${id}"]').children).map(function (e) { return e.getAttribute("data-id"); }).filter(Boolean)`);

            await ok('into a target frame: the header row holds its own child, then what is teleported, laid out by the row', async () => {
                assert.deepStrictEqual(await kids('hdr'), ['h1', 'inst::tl', 'inst::tb']);
                const a = await rect('h1'), b = await rect('inst::tl'), c = await rect('inst::tb');
                assert.deepStrictEqual([a[1], b[1], c[1]], [0, 0, 0], 'one row');
                assert.deepStrictEqual([b[0] - a[0], c[0] - b[0]], [110, 90], 'side by side: 100 + 10, 80 + 10');
            });
            await ok('its params and Logic stay: the template label shows its param; its button still runs its Logic', async () => {
                assert.strictEqual(await js(`document.querySelector('[data-id="inst::tl"]').textContent`), 'hello');
                await emit('inst::tb', 'click');
                assert.strictEqual(await js(`document.querySelector('[data-id="res"]').textContent`), 'hello');
            });
            await ok('to the page: out of the clipped card, at its x / y on the page', async () => {
                assert.strictEqual(await parentOf('pop'), 'nexa-runtime-artboard');
                assert.deepStrictEqual(await rect('pop'), [300, 300, 100, 50]);
            });
            await ok('a Populate\'s copies teleport too (each its badge), and go with their copy', async () => {
                await emit('ctl', 'fill', [{ id: 1 }, { id: 2 }]);
                assert.deepStrictEqual((await kids('hdr')).slice(3), ['list#1::badge', 'list#2::badge']);
                assert.strictEqual(await js(`document.querySelector('[data-id="list#2::badge"]').textContent`), '#2');
                await emit('ctl', 'fill', [{ id: 2 }]);
                assert.deepStrictEqual((await kids('hdr')).slice(3), ['list#2::badge'], 'the badge of the removed copy is gone');
            });
            await ok('"When a Logic Teleport node runs": it stays home; Teleport sends it, Home brings it back to its place', async () => {
                assert.strictEqual(await parentOf('lazy'), 'card');
                const before = await rect('lazy');
                await emit('ctl', 'go');
                assert.strictEqual(await parentOf('lazy'), 'hdr');
                assert.strictEqual((await kids('hdr')).pop(), 'lazy', 'after what is already there');
                await emit('ctl', 'home');
                assert.strictEqual(await parentOf('lazy'), 'card');
                assert.deepStrictEqual(await rect('lazy'), before, 'exactly where it was');
            });
            await ok('Teleport any node (no teleport of its own), where to from msg.payload; "home" back', async () => {
                await emit('ctl', 'to', '@page');
                assert.strictEqual(await parentOf('res'), 'nexa-runtime-artboard');
                await emit('ctl', 'to', 'actions');
                assert.strictEqual(await parentOf('res'), 'hdr');
                await emit('ctl', 'to', 'home');
                assert.strictEqual(await parentOf('res'), 'nexa-runtime-artboard');
                assert.deepStrictEqual((await rect('res')).slice(0, 2), [20, 580]);
            });
            await ok('a dialog teleported to the page opens over the page, not in its card', async () => {
                await emit('ctl', 'dialog');
                assert.deepStrictEqual(await rect('cdlg'), [400, 250, 200, 100], 'centred in the 1000 × 600 page');
                assert.deepStrictEqual(await js(`(function () { var b = document.querySelector('[data-overlay="card::cdlg"], [data-overlay="cdlg"] .nexa-overlay-backdrop').getBoundingClientRect(); return [b.width, b.height]; })()`), [1000, 600]);
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { width: 1000, height: 600, ready: "!!(window.__ctx && window.__ctx.ctl)", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
