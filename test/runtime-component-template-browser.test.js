'use strict';

// Proves that a template with kind="component" (a "component template") renders
// its inner text component directly — no canvas wrapper — both as a static
// @template instance on the screen AND when items are populated by a Populate
// logic node into a vertical frame.
//
// Screenshots are saved next to this file for visual proof.
// Needs `npm run build`.   node test/runtime-component-template-browser.test.js   (skipped without Chrome)

const assert  = require('assert');
const path    = require('path');
const fs      = require('fs');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({
        mounts: {
            '/lib': path.join(__dirname, '..', 'lib'),
            '/fx' : path.join(__dirname, 'fixtures')
        }
    });
    try {
        const r = await withPage(
            server.url + '/fx/runtime-component-template.html',
            async ({ js, send, logs }) => {
                const wait = (ms) => js(`new Promise(function(r){ setTimeout(r,${ms}); })`);

                // ── Helpers ────────────────────────────────────────────────
                const textOf = (id) => js(`(function(){
                    var e = document.querySelector('[data-id="${id}"]');
                    return e ? e.textContent : null;
                })()`);
                const rect = (id) => js(`(function(){
                    var e = document.querySelector('[data-id="${id}"]');
                    if(!e) return null;
                    var b = e.getBoundingClientRect();
                    return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
                })()`);
                const exists = (id) => js(`!!document.querySelector('[data-id="${id}"]')`);
                const emit = (compId, event, payload) => js(`(function(){
                    var ctx = window.__ctx[${JSON.stringify(compId)}];
                    if(!ctx) throw new Error('no ctx for ' + ${JSON.stringify(compId)});
                    ctx.emit(${JSON.stringify(event)}, ${JSON.stringify(payload)});
                    return new Promise(function(r){ setTimeout(r, 120); });
                })()`);
                const screenshot = async (name) => {
                    const r2 = await send('Page.captureScreenshot', { format: 'png' });
                    const outPath = path.join(__dirname, '..', name);
                    fs.writeFileSync(outPath, Buffer.from(r2.result.data, 'base64'));
                    console.log('  📷 screenshot:', outPath);
                };

                // ── Wait for ctl ctx ───────────────────────────────────────
                for (let i = 0; i < 30 && !(await js('!!window.__ctx && !!window.__ctx["ctl"]')); i++) await wait(100);

                // ── 1. Static component-template instance ──────────────────
                await ok('static component-template: outer element directly shows "Hello Nexa"', async () => {
                    // For a component template, the outer [data-id="static"] IS the rendered element
                    // (not a canvas wrapper). The text component renders directly into it.
                    const t = await textOf('static');
                    console.log('  [data-id="static"] textContent =', JSON.stringify(t));
                    assert.strictEqual(t, 'Hello Nexa');
                });

                await ok('static instance: no extra inner canvas wrapper div', async () => {
                    // Composite templates have: [data-id="static"] > div[no data-id] > children
                    // Component templates must NOT have that extra wrapper div
                    const wrapperCount = await js(`(function(){
                        var outer = document.querySelector('[data-id="static"]');
                        if(!outer) return -1;
                        return Array.from(outer.children).filter(function(c){
                            return c.tagName === 'DIV' && !c.hasAttribute('data-id');
                        }).length;
                    })()`);
                    console.log('  extra wrapper divs inside static:', wrapperCount);
                    assert.strictEqual(wrapperCount, 0, 'component template should not have a canvas-wrapper div');
                });

                await ok('static instance: data-component-id links to inner component', async () => {
                    const compId = await js(`document.querySelector('[data-id="static"]').getAttribute('data-component-id')`);
                    console.log('  data-component-id:', compId);
                    assert.ok(compId && compId.indexOf('::lbl') !== -1, 'should have data-component-id pointing to inner lbl');
                });

                await ok('static instance: x=10, w=200, h=30', async () => {
                    const r = await rect('static');
                    console.log('  rect(static):', r);
                    // y may have a small browser-offset (scrollbar/viewport). Assert x and size.
                    assert.ok(r && r[0] === 10 && r[2] === 200 && r[3] === 30, 'expected x=10, w=200, h=30 — got ' + JSON.stringify(r));
                });

                // ── Screenshot after static checks ─────────────────────────
                await screenshot('test-component-template-static.png');

                // ── 2. Populate component-template into a container ─────────
                const items = [
                    { id: 1, name: 'Item Satu' },
                    { id: 2, name: 'Item Dua' },
                    { id: 3, name: 'Item Tiga' }
                ];
                await emit('ctl', 'populate', items);

                await ok('populate 3 items → 3 elements in list frame', async () => {
                    const count = await js(`(function(){
                        var list = document.querySelector('[data-id="list"]');
                        return Array.from(list.children).filter(function(e){
                            return /#/.test(e.getAttribute('data-id') || '');
                        }).length;
                    })()`);
                    console.log('  item count in list:', count);
                    assert.strictEqual(count, 3);
                });

                await ok('populated items: text interpolated from item.name', async () => {
                    const texts = await js(`(function(){
                        var list = document.querySelector('[data-id="list"]');
                        return Array.from(list.children)
                            .filter(function(e){ return /#/.test(e.getAttribute('data-id') || ''); })
                            .map(function(e){ return e.textContent.trim(); });
                    })()`);
                    console.log('  item texts:', texts);
                    assert.deepStrictEqual(texts, ['Item Satu', 'Item Dua', 'Item Tiga']);
                });

                await ok('populated items: vertical layout (gap=4, height=30 each)', async () => {
                    const tops = await js(`(function(){
                        var list = document.querySelector('[data-id="list"]');
                        var lb = list.getBoundingClientRect();
                        return Array.from(list.children)
                            .filter(function(e){ return /#/.test(e.getAttribute('data-id') || ''); })
                            .map(function(e){ return Math.round(e.getBoundingClientRect().top - lb.top); });
                    })()`);
                    console.log('  item tops:', tops);
                    // gap=4, height=30 → tops: 0, 34, 68
                    assert.deepStrictEqual(tops, [0, 34, 68]);
                });

                await ok('populated item: no extra canvas wrapper (direct component inject)', async () => {
                    const wrapperCount = await js(`(function(){
                        var item = document.querySelector('[data-id="list#1"]');
                        if(!item) return -1;
                        return Array.from(item.children).filter(function(c){
                            return c.tagName === 'DIV' && !c.hasAttribute('data-id');
                        }).length;
                    })()`);
                    console.log('  extra wrapper divs inside list#1:', wrapperCount);
                    assert.strictEqual(wrapperCount, 0, 'no canvas wrapper for component template items');
                });

                await ok('populated item: data-component-id points to inner lbl component', async () => {
                    const compId = await js(`document.querySelector('[data-id="list#1"]').getAttribute('data-component-id')`);
                    console.log('  list#1 data-component-id:', compId);
                    assert.ok(compId && compId.indexOf('::lbl') !== -1);
                });

                // ── Screenshot after populate checks ───────────────────────
                await screenshot('test-component-template-populated.png');

                // ── 3. Replace with new data ───────────────────────────────
                await emit('ctl', 'populate', [{ id: 10, name: 'Kopi Susu' }, { id: 11, name: 'Teh Tarik' }]);

                await ok('replace: list updated with new items, old items gone', async () => {
                    const texts = await js(`(function(){
                        var list = document.querySelector('[data-id="list"]');
                        return Array.from(list.children)
                            .filter(function(e){ return /#/.test(e.getAttribute('data-id') || ''); })
                            .map(function(e){ return e.textContent.trim(); });
                    })()`);
                    console.log('  texts after replace:', texts);
                    assert.deepStrictEqual(texts, ['Kopi Susu', 'Teh Tarik']);
                    // Old items must be gone
                    const old = await exists('list#1');
                    assert.strictEqual(old, false, 'old list#1 should be removed');
                });

                await screenshot('test-component-template-replaced.png');

                // ── 4. No console errors ───────────────────────────────────
                await ok('no console errors / exceptions', async () => {
                    const errors = logs.filter((l) => !/dev mode/.test(l));
                    if (errors.length) console.log('  errors:', errors);
                    assert.deepStrictEqual(errors, []);
                });

                return true;
            },
            {
                width: 800, height: 600,
                ready: '!!window.__ctx && !!window.__ctx["ctl"]',
                readyTries: 60
            }
        );
        if (r === null) { console.log('ALL OK (Chrome not available — test skipped)'); return null; }
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main()
    .then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
