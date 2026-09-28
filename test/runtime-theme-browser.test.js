'use strict';

// The theme on a deployed page, in headless Chrome: every token a CSS variable; props
// bound to {token:…} show the value in the colour mode, a frame's token fill / gap /
// radius are CSS variables; Set Variable $colorMode switches light / dark in place (the
// labels redraw, the frame follows by CSS), kept for this browser; "system" follows the
// viewer's setting; an app's own theme (primary palette, its own scale); NexaSDK.theme.
// Needs `npm run build`.   node test/runtime-theme-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/dist': path.join(__dirname, '..', 'dist'), '/fx': path.join(__dirname, 'fixtures') } });
    const opts = { width: 800, height: 400, ready: "!!(window.__ctx && window.__ctx.ctl)", readyTries: 60 };
    try {
        const r = await withPage(server.url + '/fx/runtime-theme.html', async ({ js, logs }) => {
            const wait = (ms) => js(`new Promise(function (r) { setTimeout(r, ${ms}); })`);
            const text = (id) => js(`document.querySelector('[data-id="${id}"]').textContent`);
            const cs = (id, p) => js(`getComputedStyle(document.querySelector('[data-id="${id}"]')).${p}`);
            const mode = async (m) => { await js(`(function () { window.__ctx.ctl.emit("mode", ${JSON.stringify(m)}); return 1; })()`); await wait(80); };
            await js('localStorage.removeItem("nexa:colorMode"); 1');

            await ok('light (the default): token props show their values; the frame uses the CSS variables', async () => {
                assert.deepStrictEqual([await text('fg'), await text('prim'), await text('mix'), await text('mode')], ['#161616', '#0f62fe', 'size 18px', 'light']);
                assert.strictEqual(await cs('box', 'backgroundColor'), 'rgb(244, 244, 244)');
                assert.strictEqual(await cs('box', 'columnGap'), '16px');
                assert.strictEqual(await cs('box', 'borderTopLeftRadius'), '6px');
                assert.strictEqual(await js(`getComputedStyle(document.documentElement).getPropertyValue("--nexa-colors-blue-600").trim()`), '#0f62fe');
            });
            await ok('Set Variable $colorMode = dark: in place — the labels redraw, the frame follows by CSS', async () => {
                await mode('dark');
                assert.strictEqual(await js('document.documentElement.getAttribute("data-nexa-mode")'), 'dark');
                assert.deepStrictEqual([await text('fg'), await text('mode')], ['#f4f4f4', 'dark']);
                assert.strictEqual(await cs('box', 'backgroundColor'), 'rgb(38, 38, 38)');
                assert.strictEqual(await js('window.NexaSDK.theme.mode() + " " + window.NexaSDK.theme.token("colors.bg")'), 'dark #161616', 'components: NexaSDK.theme');
            });
            await ok('kept for this browser: opened again, still dark', async () => {
                assert.strictEqual(await js('localStorage.getItem("nexa:colorMode")'), 'dark');
                await js('location.reload(); 1');
                await js('new Promise(function (r) { setTimeout(r, 800); })');
                assert.deepStrictEqual([await text('fg'), await text('mode')], ['#f4f4f4', 'dark']);
                await mode('light');
                assert.strictEqual(await text('fg'), '#161616');
                await js('localStorage.removeItem("nexa:colorMode"); 1');
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, opts);
        if (r === null) return null;
        await withPage(server.url + '/fx/runtime-theme.html?system', async ({ js, send }) => {
            await ok('"system": the viewer\'s setting (dark here)', async () => {
                await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
                await js('localStorage.removeItem("nexa:colorMode"); location.reload(); 1');
                await js('new Promise(function (r) { setTimeout(r, 800); })');
                assert.deepStrictEqual([await js(`document.querySelector('[data-id="mode"]').textContent`), await js('document.documentElement.getAttribute("data-nexa-mode")')], ['dark', 'dark']);
            });
        }, opts);
        await withPage(server.url + '/fx/runtime-theme.html?own', async ({ js }) => {
            await ok('the app\'s own theme: primary green, its own font sizes', async () => {
                await js('localStorage.removeItem("nexa:colorMode"); 1');
                assert.strictEqual(await js(`document.querySelector('[data-id="prim"]').textContent`), '#198038');
                assert.strictEqual(await js(`document.querySelector('[data-id="body"]').textContent`), '15');
            });
        }, opts);
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
