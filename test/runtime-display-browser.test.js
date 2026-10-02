'use strict';

// How a deployed screen sits in the browser window (screen.displayMode) and a
// scrolling frame, in headless Chrome at 800 x 450. Needs `npm run build`.
//   node test/runtime-display-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

const RECT = (id) => `(function () { var e = document.querySelector('[data-id="${id}"]') || document.getElementById("${id}"); var b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })()`;

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    const page = (mode, fn) => withPage(server.url + '/fx/runtime-display.html?mode=' + mode, fn, { width: 800, height: 450, ready: "!!document.querySelector('[data-id=\"i3\"]')", readyTries: 60 });
    try {
        const r = await page('fixed', async ({ js }) => {
            await ok('fixed: the exact design size, centred', async () => {
                assert.deepStrictEqual(await js(RECT('nexa-runtime-artboard')), [200, 20, 400, 300]);
            });
            await ok('a scrolling frame scrolls its overflow on the live page', async () => {
                const s = await js(`(function () { var f = document.querySelector('[data-id="list"]'); var cs = getComputedStyle(f); f.scrollTop = 40; return [cs.overflowY, cs.overflowX, f.clientHeight, f.scrollHeight, f.scrollTop]; })()`);
                assert.deepStrictEqual(s, ['auto', 'hidden', 100, 200, 40], '3 × 60 + 2 × 10 = 200 of content in 100');
            });
            return true;
        });
        if (r === null) return null;
        await page('fit', async ({ js }) => {
            await ok('fit: scaled to fit (450 / 300 = 1.5), proportions kept, centred', async () => {
                assert.deepStrictEqual(await js(RECT('nexa-runtime-artboard')), [100, 0, 600, 450]);
                assert.deepStrictEqual(await js(RECT('br')), [670, 420, 30, 30]);
            });
        });
        await page('fitWidth', async ({ js }) => {
            await ok('fitWidth: scaled to the width (800 / 400 = 2), scrolls down', async () => {
                assert.deepStrictEqual(await js(RECT('nexa-runtime-artboard')), [0, 0, 800, 600]);
                assert.strictEqual(await js('document.documentElement.scrollHeight >= 600'), true);
            });
        });
        await page('fill', async ({ js }) => {
            await ok('fill: the screen is the window, nothing scaled; constraints keep items to the edges', async () => {
                assert.deepStrictEqual(await js(RECT('nexa-runtime-artboard')), [0, 0, 800, 450]);
                assert.deepStrictEqual(await js(RECT('tl')), [0, 0, 20, 20]);
                assert.deepStrictEqual(await js(RECT('br')), [780, 430, 20, 20], 'right / bottom: 0 from the window edges');
            });
        });
        await page('fill&scale=0.5', async ({ js }) => {
            await ok('fill with scaleFactor=0.5: artboard virtual size is doubled, scaled by 0.5 to fill window', async () => {
                assert.deepStrictEqual(await js(RECT('nexa-runtime-artboard')), [0, 0, 800, 450]);
                const tr = await js('document.getElementById("nexa-runtime-artboard").style.transform');
                assert.strictEqual(tr, 'scale(0.5)');
            });
        });
        await page('fill&bpScales=' + encodeURIComponent(JSON.stringify({ md: 0.8, xs: 0.5 })), async ({ js }) => {
            await ok('fill with dynamic breakpointScales: 800px window matches md breakpoint and uses scale 0.8', async () => {
                assert.deepStrictEqual(await js(RECT('nexa-runtime-artboard')), [0, 0, 800, 450]);
                const tr = await js('document.getElementById("nexa-runtime-artboard").style.transform');
                assert.strictEqual(tr, 'scale(0.8)');
            });
        });
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
