'use strict';

// Where nodes are placed on a deployed page, in headless Chrome: docked to a corner / an
// edge of a frame that scrolls (they stay there while it scrolls), stretched along an edge,
// centred; "on the screen" out of a clipped card at the screen's x / y; the layer (z) over
// the Hierarchy's order; margin in a layout; padding; docked to the screen while the page
// scrolls. Needs `npm run build`.   node test/runtime-place-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-place.html', async ({ js, logs }) => {
            const wait = (ms) => js(`new Promise(function (r) { setTimeout(r, ${ms}); })`);
            const rect = (id) => js(`(function () { var b = document.querySelector('[data-id="${id}"]').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })()`);
            const topAt = (x, y) => js(`(function () { var e = document.elementFromPoint(${x}, ${y}); var n = e && e.closest("[data-id]"); return n && n.getAttribute("data-id"); })()`);

            await ok('docked in a frame: at its corner / edge / centre, off by the margin; stretched along the bottom', async () => {
                // S: 20,20 300 x 200 (a vertical scrollbar may take some width: the visible box)
                const cw = await js(`document.querySelector('[data-id="S"]').clientWidth`);
                assert.deepStrictEqual(await rect('tr'), [20 + cw - 8 - 60, 28, 60, 20]);
                assert.deepStrictEqual(await rect('foot'), [30, 220 - 30, cw - 20, 30], 'the whole width but its margins');
                assert.deepStrictEqual(await rect('mid'), [20 + Math.round(cw / 2 - 20), 20 + 100 - 10, 40, 20]);
            });
            await ok('...and they stay there while the frame scrolls (the content moves under them)', async () => {
                const before = [await rect('tr'), await rect('foot'), await rect('mid')];
                const tall = await rect('tall');
                await js(`document.querySelector('[data-id="S"]').scrollTop = 300; 1`); await wait(80);
                assert.deepStrictEqual((await rect('tall'))[1], tall[1] - 300, 'the content scrolled');
                assert.deepStrictEqual([await rect('tr'), await rect('foot'), await rect('mid')], before);
                assert.strictEqual(await topAt(before[0][0] + 5, before[0][1] + 5), 'tr', 'on top of the content, takes the pointer');
            });
            await ok("on the screen: out of the clipped card, at the screen's x / y", async () => {
                assert.strictEqual(await js(`document.querySelector('[data-id="pop"]').parentNode.id`), 'nexa-runtime-artboard');
                assert.deepStrictEqual(await rect('pop'), [600, 300, 80, 40]);
            });
            await ok('the layer (z): the first child above the second where they overlap', async () => {
                assert.strictEqual(await topAt(20 + 80, 300 + 80), 'a');
            });
            await ok("margin in a layout: the space around it; padding inside a component's box", async () => {
                const c1 = await rect('c1'), c2 = await rect('c2');
                assert.deepStrictEqual([c2[0] - c1[0], c2[1] - (c1[1] + 20)], [24, 10]);
                assert.strictEqual(await js(`getComputedStyle(document.querySelector('[data-id="c3"]')).paddingTop`), '3px');
            });
            await ok("docked to the screen: at the window's bottom-right while the page scrolls", async () => {
                const vw = await js('document.documentElement.clientWidth'), vh = await js('document.documentElement.clientHeight');
                const at = async () => { const b = await rect('toast'); return [b[0] + b[2], b[1] + b[3]]; };
                assert.deepStrictEqual(await at(), [Math.min(vw, 1000) - 20, vh - 20]);
                await js('window.scrollTo(0, 400); 1'); await wait(80);
                assert.strictEqual(await js('Math.round(window.scrollY)'), 400, 'the page scrolled');
                assert.deepStrictEqual(await at(), [Math.min(vw, 1000) - 20, vh - 20], 'still there');
            });
            await ok('no errors', async () => {
                assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            });
            return true;
        }, { width: 1000, height: 600, ready: "!!document.querySelector('[data-id=\"toast\"]')", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
