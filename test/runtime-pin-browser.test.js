'use strict';

// "When scrolling" on a deployed page, in headless Chrome: a Fixed header stays at
// the top of the view, a Fixed footer (Bottom constraint) at its bottom, a Sticky
// node scrolls until it reaches the top and then stays; inside a scrolling frame
// the same for its children; a sticky child of a scrolling column (CSS sticky).
// Needs `npm run build`.   node test/runtime-pin-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-pin.html', async ({ js, logs }) => {
            const frames = () => js('new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(r, 30); }); }); })');
            const top = (id) => js(`Math.round(document.querySelector('[data-id="${id}"]').getBoundingClientRect().top)`);
            const bottom = (id) => js(`Math.round(document.querySelector('[data-id="${id}"]').getBoundingClientRect().bottom)`);
            await frames();
            const H = await js('window.innerHeight');

            await ok('unscrolled: each where it was designed; the footer (Bottom, Fixed) already at the view\'s bottom', async () => {
                const art = await top('hdr');
                assert.strictEqual(await top('stk'), art + 300);
                assert.strictEqual(await bottom('ftr'), H, 'the screen is 2000 high, the view ' + H + ': the footer sits at the bottom of the view');
            });
            await ok('the page scrolled 600: the header stays at the top, the footer at the bottom; the sticky one reached the top and stays', async () => {
                await js('window.scrollTo(0, 600); 1'); await frames();
                assert.strictEqual(await top('hdr'), 0);
                assert.strictEqual(await bottom('ftr'), H);
                assert.strictEqual(await top('stk'), 0);
            });
            await ok('scrolled back to 100: the sticky one is back in the content (100 above the top it sticks to)', async () => {
                await js('window.scrollTo(0, 100); 1'); await frames();
                assert.strictEqual(await top('stk'), 200);
                assert.strictEqual(await top('hdr'), 0);
            });
            await ok('scrolled to the end: the footer is where it was designed (the bottom of the screen)', async () => {
                await js('window.scrollTo(0, 99999); 1'); await frames();
                assert.strictEqual(await bottom('ftr'), H);
                await js('window.scrollTo(0, 0); 1'); await frames();
            });
            await ok('inside a scrolling frame: its Fixed child stays at the frame\'s top; its Sticky one sticks once reached', async () => {
                const sfTop = await top('sf');
                assert.strictEqual(await top('sfStk'), sfTop + 150);
                await js('document.querySelector(\'[data-id="sf"]\').scrollTop = 400; 1'); await frames();
                assert.strictEqual(await top('sfFix'), sfTop);
                assert.strictEqual(await top('sfStk'), sfTop, 'reached (150 < 400): at the top');
                await js('document.querySelector(\'[data-id="sf"]\').scrollTop = 50; 1'); await frames();
                assert.strictEqual(await top('sfStk'), sfTop + 100, 'not yet: in the content');
            });
            await ok('a scrolling column: its sticky header (in the flow) stays at the top, the rows scroll under it', async () => {
                const colTop = await top('col');
                await js('document.querySelector(\'[data-id="col"]\').scrollTop = 300; 1'); await frames();
                assert.strictEqual(await top('head'), colTop);
                assert.ok(await top('r5') < colTop, 'the rows moved up');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { width: 1100, height: 800, ready: "!!document.querySelector('[data-id=\"hdr\"]')", readyTries: 60 });
        if (r === null) return null;
        // the screen scaled to the window's width (Fit width, 1100 / 800): the page's scroll is undone in the screen's px
        await withPage(server.url + '/fx/runtime-pin-fit.html', async ({ js }) => {
            const frames = () => js('new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(r, 30); }); }); })');
            const rect = (id) => js(`(function () { var b = document.querySelector('[data-id="${id}"]').getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; })()`);
            await frames();
            const H = await js('window.innerHeight');
            await ok('scaled screen (Fit width): scrolled, the header at the top, the footer at the bottom, the sticky one at the top', async () => {
                await js('window.scrollTo(0, 900); 1'); await frames();
                assert.strictEqual((await rect('hdr'))[0], 0);
                assert.ok(Math.abs((await rect('ftr'))[1] - H) <= 1, 'footer bottom ' + (await rect('ftr'))[1] + ' vs ' + H);
                assert.strictEqual((await rect('stk'))[0], 0);
            });
            return true;
        }, { width: 1100, height: 800, ready: "!!document.querySelector('[data-id=\"hdr\"]')", readyTries: 60 });
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
