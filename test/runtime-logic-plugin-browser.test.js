'use strict';

// A plugin's Logic node (the SDK's defineLogicNode) on a deployed page, in headless Chrome:
// the plugin module registers after the runtime started, the onload chains wait for it, then
// it runs: a binding resolved (ctx.resolve), output 1 async (ctx.nextPort), output 2 on bad input.
// Needs `npm run build`.   node test/runtime-logic-plugin-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-logic-plugin.html', async ({ js, logs }) => {
            const wait = (ms) => js(`new Promise(function (r) { setTimeout(r, ${ms}); })`);
            await wait(400);
            await ok('the plugin registered its node type in the page\'s one registry', async () => {
                const m = await js('(function () { var r = window.__nexaLogicRegistry; var m = r && r.metas.get("acme-scale"); return m ? { plugin: m.plugin, outputs: m.outputs, section: m.palette.section } : null; })()');
                assert.deepStrictEqual(m, { plugin: true, outputs: 2, section: 'Acme' });
            });
            await ok('the onload chain waited for it, then ran it: the binding resolved, output 1 (async)', async () => {
                assert.deepStrictEqual(await js('window.__out'), [12]);
            });
            await ok('bad input: output 2 with msg.error', async () => {
                assert.deepStrictEqual(await js('window.__err'), ['v is not a number']);
            });
            assert.deepStrictEqual(logs.filter((l) => !/favicon/.test(l)), [], 'no page errors');
            return true;
        }, { width: 400, height: 200, ready: 'document.readyState === "complete"' });
        if (r === null) return;
    } finally {
        server.close();
    }
    console.log(passed + ' passed');
    console.log('ALL OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
