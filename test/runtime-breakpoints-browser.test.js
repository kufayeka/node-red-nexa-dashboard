'use strict';

// Breakpoints on a deployed page, in headless Chrome: the screen is designed at xl
// (1280 wide); the window's band (xs … 3xl, the app's defaults) applies the overrides
// from the design to it — a row becomes a column (md), a node hides (sm, saved as
// "phone" before the bands), a text and a width change (sm), a text only wider than
// the design (3xl) — and crossing one while the page is open applies them in place;
// {$breakpoint} and On Variable Change follow. Bound props with no value show their
// fallback. Needs `npm run build`.   node test/runtime-breakpoints-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-breakpoints.html', async ({ js, send, logs }) => {
            const frames = () => js('new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(r, 60); }); }); })');
            const width = async (w) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false }); await frames(); };
            const box = (id) => js(`(function () { var b = document.querySelector('[data-id="${id}"]').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })()`);
            const shown = (id) => js(`getComputedStyle(document.querySelector('[data-id="${id}"]')).display !== "none"`);
            const text = (id) => js(`document.querySelector('[data-id="${id}"]').textContent`);

            await ok('xl (1300 wide, the design): as designed — a row, all shown; {$breakpoint} = xl', async () => {
                await width(1300);
                assert.strictEqual(await text('bp'), 'xl');
                const a = await box('a'), b = await box('b');
                assert.deepStrictEqual([a[1] === b[1], b[0] - a[0]], [true, 110], 'side by side: 100 + gap 10');
                assert.strictEqual(await shown('side'), true);
                assert.strictEqual(await text('big'), 'big');
            });
            await ok('bound, no value yet: each prop shows its fallback', async () => {
                assert.strictEqual(await text('fb'), '— no value —');
                assert.strictEqual(await text('fb2'), 'waiting');
            });
            await ok('narrowed to 900 (md), in place: the row is a column; On Variable Change fired', async () => {
                await width(900);
                assert.strictEqual(await text('bp'), 'md');
                const a = await box('a'), b = await box('b');
                assert.deepStrictEqual([a[0] === b[0], b[1] - a[1]], [true, 50], 'stacked: 40 + gap 10');
                assert.strictEqual(await text('log'), '>md');
                assert.strictEqual(await shown('side'), true, 'sm\'s override is not md\'s');
            });
            await ok('500 (xs): still a column (from md); the side hidden (sm, saved as Phone); the title\'s text and width changed', async () => {
                await width(500);
                assert.strictEqual(await text('bp'), 'xs');
                const a = await box('a'), b = await box('b');
                assert.strictEqual(a[0], b[0], 'md\'s column carries down');
                assert.strictEqual(await shown('side'), false);
                assert.strictEqual(await text('title'), 'Phone title');
                assert.strictEqual((await box('title'))[2], 120);
                assert.strictEqual(await text('big'), 'big', 'the 3xl override is not for a narrow window');
                assert.strictEqual(await text('log'), '>md>xs');
            });
            await ok('2000 (3xl, wider than the design): its own override; the narrower ones\' are not applied', async () => {
                await width(2000);
                assert.strictEqual(await text('bp'), '3xl');
                assert.strictEqual(await text('big'), 'Big screen');
                assert.strictEqual(await shown('side'), true);
                assert.strictEqual(await text('title'), 'title');
                const a = await box('a'), b = await box('b');
                assert.strictEqual(a[1], b[1], 'a row');
            });
            await ok('back to 1300: exactly the design again', async () => {
                await width(1300);
                assert.strictEqual(await text('bp'), 'xl');
                assert.strictEqual(await shown('side'), true);
                assert.strictEqual(await text('title'), 'title');
                assert.strictEqual((await box('title'))[2], 200);
                assert.strictEqual(await text('big'), 'big');
                assert.strictEqual(await text('log'), '>md>xs>3xl>xl');
            });
            await ok('opened narrow (a phone): drawn at xs from the start', async () => {
                await width(400);
                await js('location.reload(); 1');
                await js('new Promise(function (r) { setTimeout(r, 800); })');
                assert.strictEqual(await text('bp'), 'xs');
                assert.strictEqual(await shown('side'), false);
                assert.strictEqual(await text('title'), 'Phone title');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { width: 1300, height: 800, ready: "!!document.querySelector('[data-id=\"bp\"]')", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
