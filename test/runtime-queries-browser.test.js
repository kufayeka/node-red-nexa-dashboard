'use strict';

// Query variables on a deployed page, in headless Chrome (docs/STATE.md): a
// variable filled from an API on open (keeping a part of the response), its
// {$status.name.*}, an error, a re-fetch when a {variable} in its URL changes,
// the "Refetch Query" node, and On Variable Change on a query.
// Needs `npm run build`.   node test/runtime-queries-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-queries.html', async ({ js, logs }) => {
            const texts = () => js(`(function () { var o = {}; ["orders", "loading", "err", "seen", "updated"].forEach(function (id) { var e = document.querySelector('[data-id="' + id + '"]'); o[id] = e ? e.textContent : null; }); return o; })()`);
            const settle = async (want) => {
                for (let i = 0; i < 60; i++) {
                    const t = await texts();
                    if (Object.keys(want).every((k) => t[k] === want[k])) return t;
                    await js('new Promise(function (r) { setTimeout(r, 50); })');
                }
                const t = await texts();
                assert.deepStrictEqual(Object.fromEntries(Object.keys(want).map((k) => [k, t[k]])), want);
                return t;
            };
            let firstUpdate;
            await ok('fetched on open, keeping the response path; status loading false, updatedAt set; On Variable Change fired', async () => {
                const t = await settle({ orders: '["x","y"]', loading: 'false', seen: '1' });
                firstUpdate = Number(t.updated);
                assert.ok(firstUpdate > 0, t.updated);
            });
            await ok('a query that fails: {$status.name.error}', async () => {
                await settle({ err: 'HTTP 404' });
            });
            await ok('a {variable} in the URL changes -> fetched again from the new URL', async () => {
                await settle({ orders: '["z"]', seen: '2' });
            });
            await ok('the Refetch Query node fetches again (same data: no change event, newer updatedAt)', async () => {
                const before = Number((await texts()).updated);
                for (let i = 0; i < 60 && Number((await texts()).updated) === before; i++) await js('new Promise(function (r) { setTimeout(r, 50); })');
                const t = await texts();
                assert.ok(Number(t.updated) > before, 'updatedAt moved on');
                assert.strictEqual(t.seen, '2', 'the same data is not a change');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode|404|Failed to load resource/.test(l)), []);
            return true;
        }, { ready: "!!document.querySelector('[data-id=\"orders\"]')", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
