'use strict';

// A virtual list (the Populate node's "Virtualize") on a deployed page, in
// headless Chrome: 100 000 items, but only the copies in (or near) the frame's
// scrolled view exist; scrolling mounts / unmounts them at their own position
// (column, grid, row); upsert / remove / prepend / clear keep working on the
// data, and a button inside a copy still gets msg.item.
// Needs `npm run build`.   node test/runtime-virtual-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

const N = 100000;

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-virtual.html', async ({ js, logs }) => {
            const wait = (ms) => new Promise((res) => setTimeout(res, ms));
            const send = (event, payload) => js(`(function () { var t = performance.now(); window.__ctx.ctl.emit(${JSON.stringify(event)}, ${payload}); return new Promise(function (r) { setTimeout(function () { r(Math.round(performance.now() - t)); }, 60); }); })()`);
            const items = (n, prefix) => `(function () { var a = []; for (var i = 0; i < ${n}; i++) a.push({ id: i, name: "${prefix || 'P'}" + i }); return a; })()`;
            // the copies that exist in a frame: [index text, top in the sizer, left]
            const copies = (frame) => js(`(function () {
                var s = document.querySelector('[data-virtual-sizer="${frame}"]'); if (!s) return null;
                return Array.from(s.children).map(function (e) { var t = e.querySelector('[data-id$="::title"]');
                    return [t ? t.textContent : null, e.offsetTop, e.offsetLeft]; });
            })()`);
            const scroll = (frame, prop, v) => js(`(function () { document.querySelector('[data-id="${frame}"]').${prop} = ${v}; return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(1); }); }); }); })()`);

            await ok('100 000 items: only a screenful of copies exist, the sizer is as tall as all of them', async () => {
                const ms = await send('replace', items(N));
                const c = await copies('list');
                assert.ok(c.length > 5 && c.length < 30, 'copies mounted: ' + c.length);
                assert.deepStrictEqual(c[0], ['0: P0', 0, 0]);
                assert.deepStrictEqual(c[1], ['1: P1', 44, 0], 'template 40 + gap 4');
                assert.strictEqual(await js(`document.querySelector('[data-virtual-sizer="list"]').getBoundingClientRect().height`), N * 44 - 4);
                assert.ok(ms < 1500, 'populate took ' + ms + ' ms');
                console.log('   (populate of ' + N + ': ' + ms + ' ms, ' + c.length + ' copies in the DOM)');
            });
            await ok('scrolling to the middle mounts the copies there (and unmounts the first ones)', async () => {
                await scroll('list', 'scrollTop', 50000 * 44);
                const c = await copies('list');
                assert.ok(c.length < 30, 'copies: ' + c.length);
                assert.ok(!c.some((x) => x[0] === '0: P0'), 'the first copy is gone');
                const mid = c.find((x) => x[0] === '50000: P50000');
                assert.ok(mid, 'copy 50000 is there: ' + JSON.stringify(c.slice(0, 3)));
                assert.strictEqual(mid[1], 50000 * 44);
                // and it is on screen: just below the frame's top edge (header 20 + gap 4 scrolled away)
                const top = await js(`(function () { var f = document.querySelector('[data-id="list"]').getBoundingClientRect(); var e = document.querySelector('[data-id="list#50000"]').getBoundingClientRect(); return Math.round(e.top - f.top); })()`);
                assert.ok(top >= 0 && top < 44, 'visible at ' + top);
            });
            await ok('upsert: a copy in view updates in place; one out of view shows its new data when scrolled to', async () => {
                await send('upsert', '[{ id: 50001, name: "NEW" }, { id: 7, name: "SEVEN" }]');
                assert.ok((await copies('list')).some((x) => x[0] === '50001: NEW'));
                await scroll('list', 'scrollTop', 0);
                const c = await copies('list');
                assert.ok(c.some((x) => x[0] === '7: SEVEN'), JSON.stringify(c.slice(0, 9)));
            });
            await ok('a button inside a copy gets msg.item', async () => {
                await js(`(function () { window.__ctx["list#3::buy"].emit("click", null); return new Promise(function (r) { setTimeout(r, 60); }); })()`);
                assert.strictEqual(await js(`document.querySelector('[data-id="last"]').textContent`), 'P3');
            });
            await ok('remove / prepend re-index the copies in view', async () => {
                await send('remove', '[{ id: 0 }, { id: 1 }]');
                let c = await copies('list');
                assert.deepStrictEqual(c[0], ['0: P2', 0, 0]);
                await send('prepend', '[{ id: "a", name: "A" }]');
                c = await copies('list');
                assert.deepStrictEqual(c.slice(0, 2), [['0: A', 0, 0], ['1: P2', 44, 0]]);
                assert.strictEqual(await js(`document.querySelector('[data-virtual-sizer="list"]').getBoundingClientRect().height`), (N - 1) * 44 - 4);
            });
            await ok('clear: no copies, an empty sizer', async () => {
                await send('clear', 'null');
                assert.deepStrictEqual(await copies('list'), []);
                assert.strictEqual(await js(`document.querySelector('[data-virtual-sizer="list"]').style.height`), '0px');
            });
            await ok('a grid: row x column, each copy fills its column; scrolling by rows', async () => {
                await send('grid', items(N, 'G'));
                let c = await copies('grid');
                assert.ok(c.length > 4 && c.length < 40, 'copies: ' + c.length);
                assert.deepStrictEqual(c.slice(0, 3), [['0: G0', 0, 0], ['1: G1', 0, 325], ['2: G2', 50, 0]], '(640 - 10) / 2 = 315 wide, + 10 gap = x 325; rows 40 + 10');
                assert.strictEqual(await js(`document.querySelector('[data-id="grid#1"]').style.width`), '315px');
                await scroll('grid', 'scrollTop', 1000 * 50);
                c = await copies('grid');
                assert.ok(c.some((x) => x[0] === '2000: G2000' && x[1] === 50000 && x[2] === 0), JSON.stringify(c.slice(0, 4)));
            });
            await ok('a row (through a Layout node): along x, scrolled horizontally', async () => {
                await send('row', items(N, 'R'));
                let c = await copies('row');
                assert.ok(c.length > 2 && c.length < 20, 'copies: ' + c.length);
                assert.deepStrictEqual(c.slice(0, 2), [['0: R0', 0, 0], ['1: R1', 0, 310]]);
                await scroll('row', 'scrollLeft', 9000 * 310);
                c = await copies('row');
                assert.ok(c.some((x) => x[0] === '9000: R9000' && x[2] === 9000 * 310), JSON.stringify(c.slice(0, 3)));
            });
            await wait(10);
            return { logs };
        }, { width: 1300, height: 900, ready: '!!(window.__ctx && window.__ctx.ctl)' });
        if (r === null) return null; // no Chrome: skipped
        const errors = (r.logs || []).filter((l) => /error|exception/i.test(l));
        assert.deepStrictEqual(errors, [], 'page errors');
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
