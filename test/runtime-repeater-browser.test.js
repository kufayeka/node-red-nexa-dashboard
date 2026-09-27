'use strict';

// The repeater on a deployed page, in headless Chrome: the "Populate" Logic
// node fills a column frame with a template, one card per item — each item
// passed into the param the template declares ("product"), plus index — keyed by id — replace, upsert (the same card updated in
// place), remove, prepend, reorder, clear — and each card's own Logic runs per
// card: a Buy button inside it gets msg.item, and its HTTP Request posts {item}.
// Needs `npm run build`.   node test/runtime-repeater-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-repeater.html', async ({ js, logs }) => {
            const send = (event, payload) => js(`(function () { window.__ctx.ctl.emit(${JSON.stringify(event)}, ${JSON.stringify(payload)}); return new Promise(function (r) { setTimeout(r, 60); }); })()`);
            // the cards in the frame, in DOM order: [id, text, top]
            const cards = () => js(`(function () {
                var f = document.querySelector('[data-id="list"]'), fb = f.getBoundingClientRect();
                return Array.from(f.children).filter(function (e) { return /#/.test(e.getAttribute("data-id") || ""); }).map(function (e) {
                    var t = e.querySelector('[data-id$="::title"]'); return [e.getAttribute("data-id"), t ? t.textContent : null, Math.round(e.getBoundingClientRect().top - fb.top)]; });
            })()`);

            await ok('replace: one card per item after the frame\'s own children, laid out by the column', async () => {
                await send('replace', [{ id: 1, name: 'Kopi', price: 45 }, { id: 2, name: 'Teh', price: 30 }]);
                assert.deepStrictEqual(await cards(), [['list#1', '0: Kopi @ 45', 24], ['list#2', '1: Teh @ 30', 68]], 'header 20 + gap 4, then 40 + 4');
            });
            await ok('upsert by key: the SAME card is updated in place (not re-created); a new key is added', async () => {
                await js('(function () { window.__card2 = document.querySelector(\'[data-id="list#2"]\'); return 1; })()');
                await send('upsert', [{ id: 2, name: 'Teh Manis', price: 32 }, { id: 3, name: 'Susu', price: 20 }]);
                assert.deepStrictEqual((await cards()).map((c) => c[1]), ['0: Kopi @ 45', '1: Teh Manis @ 32', '2: Susu @ 20']);
                assert.strictEqual(await js('window.__card2 === document.querySelector(\'[data-id="list#2"]\')'), true);
            });
            await ok('remove by key (an object or the key itself); the others re-index', async () => {
                await send('remove', [{ id: 1 }]);
                assert.deepStrictEqual((await cards()).map((c) => c[1]), ['0: Teh Manis @ 32', '1: Susu @ 20']);
                assert.strictEqual(await js('!!document.querySelector(\'[data-id="list#1::title"]\')'), false, 'its DOM is gone');
            });
            await ok('prepend; replace with a new order keeps cards by key and orders them', async () => {
                await send('prepend', [{ id: 9, name: 'Air', price: 5 }]);
                assert.deepStrictEqual((await cards()).map((c) => c[0]), ['list#9', 'list#2', 'list#3']);
                await send('replace', [{ id: 3, name: 'Susu', price: 20 }, { id: 9, name: 'Air', price: 5 }]);
                assert.deepStrictEqual((await cards()).map((c) => c[1]), ['0: Susu @ 20', '1: Air @ 5']);
            });
            await ok('the card\'s own Logic: Buy -> msg.item (Set Variable) and an HTTP POST with body {item}', async () => {
                await js('(function () { window.__ctx["list#9::buy"].emit("click", null); return new Promise(function (r) { setTimeout(r, 150); }); })()');
                assert.strictEqual(await js('document.querySelector(\'[data-id="last"]\').textContent'), 'Air');
                const posted = await js('window.__posted');
                assert.strictEqual(posted.length, 1);
                assert.strictEqual(posted[0].url, '/api/order/9');
                assert.deepStrictEqual(JSON.parse(posted[0].body), { id: 9, name: 'Air', price: 5 });
            });
            await ok('a removed card\'s Logic is gone with it; clear empties the list (the frame\'s own children stay)', async () => {
                await send('clear', null);
                assert.deepStrictEqual(await cards(), []);
                assert.strictEqual(await js('document.querySelector(\'[data-id="head"]\').textContent'), 'Products');
            });
            await ok('Populate -> two Layout nodes (two rows): the same data fills both, each row keeps its own list', async () => {
                await send('both', { id: 7, name: 'Roti', price: 12 });
                await send('both', { id: 8, name: 'Gula', price: 9 });
                const rows = await js(`(function () { return ["rowA", "rowB"].map(function (r) { return Array.from(document.querySelector('[data-id="' + r + '"]').children).map(function (e) { return e.getAttribute("data-id") + "=" + e.querySelector('[data-id$="::title"]').textContent; }); }); })()`);
                assert.deepStrictEqual(rows, [['rowA#7=0: Roti @ 12', 'rowA#8=1: Gula @ 9'], ['rowB#7=0: Roti @ 12', 'rowB#8=1: Gula @ 9']]);
                assert.deepStrictEqual(await cards(), [], 'the other container is untouched');
            });
            await ok('On the live page: a template set to fill the width fills it, up to its max; inside, its constraints follow', async () => {
                await send('wide', [{ id: 1, name: 'W1' }]);
                const r = await js(`(function () { var c = document.querySelector('[data-id="wideCol#1"]'), t = document.querySelector('[data-id="wideCol#1::t"]');
                    return [Math.round(c.getBoundingClientRect().width), Math.round(t.getBoundingClientRect().width), t.textContent]; })()`);
                assert.deepStrictEqual(r, [300, 300, 'W1'], 'the column is 400 wide; the template at most 300; its label keeps to both edges');
            });
            await ok('Send to Host: a copy\'s message comes out of ITS Layout node (msg.output / item / index); a placed instance\'s out of its On Template Output node', async () => {
                const click = (id) => js(`(function () { window.__ctx[${JSON.stringify(id)}].emit("click", null); return new Promise(function (r) { setTimeout(r, 80); }); })()`);
                const text = (id) => js(`document.querySelector('[data-id="${id}"]').textContent`);
                await click('rowA#8::buy');
                assert.strictEqual(await text('last'), 'Gula', "the copy's own Logic ran too");
                assert.strictEqual(await text('vOut'), 'remove:Gula@1', 'out of Layout rowA, with the output name, the item and its index');
                await click('rowB#7::buy');
                assert.strictEqual(await text('vOut'), 'remove:Gula@1', "a copy in rowB comes out of rowB's Layout node (not wired here), not rowA's");
                await click('inst::buy');
                assert.strictEqual(await text('vInst'), 'remove', 'a placed instance: its On Template Output node for that output');
                assert.strictEqual(await text('vOther'), '', 'the node listening to another output did not fire');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { ready: "!!(window.__ctx && window.__ctx.ctl)", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
