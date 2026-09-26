'use strict';

// Frames + auto layout on a deployed page, in headless Chrome: the runtime
// client (lib/nexa-runtime-client.js) mounts a screen of frames with the
// layout CSS of lib/nexa-model-client.js, and the browser places the children.
// Also: a hidden frame shown by the Layer Control node gets its flex back.
// Needs `npm run build`.   node test/runtime-layout-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-frames.html', async ({ js, logs }) => {
            const box = (id) => js(`(function () { var ab = document.getElementById("nexa-runtime-artboard").getBoundingClientRect(), e = document.querySelector('[data-id="${id}"]');
                if (!e) return null; var b = e.getBoundingClientRect(); return [Math.round(b.left - ab.left), Math.round(b.top - ab.top), Math.round(b.width), Math.round(b.height)]; })()`);

            await ok('row: padding, gap, cross-axis centring, a fill child takes the rest', async () => {
                // the row sits at 20,20 with a 1px border and 8px padding: 62px of content height
                assert.deepStrictEqual(await box('a'), [29, 40, 60, 40], 'centred: (62 - 40) / 2 = 11');
                assert.deepStrictEqual(await box('b'), [97, 40, 226, 40], '400 - 2 - 16 - 60 - 80 - 2*8 = 226');
                assert.deepStrictEqual(await box('c'), [331, 45, 80, 30]);
            });
            await ok('an absolute child keeps its own x / y inside the frame', async () => {
                assert.deepStrictEqual(await box('abs'), [26, 26, 10, 10]);
            });
            await ok('grid: two 1fr columns, a span of two', async () => {
                assert.deepStrictEqual(await box('g1'), [454, 24, 94, 30]);
                assert.deepStrictEqual(await box('g2'), [552, 24, 30, 30], 'a fixed child sits at the start of its cell');
                assert.deepStrictEqual(await box('g3'), [454, 58, 192, 30]);
            });
            await ok('a hidden frame is drawn but not shown; shown again it hugs its content (flex back)', async () => {
                assert.strictEqual(await js('getComputedStyle(document.querySelector(\'[data-id="hug"]\')).display'), 'none');
                // an inject (once, after 600 ms) -> Layer Control "Hug": show
                await js('new Promise(function (r) { setTimeout(r, 900); })');
                assert.strictEqual(await js('getComputedStyle(document.querySelector(\'[data-id="hug"]\')).display'), 'flex');
                assert.deepStrictEqual(await box('hug'), [20, 200, 120, 65], '100 + 2*10 wide, 10 + 20 + 5 + 20 + 10 high');
                assert.deepStrictEqual(await box('h2'), [50, 235, 60, 20], 'centred across');
            });
            await ok('constraints: children of a frame that is wider live than designed keep to its edges', async () => {
                // inner: designed 100 wide, fills 400 (at x 120)
                assert.deepStrictEqual(await box('inner'), [120, 320, 400, 100]);
                assert.deepStrictEqual(await box('k-right'), [490, 320, 20, 20], 'right: 10 from the right edge');
                assert.deepStrictEqual(await box('k-lr'), [130, 350, 380, 20], 'left & right: 10 from both edges');
                assert.deepStrictEqual(await box('k-center'), [310, 380, 20, 20], 'center: 10 left of the middle');
                assert.deepStrictEqual(await box('k-scale'), [220, 405, 200, 10], 'scale: 25% / 50%');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { ready: "!!document.querySelector('[data-id=\"b\"]')", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
