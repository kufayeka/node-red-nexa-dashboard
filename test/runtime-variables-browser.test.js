'use strict';

// Variables on a deployed page, in headless Chrome: the lexical scope chain
// (screen -> frame -> group -> node, the nearest declaration wins), the
// "Set Variable" Logic node on a frame's scope and on the screen's, and the
// template boundary (inside an instance only its params are seen; what
// crosses is passed in through its paramValues, re-resolved when a variable
// they bind to changes). Needs `npm run build`.
//   node test/runtime-variables-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-variables.html', async ({ js, logs }) => {
            // the injects fire on timers: wait (up to 5 s) for the expected state instead of sleeping
            const settle = async (want) => {
                for (let i = 0; i < 50; i++) {
                    if (JSON.stringify(await texts()) === JSON.stringify(want)) return;
                    await js('new Promise(function (r) { setTimeout(r, 100); })');
                }
                assert.deepStrictEqual(await texts(), want);
            };
            const texts = () => js(`(function () { var o = {}; ["root", "deep", "shadowed", "card::inT"].forEach(function (id) { var e = document.querySelector('[data-id="' + id + '"]'); o[id] = e ? e.textContent : null; }); return o; })()`);

            await ok('mount: nearest declaration wins; outside a scope its names stay as written; a template sees only its params', async () => {
                assert.deepStrictEqual(await texts(), {
                    root: 'L1:3:{label}',            // "label" is declared inside Panel only
                    deep: 'L1/outer',                // through the group (no scope of its own) to Panel, then the screen
                    shadowed: 'L1/shadow',           // Inner declares its own "label"
                    'card::inT': 'outer@L1/{line}'   // who = "{label}@{line}" resolved outside; {line} is not visible inside
                });
            });
            await ok('Set Variable on Panel: everything inside that does not shadow it follows, the instance gets it passed in', async () => {
                await settle({ root: 'L1:3:{label}', deep: 'L1/changed', shadowed: 'L1/shadow', 'card::inT': 'changed@L1/{line}' });
            });
            await ok('Set Variable on the screen (from msg.payload): seen through every scope', async () => {
                await settle({ root: 'L2:3:{label}', deep: 'L2/changed', shadowed: 'L2/shadow', 'card::inT': 'changed@L2/{line}' });
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { ready: "!!document.querySelector('[data-id=\"deep\"]')", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
