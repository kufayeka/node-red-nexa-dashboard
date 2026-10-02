'use strict';

// Dialogs and drawers on a deployed page, in headless Chrome: hidden until a Logic "Open"
// node runs; a dialog centred on the page over a backdrop, a drawer along the right side
// of the frame it is in; closed by a button inside (a "Close" node, with a result — the
// "Open" node continues with it, and only then), the backdrop, Esc (the top one of a stack first), a
// timer; its On Open event; dragged, kept inside its scope.
// Needs `npm run build`.   node test/runtime-overlay-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-overlay.html', async ({ js, send, logs }) => {
            const wait = (ms) => js(`new Promise(function (r) { setTimeout(r, ${ms}); })`);
            const emit = async (id, event, payload) => { await js(`(function () { window.__ctx[${JSON.stringify(id)}].emit(${JSON.stringify(event)}, ${JSON.stringify(payload === undefined ? null : payload)}); return 1; })()`); await wait(60); };
            const shown = (id) => js(`(function () { var l = document.querySelector('[data-overlay="${id}"]'); return !!l && getComputedStyle(l).display !== "none"; })()`);
            const rect = (sel) => js(`(function () { var b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })()`);
            const text = (id) => js(`document.querySelector('[data-id="${id}"]').textContent`);
            const z = (id) => js(`Number(document.querySelector('[data-overlay="${id}"]').style.zIndex)`);
            const key = async (k) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: 27 }); await wait(60); };

            await ok('hidden until opened', async () => {
                assert.deepStrictEqual([await shown('dlg'), await shown('drw'), await shown('dlg2')], [false, false, false]);
            });
            await ok('Open: the dialog centred on the page over a backdrop; its On Open event gets what it was opened with', async () => {
                await emit('ctl', 'open', 'hello');
                assert.strictEqual(await shown('dlg'), true);
                assert.deepStrictEqual(await rect('[data-id="dlg"]'), [350, 200, 300, 200], '1000 × 600 window: centred');
                assert.deepStrictEqual(await rect('[data-overlay="dlg"] .nexa-overlay-backdrop'), [0, 0, 1000, 600]);
                assert.strictEqual(await text('ow'), 'hello');
                assert.strictEqual(await text('res'), '', 'the Open node passes nothing on while the dialog is open');
            });
            await ok('a button inside -> Close with msg.payload: the Open node continues with the result, closedBy "node"', async () => {
                await emit('ok', 'click');
                assert.strictEqual(await shown('dlg'), false);
                assert.strictEqual(await text('res'), '"saved":node');
            });
            await ok('the backdrop closes it (result null, closedBy "backdrop")', async () => {
                await emit('ctl', 'open');
                await js(`document.querySelector('[data-overlay="dlg"] .nexa-overlay-backdrop').click(); 1`);
                await wait(60);
                assert.strictEqual(await shown('dlg'), false);
                assert.strictEqual(await text('res'), 'null:backdrop');
            });
            await ok('stacked: the second opens on top (top right, 20 from the edges); Esc closes the top one, then the next', async () => {
                await emit('ctl', 'open');
                await emit('ctl', 'open2');
                assert.ok(await z('dlg2') > await z('dlg'), 'on top');
                assert.deepStrictEqual(await rect('[data-id="dlg2"]'), [780, 20, 200, 100]);
                await key('Escape');
                assert.deepStrictEqual([await shown('dlg2'), await shown('dlg')], [false, true]);
                assert.strictEqual(await text('res'), 'second:esc');
                await key('Escape');
                assert.strictEqual(await shown('dlg'), false);
                assert.strictEqual(await text('res'), 'null:esc');
            });
            await ok('a drawer in a frame: along its right side, its full height; the backdrop covers that frame only', async () => {
                await emit('ctl', 'drawer');
                assert.strictEqual(await shown('drw'), true);
                assert.deepStrictEqual(await rect('[data-id="drw"]'), [750, 100, 150, 300], 'the panel is 500..900 × 100..400');
                assert.deepStrictEqual(await rect('[data-overlay="panel::drw"], [data-overlay="drw"]'), [500, 100, 400, 300]);
                await emit('ctl', 'top');   // "Close the top overlay"
                assert.strictEqual(await shown('drw'), false);
            });
            await ok('in a frame that scrolls: the drawer covers the part in view, and stays there while it scrolls', async () => {
                await js(`document.querySelector('[data-id="sc"]').scrollTop = 300; 1`);
                await emit('ctl', 'scd');
                // the frame is 100..400 × 350..550 on the page; its view is that less its scrollbar
                const cw = await js(`document.querySelector('[data-id="sc"]').clientWidth`);
                assert.deepStrictEqual(await rect('[data-id="scd"]'), [100 + cw - 100, 350, 100, 200], 'along the right of what is in view (left of the scrollbar)');
                assert.deepStrictEqual(await rect('[data-overlay="scd"] .nexa-overlay-backdrop'), [100, 350, cw, 200]);
                await js(`document.querySelector('[data-id="sc"]').scrollTop = 450; 1`);
                await wait(80);
                assert.deepStrictEqual(await rect('[data-id="scd"]'), [100 + cw - 100, 350, 100, 200], 'scrolled further: still in view');
                await key('Escape');
            });
            await ok('a timer closes it (closedBy "timer")', async () => {
                await emit('ctl', 'timed');
                assert.strictEqual(await shown('tmr'), true);
                await wait(400);
                assert.strictEqual(await shown('tmr'), false);
                assert.strictEqual(await text('res'), 'timed:timer');
            });
            await ok('draggable: it follows the pointer, and stays inside its scope', async () => {
                await emit('ctl', 'drag');
                const start = await rect('[data-id="drg"]');
                const at = { x: start[0] + 150, y: start[1] + 60 };
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + 50, y: at.y + 30, buttons: 1 });
                const moved = await rect('[data-id="drg"]');
                assert.deepStrictEqual([moved[0] - start[0], moved[1] - start[1]], [50, 30]);
                await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 999, y: 599, buttons: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 999, y: 599, button: 'left', buttons: 0, clickCount: 1 });
                const clamped = await rect('[data-id="drg"]');
                assert.deepStrictEqual([clamped[0] + clamped[2], clamped[1] + clamped[3]], [1000, 600], 'at the bottom right corner, not beyond');
                await key('Escape');
            });
            await ok('animated: it settles open (scale, opacity 1)', async () => {
                await emit('ctl', 'anim');
                await wait(250);
                const st = await js(`(function () { var e = document.querySelector('[data-id="anim"]'); return [getComputedStyle(e).opacity, e.style.transform]; })()`);
                assert.deepStrictEqual(st, ['1', 'none']);
                await key('Escape');
                await wait(250);
                assert.strictEqual(await shown('anim'), false, 'hidden after its closing animation');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { width: 1000, height: 600, ready: "!!(window.__ctx && window.__ctx.ctl)", readyTries: 60 });
        if (r === null) return null;
        // the page scaled to the window's width (0.5) and scrolled: a dialog in the middle of what is in view
        await withPage(server.url + '/fx/runtime-overlay.html?fitWidth', async ({ js, logs }) => {
            await ok('a scaled page, scrolled: the dialog and its backdrop are where the window is', async () => {
                await js('window.scrollTo(0, 300); new Promise(function (r) { setTimeout(r, 80); })');
                await js(`(function () { window.__ctx.ctl.emit("open", null); return new Promise(function (r) { setTimeout(r, 80); }); })()`);
                const box = (sel) => js(`(function () { var b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })()`);
                assert.deepStrictEqual(await box('[data-id="dlg"]'), [175, 150, 150, 100], '300 × 200 at 0.5, centred in the 500 × 400 window');
                assert.deepStrictEqual(await box('[data-overlay="dlg"] .nexa-overlay-backdrop'), [0, 0, 500, 400]);
                await js('window.scrollTo(0, 500); new Promise(function (r) { setTimeout(r, 80); })');
                assert.deepStrictEqual(await box('[data-id="dlg"]'), [175, 150, 150, 100], 'scrolled further: it stays');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
        }, { width: 500, height: 400, ready: "!!(window.__ctx && window.__ctx.ctl)", readyTries: 60 });
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
