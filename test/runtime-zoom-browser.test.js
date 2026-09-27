'use strict';

// A zoomable frame on a deployed page, in headless Chrome: what is inside zooms
// (buttons, Ctrl + wheel at the pointer, within min / max, fit) and pans (a drag
// on its background), while a node outside it keeps its size.
// Needs `npm run build`.   node test/runtime-zoom-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-zoom.html', async ({ js, send, logs }) => {
            const frames = () => js('new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(r, 30); }); }); })');
            // a node's box relative to the frame: [x, y, w, h]
            const box = (id, frame) => js(`(function () { var f = document.querySelector('[data-id="${frame || "zf"}"]').getBoundingClientRect(), b = document.querySelector('[data-id="${id}"]').getBoundingClientRect();
                return [Math.round(b.left - f.left), Math.round(b.top - f.top), Math.round(b.width), Math.round(b.height)]; })()`);
            const button = (title) => js(`(function () { Array.from(document.querySelectorAll('[data-id="zf"] .nexa-zoom-controls button')).find(function (b) { return b.title === ${JSON.stringify(title)}; }).click(); return 1; })()`);
            const level = () => js(`document.querySelector('[data-id="zf"] .nexa-zoom-level').textContent`);
            await frames();

            await ok('starts at 100 %; the buttons are there; the node outside is 100 x 100', async () => {
                assert.deepStrictEqual(await box('a'), [0, 0, 100, 100]);
                assert.strictEqual(await level(), '100%');
                assert.deepStrictEqual((await box('out', 'zf')).slice(2), [100, 100]);
            });
            await ok('"+" zooms in about the middle; only the frame\'s content grows', async () => {
                await button('Zoom in'); await frames();
                assert.strictEqual(await level(), '125%');
                const a = await box('a');
                assert.deepStrictEqual(a.slice(2), [125, 125]);
                assert.deepStrictEqual(a.slice(0, 2), [-50, -37], 'about (200, 150): 200 - 200 * 1.25 = -50; 150 - 150 * 1.25 = -37.5');
                assert.deepStrictEqual((await box('out', 'zf')).slice(2), [100, 100], 'outside: unchanged');
            });
            await ok('Ctrl + wheel zooms at the pointer (the point under it stays), up to the max', async () => {
                await button('Actual size'); await frames();
                const f = await js(`(function () { var r = document.querySelector('[data-id="zf"]').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
                // the pointer on b's corner (300, 200): it stays there
                await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: f.x + 300, y: f.y + 200, deltaX: 0, deltaY: -462, modifiers: 2 });
                await frames();
                const b = await box('b');
                assert.deepStrictEqual(b.slice(0, 2), [300, 200], 'the point under the pointer stayed');
                assert.ok(b[2] > 150, 'zoomed in: ' + b[2]);
                for (let i = 0; i < 6; i++) await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: f.x + 300, y: f.y + 200, deltaX: 0, deltaY: -800, modifiers: 2 });
                await frames();
                assert.strictEqual(await level(), '400%', 'at most the max');
                // a wheel without Ctrl does not zoom
                await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: f.x + 300, y: f.y + 200, deltaX: 0, deltaY: 300 });
                await frames();
                assert.strictEqual(await level(), '400%');
            });
            await ok('zoom out stops at the min; Fit shows all the content', async () => {
                for (let i = 0; i < 12; i++) await button('Zoom out');
                await frames();
                assert.strictEqual(await level(), '50%');
                await button('Fit'); await frames();
                assert.strictEqual(await level(), '100%', 'the content is the frame\'s size: fit = 100 %');
                assert.deepStrictEqual(await box('a'), [0, 0, 100, 100]);
            });
            await ok('a drag on the background pans the content', async () => {
                await button('Zoom in'); await button('Zoom in'); await frames();
                const before = await box('a');
                const f = await js(`(function () { var r = document.querySelector('[data-id="zf"]').getBoundingClientRect(); return { x: r.left + 250, y: r.top + 60 }; })()`);
                const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
                await mouse('mouseMoved', f.x, f.y); await mouse('mousePressed', f.x, f.y);
                for (let i = 1; i <= 5; i++) await mouse('mouseMoved', f.x - i * 8, f.y + i * 4);
                await mouse('mouseReleased', f.x - 40, f.y + 20); await frames();
                const after = await box('a');
                assert.deepStrictEqual([after[0] - before[0], after[1] - before[1]], [-40, 20]);
            });
            await ok('content bigger than the frame, starting at Fit: all of it in view (50 %)', async () => {
                assert.deepStrictEqual(await box('big', 'zfit'), [0, 0, 400, 300]);
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { width: 1100, height: 800, ready: "!!document.querySelector('[data-id=\"zf\"] .nexa-zoom-stage')", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
