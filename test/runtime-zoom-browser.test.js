'use strict';

// A zoomable frame on a deployed page, in headless Chrome — exactly the editor's canvas:
// the frame clips and scrolls both ways; its scrollbars stay (they are not zoomed) and
// their length follows the zoom; only the content zooms (the editor's toolbar − 100% ○ + ⤢,
// 20 % steps; Ctrl + wheel at the pointer) and pans (scrolling, a drag on the background);
// zoomed out it is centred; a double click goes back to the start; nothing is drawn
// outside the frame; the rest of the screen keeps its size.
// Needs `npm run build`.   node test/runtime-zoom-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-zoom.html', async ({ js, send, logs }) => {
            const frames = () => js('new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(r, 30); }); }); })');
            // a node's box relative to a frame: [x, y, w, h]
            const box = (id, frame) => js(`(function () { var f = document.querySelector('[data-id="${frame || "zf"}"]').getBoundingClientRect(), b = document.querySelector('[data-id="${id}"]').getBoundingClientRect();
                return [Math.round(b.left - f.left), Math.round(b.top - f.top), Math.round(b.width), Math.round(b.height)]; })()`);
            const tool = (title, frame) => js(`(function () { Array.from(document.querySelectorAll('[data-id="${frame || "zf"}"] .nexa-zoom-toolbar button')).find(function (b) { return b.title === ${JSON.stringify(title)}; }).click(); return 1; })()`);
            const level = () => js(`document.querySelector('[data-id="zf"] .nexa-zoom-level').textContent`);
            const vp = (frame, prop) => js(`document.querySelector('[data-id="${frame}"] .nexa-zoom-viewport').${prop}`);
            const setVp = (frame, prop, v) => js(`(function () { document.querySelector('[data-id="${frame}"] .nexa-zoom-viewport').${prop} = ${v}; return 1; })()`);
            const api = (frame, code) => js(`(function () { var z = document.querySelector('[data-id="${frame}"]').__zoom; ${code}; return 1; })()`);
            const at = (frame, x, y) => js(`(function () { var r = document.querySelector('[data-id="${frame}"]').getBoundingClientRect(); return { x: r.left + ${x}, y: r.top + ${y} }; })()`);
            const mouse = (type, x, y, n) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: n || 1 });
            const dblclick = async (p) => { await mouse('mousePressed', p.x, p.y); await mouse('mouseReleased', p.x, p.y); await mouse('mousePressed', p.x, p.y, 2); await mouse('mouseReleased', p.x, p.y, 2); };
            await frames();

            await ok('the editor\'s toolbar: − 100% ○ + ⤢; starts at 100 %; the node outside is 100 x 100', async () => {
                const titles = await js(`Array.from(document.querySelectorAll('[data-id="zf"] .nexa-zoom-toolbar > *')).map(function (e) { return e.title || e.textContent; })`);
                assert.deepStrictEqual(titles, ['Zoom out', '100%', 'Reset zoom', 'Zoom in', 'Zoom to fit']);
                assert.deepStrictEqual(await box('a'), [0, 0, 100, 100]);
                assert.deepStrictEqual((await box('out', 'zf')).slice(2), [100, 100]);
            });
            await ok('"+": a 20 % step; the frame keeps its size, only the content grows', async () => {
                await tool('Zoom in'); await frames();
                assert.strictEqual(await level(), '120%');
                assert.deepStrictEqual((await box('zf', 'zf')).slice(2), [400, 300]);
                assert.deepStrictEqual((await box('a')).slice(2), [120, 120]);
                assert.deepStrictEqual((await box('out', 'zf')).slice(2), [100, 100], 'outside: unchanged');
            });
            await ok('200 %: the frame scrolls over 800 x 600; its toolbar stays put while it scrolls; no scrolling past the content', async () => {
                await api('zf', 'z.reset(); z.zoomTo(2, 0, 0)'); await frames();
                assert.deepStrictEqual([await vp('zf', 'scrollWidth'), await vp('zf', 'scrollHeight')], [800, 600]);
                const barTop = () => js(`Math.round(document.querySelector('[data-id="zf"] .nexa-zoom-toolbar').getBoundingClientRect().top)`);
                const bar0 = await barTop();
                await setVp('zf', 'scrollTop', 200); await frames();
                assert.strictEqual(await barTop(), bar0, 'the toolbar did not scroll');
                assert.deepStrictEqual((await box('b')).slice(0, 2), [600, 200], 'b at (300, 200) * 2, scrolled 200 up');
                await setVp('zf', 'scrollLeft', 99999); await frames();
                const maxLeft = await js(`(function () { var v = document.querySelector('[data-id="zf"] .nexa-zoom-viewport'); return v.scrollWidth - v.clientWidth; })()`);
                assert.strictEqual(await vp('zf', 'scrollLeft'), maxLeft, 'no further than the content');
            });
            await ok('nothing is drawn outside the frame: zoomed in, the content is clipped to it', async () => {
                const clip = await js(`(function () { var f = document.querySelector('[data-id="zf"]'); return getComputedStyle(f).overflowX + " " + getComputedStyle(f).overflowY; })()`);
                assert.strictEqual(clip, 'hidden hidden');
                const p = await at('zf', 410, 50);
                const hit = await js(`(function () { var e = document.elementFromPoint(${p.x}, ${p.y}); return e && e.closest('[data-id="zf"]') ? "inside" : "outside"; })()`);
                assert.strictEqual(hit, 'outside');
            });
            await ok('Ctrl + wheel: a step at the pointer (the point under it stays), up to the max; a plain wheel scrolls', async () => {
                await tool('Reset zoom'); await frames();
                const p = await at('zf', 300, 200);
                await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: -120, modifiers: 2 });
                await frames();
                assert.strictEqual(await level(), '120%');
                const b = await box('b');
                assert.ok(Math.abs(b[0] - 300) <= 1 && Math.abs(b[1] - 200) <= 1, 'the point under the pointer stayed: ' + b);
                for (let i = 0; i < 20; i++) await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: -120, modifiers: 2 });
                await frames();
                assert.strictEqual(await level(), '400%', 'at most the max');
                const top0 = await vp('zf', 'scrollTop');
                await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: -100 });
                await frames(); await js('new Promise(function (r) { setTimeout(r, 250); })');
                assert.ok((await vp('zf', 'scrollTop')) < top0, 'a plain wheel scrolled (' + top0 + ' -> ' + (await vp('zf', 'scrollTop')) + ')');
                assert.strictEqual(await level(), '400%', 'and did not zoom');
            });
            await ok('"−" stops at the min; zoomed out, the content is centred and nothing scrolls; "⤢" fits', async () => {
                for (let i = 0; i < 20; i++) await tool('Zoom out');
                await frames();
                assert.strictEqual(await level(), '50%');
                assert.deepStrictEqual(await box('a'), [100, 75, 50, 50], '(400 - 200) / 2, (300 - 150) / 2');
                assert.deepStrictEqual([await vp('zf', 'scrollWidth'), await vp('zf', 'scrollHeight')], [400, 300]);
                await tool('Zoom to fit'); await frames();
                assert.strictEqual(await level(), '100%', 'the content is the frame\'s size: fit = 100 %');
            });
            await ok('a drag on the background scrolls (the editor\'s pan)', async () => {
                await api('zf', 'z.reset(); z.zoomTo(3, 0, 0)'); await frames();
                // the background (a covers 0..300 at 300 %: a drag on a component does not pan)
                const p = await at('zf', 350, 60);
                await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y);
                for (let i = 1; i <= 5; i++) await mouse('mouseMoved', p.x - i * 10, p.y - i * 6);
                await mouse('mouseReleased', p.x - 50, p.y - 30); await frames();
                assert.deepStrictEqual([await vp('zf', 'scrollLeft'), await vp('zf', 'scrollTop')], [50, 30], 'dragged left / up = scrolled right / down');
            });
            await ok('a double click goes back to the start (100 %, at the top left)', async () => {
                await dblclick(await at('zf', 250, 60)); await frames();
                assert.strictEqual(await level(), '100%');
                assert.deepStrictEqual([await vp('zf', 'scrollLeft'), await vp('zf', 'scrollTop')], [0, 0]);
                assert.deepStrictEqual(await box('a'), [0, 0, 100, 100]);
            });
            await ok('the toolbar can be hidden; the zoom still works (and a double click resets it)', async () => {
                assert.strictEqual(await js('document.querySelector(\'[data-id="zi"] .nexa-zoom-toolbar\').style.display'), 'none');
                await api('zi', 'z.zoomTo(2, 0, 0)'); await frames();
                assert.deepStrictEqual((await box('c', 'zi')).slice(2), [200, 200]);
                await dblclick(await at('zi', 250, 60)); await frames();
                assert.deepStrictEqual(await box('c', 'zi'), [0, 0, 100, 100]);
            });
            await ok("a frame bigger on the page than designed (Fill): at the start its content keeps the frame's size, not the design's", async () => {
                assert.deepStrictEqual((await box('zw', 'zw')).slice(2), [600, 150], 'the frame: 600 x 150 on the page');
                assert.strictEqual(await js(`document.querySelector('[data-id="zw"] .nexa-zoom-level').textContent`), '100%', 'fit = 100 %');
                assert.deepStrictEqual((await box('wide', 'zw')).slice(2), [600, 40], 'its fill child fills it');
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
