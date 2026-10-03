'use strict';

// Binding priority lists on a deployed page, in headless Chrome: screen / app / shared read their
// own layer, an expression, a message source fed by an Update Component node (never overwritten),
// fields of list items, a tag source subscribed and falling through to static while unknown.
// Needs `npm run build`.   node test/runtime-binding-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-binding.html', async ({ js, logs }) => {
            const texts = () => js(`(function () { var o = {}; ["a", "b", "c", "d", "e", "f", "g"].forEach(function (id) { var e = document.querySelector('[data-id="' + id + '"]'); o[id] = e ? e.textContent : null; }); return o; })()`);
            const settle = async (want) => {
                for (let i = 0; i < 50; i++) {
                    if (JSON.stringify(await texts()) === JSON.stringify(want)) return;
                    await js('new Promise(function (r) { setTimeout(r, 100); })');
                }
                assert.deepStrictEqual(await texts(), want);
            };
            await ok('mount: the first source with a value; each layer its own; expression; list item fields; static last', async () => {
                assert.deepStrictEqual(await texts(), {
                    a: 'App title',     // the screen's "empty" is null: falls through to the app's title
                    b: 'Plant A',       // shared, not the app's "site"
                    c: '10 rpm',
                    d: 'waiting',       // no message yet, "empty" is null: static
                    e: 'off',           // the tag is unknown: static
                    f: 'screen title',  // a legacy string still reads the nearest
                    g: 'App title,Tab 2'
                });
            });
            await ok('a tag in a binding list is subscribed', async () => {
                const keys = await js('Object.keys(window.__nexaRuntime.state.sparkplugBindingIndex)');
                assert.ok(keys.includes('G::E::D::M'), JSON.stringify(keys));
            });
            await ok('Update Component: a message source picks it up; the list itself is never overwritten', async () => {
                await settle({ a: 'App title', b: 'Plant A', c: '10 rpm', d: 'hello', e: 'off', f: 'screen title', g: 'App title,Tab 2' });
                const raw = await js(`JSON.stringify(window.__nexaRuntime.state.sparkplugBoundComponents.map(function (e) { return e.screen; })[0].components.filter(function (c) { return c.id === "b" || c.id === "d"; }).map(function (c) { return c.props.text; }))`);
                assert.ok(JSON.parse(raw).every((t) => t && Array.isArray(t.$bind)), raw);
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { ready: "!!document.querySelector('[data-id=\"g\"]')", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
