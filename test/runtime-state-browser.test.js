'use strict';

// App state on a deployed page, in headless Chrome (docs/STATE.md): {$route}
// bindings, app variables seen through the template boundary, Set Variable
// operations, On Variable Change, Get Variable, the Function node API (vars,
// storage, cookies, http) and app variables persisted across a reload.
// Needs `npm run build`.   node test/runtime-state-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

const IDS = ['route', 'user', 'counter', 'log', 'items', 'cfg', 'flag', 'copy', 'fetched', 'badge::inT', 'apiItems', 'err', 'stored', 'cookie', 'flag2', 'cfg2', 'status', 'viaFn', 'badge::inT2'];

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-state.html', async ({ js, logs }) => {
            const texts = () => js(`(function () { var o = {}; ${JSON.stringify(IDS)}.forEach(function (id) { var e = document.querySelector('[data-id="' + id + '"]'); o[id] = e ? e.textContent : null; }); return o; })()`);
            const settle = async (want) => {
                for (let i = 0; i < 60; i++) {
                    const t = await texts();
                    if (Object.keys(want).every((k) => t[k] === want[k])) return t;
                    await js('new Promise(function (r) { setTimeout(r, 100); })');
                }
                const t = await texts();
                assert.deepStrictEqual(Object.fromEntries(Object.keys(want).map((k) => [k, t[k]])), want);
                return t;
            };

            await ok('mount: {$route} params / query; a template sees the app, not the screen', async () => {
                const t = await texts();
                assert.strictEqual(t.route, '42/alarms');
                assert.strictEqual(t['badge::inT'].split('|')[1], '{local}', 'the screen variable is not visible inside the instance');
            });
            await ok('Set Variable operations: increment, append (static + msg), merge, toggle; Get Variable', async () => {
                await settle({ counter: '5', items: '["a","b"]', cfg: '{"a":1,"b":2}', flag: 'true', copy: '5' });
            });
            await ok('On Variable Change -> Function: vars.set, storage, cookies, http', async () => {
                await settle({ log: '0->5', fetched: '123' });
                const side = await js(`(function () { return [localStorage.getItem("nexa-test"), document.cookie]; })()`);
                assert.strictEqual(side[0], '{"n":5}');
                assert.ok(/sid=abc%201/.test(side[1]), side[1]);
            });
            await ok('Function: getVariable() / setVariable(); a template\'s own variable of a type (UDT)', async () => {
                await settle({ viaFn: '10', 'badge::inT2': 'own motor' });
            });
            await ok('HTTP Request (URL with a {variable}; a 404 gives msg.error), Storage and Cookie set -> get', async () => {
                await settle({ apiItems: '["x","y"]', err: 'HTTP 404', stored: 'hello', cookie: 't-9' });
            });
            await ok('an app variable changed on the page shows through the template boundary', async () => {
                await settle({ user: 'ann', 'badge::inT': 'ann|{local}' });
            });
            await ok('a component writes to a variable, a path in one, the URL query; the message is read-only', async () => {
                const r = await js(`(async function () {
                    var w = window.__writers.wr, out = {};
                    await w.writeTag("toVar", true);
                    await w.writeTag("toPath", 5);
                    await w.writeTag("toQuery", "open");
                    try { await w.writeTag("toMsg", 1); out.msg = "written?!"; } catch (e) { out.msg = "refused"; }
                    out.url = location.search;
                    return out;
                })()`);
                await settle({ flag2: 'true', cfg2: '{"limit":5,"unit":"rpm"}', status: 'open' });
                assert.strictEqual(r.msg, 'refused');
                assert.ok(/status=open/.test(r.url), r.url);
            });
            await ok('persisted app variables survive a reload (local: the user; session: the counter)', async () => {
                const stored = await js('[localStorage.getItem("nexa:app:user"), sessionStorage.getItem("nexa:app:counter")]');
                assert.deepStrictEqual(stored, ['"ann"', '5']);
                await js('(function () { setTimeout(function () { location.reload(); }, 10); return 1; })()');
                await new Promise((res) => setTimeout(res, 1200));
                // after the reload the inject increments again from the restored 5
                const t = await settle({ user: 'ann', counter: '10' });
                assert.strictEqual(t.log, '5->10');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            // leave the headless profile clean
            await js('(function () { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return 1; })()');
            return true;
        }, { ready: "!!document.querySelector('[data-id=\"route\"]')", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
