'use strict';

// The dashboard's Image component (lib/components/media.js) and the nx-asset
// picker, in headless Chrome with the SDK testkit: the source ({asset:name}, a
// name, a URL, a binding), the state map, the tint, load / error / fallback,
// lazy loading, a change of the asset list, and the inspector's picker.
// Needs `npm run build`.   node test/media-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withHarness } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

// real images as data: URLs (they load), and one that does not
const RED = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>');
const GREEN = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="green"/></svg>');
const BLUE = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="blue"/></svg>');
const BROKEN = 'data:image/png;base64,AAAA';

const r = withHarness({
    mounts: { '/nexa-dashboard-media/vendor': path.join(__dirname, '..', 'lib', 'components') },
    modules: ['/nexa-dashboard-media/vendor/media.js']
}, async ({ js }) => {
    const settle = () => js('NexaTest.settle()');
    const wait = (ms) => js(`new Promise(function (r) { setTimeout(r, ${ms}); })`);
    await js(`NexaSDK.setAssets([
        { name: "off", url: ${JSON.stringify(RED)}, type: "image/svg+xml", w: 4, h: 4 },
        { name: "on", url: ${JSON.stringify(GREEN)}, type: "image/svg+xml", w: 4, h: 4 },
        { name: "icons/motor", url: ${JSON.stringify(BLUE)}, type: "image/svg+xml", w: 4, h: 4 },
        { name: "broken", url: ${JSON.stringify(BROKEN)}, type: "image/png" }
    ]); true`);
    // what one Image shows: the <img> (src, style, loading), the tint layer, the editor placeholder
    const view = (name) => js(`(function () {
        var root = NexaTest.wc(${JSON.stringify(name)}).renderRoot, img = root.querySelector("img"), tint = root.querySelector(".tint"), empty = root.querySelector(".empty");
        return { src: img ? img.getAttribute("src") : null, hidden: img ? img.classList.contains("hidden") : null, loading: img ? img.getAttribute("loading") : null,
            opacity: img ? img.style.opacity : null, fit: img ? img.style.objectFit : null, tint: tint ? { bg: tint.style.backgroundColor, mask: tint.style.maskImage || tint.style.webkitMaskImage } : null,
            empty: empty ? empty.textContent.trim() : null };
    })()`);

    await ok('registered: "Image" in the Media category, with its events', async () => {
        const d = await js('(function () { var d = NEXA.getComponent("kufayeka-image"); return { label: d.label, category: d.category, events: d.events.map(function (e) { return e.name; }) }; })()');
        assert.deepStrictEqual(d, { label: 'Image', category: 'Media', events: ['click', 'load', 'error'] });
    });

    await ok('the source: {asset:name}, a plain asset name (what a variable holds), a URL; nothing for an unknown one', async () => {
        await js('NexaTest.mount("a", "kufayeka-image", { src: "{asset:on}" }, { width: 40, height: 40 })');
        await js('NexaTest.mount("b", "kufayeka-image", { src: "icons/motor" }, { width: 40, height: 40 })');
        await js(`NexaTest.mount("c", "kufayeka-image", { src: ${JSON.stringify(GREEN)} }, { width: 40, height: 40 })`);
        await js('NexaTest.mount("d", "kufayeka-image", { src: "{asset:nope}" }, { width: 40, height: 40 })');
        await js('NexaTest.mount("e", "kufayeka-image", { src: "{asset:nope}" }, { width: 40, height: 40, design: true })');
        await settle();
        assert.strictEqual((await view('a')).src, GREEN);
        assert.strictEqual((await view('b')).src, BLUE);
        assert.strictEqual((await view('c')).src, GREEN);
        const d = await view('d');
        assert.deepStrictEqual([d.src, d.empty], [null, null], 'a deployed page shows nothing');
        assert.strictEqual((await view('e')).empty, 'Image not found', 'the editor says so');
    });

    await ok('bound to a template param / variable holding an asset name: {param1.image}', async () => {
        await js('NexaTest.setVariable("param1", { image: "off" })');
        await js('NexaTest.mount("v", "kufayeka-image", { src: "{param1.image}" }, { width: 40, height: 40 })'); await settle();
        assert.strictEqual((await view('v')).src, RED);
        await js('NexaTest.setVariable("param1", { image: "on" })'); await settle();
        assert.strictEqual((await view('v')).src, GREEN, 'follows it');
    });

    await ok('state map: the row whose value matches shows its image; none matches: the Image', async () => {
        const rows = JSON.stringify([{ value: '0', src: '{asset:off}' }, { value: '1', src: '{asset:on}' }]);
        await js(`NexaTest.mount("s", "kufayeka-image", { src: "{asset:icons/motor}", stateMap: ${rows}, stateValue: "1" }, { width: 40, height: 40 })`); await settle();
        assert.strictEqual((await view('s')).src, GREEN);
        await js('NexaTest.setProps("s", { stateValue: 0 })'); await settle();
        assert.strictEqual((await view('s')).src, RED, 'a number matches its text');
        await js('NexaTest.setProps("s", { stateValue: "7" })'); await settle();
        assert.strictEqual((await view('s')).src, BLUE);
    });

    await ok('tint: the shape painted one colour (a CSS mask), the image itself hidden', async () => {
        await js('NexaTest.mount("t", "kufayeka-image", { src: "{asset:icons/motor}", tint: "#ff0000", fit: "cover" }, { width: 40, height: 40 })'); await settle();
        const t = await view('t');
        assert.strictEqual(t.hidden, true);
        assert.strictEqual(t.tint.bg, 'rgb(255, 0, 0)');
        assert.ok(t.tint.mask.indexOf('data:image/svg+xml') !== -1, t.tint.mask);
    });

    await ok('loading: lazy by default, eager on request; load fires once and the fade ends', async () => {
        await js('NexaTest.mount("l", "kufayeka-image", { src: "{asset:on}" }, { width: 40, height: 40 })');
        await js('NexaTest.mount("l2", "kufayeka-image", { src: "{asset:on}", loading: "eager" }, { width: 40, height: 40 })');
        await wait(150); await settle();
        const l = await view('l');
        assert.deepStrictEqual([l.loading, (await view('l2')).loading], ['lazy', 'eager']);
        assert.strictEqual(l.opacity, '1', 'faded in');
        const ev = await js('NexaTest.item("l").events.filter(function (e) { return e[0] === "load"; }).length');
        assert.strictEqual(ev, 1);
    });

    await ok('a broken image: the error event, then the fallback', async () => {
        await js('NexaTest.mount("x", "kufayeka-image", { src: "{asset:broken}", fallback: "{asset:off}" }, { width: 40, height: 40 })');
        await wait(200); await settle();
        assert.strictEqual((await view('x')).src, RED);
        assert.strictEqual(await js('NexaTest.item("x").events.filter(function (e) { return e[0] === "error"; }).length'), 1);
    });

    await ok('the asset list changes (an import in the Assets tab): the image follows', async () => {
        await js(`NexaSDK.setAssets(NexaSDK.listAssets().map(function (a) { return a.name === "on" ? Object.assign({}, a, { url: ${JSON.stringify(BLUE)} }) : a; })); true`);
        await settle();
        assert.strictEqual((await view('a')).src, BLUE);
    });

    await ok('the inspector: nx-asset lists the images, a click picks {asset:name}; Import… uploads through the host and picks it', async () => {
        const res = await js(`(async function () {
            var host = { uploadAssets: function (files) { return Promise.resolve([{ name: "uploaded/" + files[0].name }]); } };
            var ins = NexaTest.inspector("kufayeka-image", {}, host);
            await NexaTest.wait(80);
            var picker = ins.box.querySelector("nx-asset");
            picker.querySelector(".nx-asset-current").click(); await NexaTest.wait();
            var out = { tiles: Array.from(picker.querySelectorAll(".nx-asset-tile span:last-child")).map(function (s) { return s.textContent; }) };
            Array.from(picker.querySelectorAll(".nx-asset-tile")).find(function (t) { return /icons\\/motor/.test(t.textContent); }).click(); await NexaTest.wait();
            out.picked = ins.props.src;
            out.shown = picker.querySelector(".nx-asset-name").textContent.trim();
            picker.querySelector(".nx-asset-current").click(); await NexaTest.wait();
            var input = picker.querySelector(".nx-asset-file");
            var dt = new DataTransfer(); dt.items.add(new File(["x"], "logo.png", { type: "image/png" }));
            input.files = dt.files; input.dispatchEvent(new Event("change")); await NexaTest.wait(50);
            out.imported = ins.props.src;
            ins.destroy();
            return out;
        })()`);
        assert.deepStrictEqual(res.tiles, ['off', 'on', 'icons/motor', 'broken']);
        assert.strictEqual(res.picked, '{asset:icons/motor}');
        assert.strictEqual(res.shown, 'icons/motor');
        assert.strictEqual(res.imported, '{asset:uploaded/logo.png}');
    });
    return true;
});

r.then((res) => { if (res === null) console.log('SKIPPED (no Chrome)'); console.log('\n' + passed + ' passed\nALL OK'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
