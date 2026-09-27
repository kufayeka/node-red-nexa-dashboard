'use strict';

// Breakpoints on a deployed page, in headless Chrome: the window's width picks the
// breakpoint (desktop / tablet < 1024 / phone < 768); its overrides apply — a row
// becomes a column, a node hides, a text and a width change — and crossing one while
// the page is open applies them in place; {$breakpoint} and On Variable Change follow.
// Needs `npm run build`.   node test/runtime-breakpoints-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-breakpoints.html', async ({ js, send, logs }) => {
            const frames = () => js('new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(r, 60); }); }); })');
            const width = async (w) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false }); await frames(); };
            const box = (id) => js(`(function () { var b = document.querySelector('[data-id="${id}"]').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })()`);
            const shown = (id) => js(`getComputedStyle(document.querySelector('[data-id="${id}"]')).display !== "none"`);
            const text = (id) => js(`document.querySelector('[data-id="${id}"]').textContent`);

            await ok('desktop (1100 wide): as designed — a row, all shown; {$breakpoint} = desktop', async () => {
                await width(1100);
                assert.strictEqual(await text('bp'), 'desktop');
                const a = await box('a'), b = await box('b');
                assert.deepStrictEqual([a[1] === b[1], b[0] - a[0]], [true, 110], 'side by side: 100 + gap 10');
                assert.strictEqual(await shown('side'), true);
            });
            await ok('narrowed to 900 (tablet), in place: the row is a column; On Variable Change fired', async () => {
                await width(900);
                assert.strictEqual(await text('bp'), 'tablet');
                const a = await box('a'), b = await box('b');
                assert.deepStrictEqual([a[0] === b[0], b[1] - a[1]], [true, 50], 'stacked: 40 + gap 10');
                assert.strictEqual(await text('log'), '>tablet');
            });
            await ok('500 (phone): still a column (from the tablet); the side hidden; the title\'s text and width changed', async () => {
                await width(500);
                assert.strictEqual(await text('bp'), 'phone');
                const a = await box('a'), b = await box('b');
                assert.strictEqual(a[0], b[0], 'the tablet\'s column carries down');
                assert.strictEqual(await shown('side'), false);
                assert.strictEqual(await text('title'), 'Phone title');
                assert.strictEqual((await box('title'))[2], 120);
                assert.strictEqual(await text('log'), '>tablet>phone');
            });
            await ok('back to 1100: exactly the desktop design again', async () => {
                await width(1100);
                assert.strictEqual(await text('bp'), 'desktop');
                assert.strictEqual(await shown('side'), true);
                assert.strictEqual(await text('title'), 'title');
                assert.strictEqual((await box('title'))[2], 200);
                const a = await box('a'), b = await box('b');
                assert.strictEqual(a[1], b[1], 'a row again');
                assert.strictEqual(await text('log'), '>tablet>phone>desktop');
            });
            await ok('opened narrow (a phone): drawn at the phone from the start', async () => {
                await width(400);
                await js('location.reload(); 1');
                await js('new Promise(function (r) { setTimeout(r, 800); })');
                assert.strictEqual(await text('bp'), 'phone');
                assert.strictEqual(await shown('side'), false);
                assert.strictEqual(await text('title'), 'Phone title');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { width: 1100, height: 800, ready: "!!document.querySelector('[data-id=\"bp\"]')", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
