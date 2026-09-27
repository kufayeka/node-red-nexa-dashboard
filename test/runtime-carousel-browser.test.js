'use strict';

// A carousel (a frame with layout mode "carousel") on a deployed page, in
// headless Chrome: slides the track's size (perView, gap), arrows and dots,
// the current slide two-way with a variable, keys, a mouse drag, a Populate
// filling it (a template slide follows the slide's size), "On Slide Change"
// with msg.index / msg.item, and a fade with autoplay.
// Needs `npm run build`.   node test/runtime-carousel-browser.test.js   (skipped without Chrome)

const assert = require('assert');
const path = require('path');
const { withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-carousel.html', async ({ js, send, logs }) => {
            const wait = (ms) => js(`new Promise(function (r) { setTimeout(r, ${ms}); })`);
            const emit = (event, payload) => js(`(function () { window.__ctx.ctl.emit(${JSON.stringify(event)}, ${JSON.stringify(payload)}); return new Promise(function (r) { setTimeout(r, 80); }); })()`);
            const text = (id) => js(`document.querySelector('[data-id="${id}"]').textContent`);
            // a carousel's state: the track's scroll, its slides' widths, dots (the one on), arrows
            const car = (id) => js(`(function () {
                var el = document.querySelector('[data-id="${id}"]'), t = el.querySelector(".nexa-carousel-track");
                var slides = Array.from(t.children).filter(function (e) { return e.getAttribute("data-id"); });
                var dots = Array.from(el.querySelectorAll(".nexa-carousel-dot"));
                var arrows = Array.from(el.querySelectorAll(".nexa-carousel-arrow"));
                return { scroll: Math.round(t.scrollLeft), widths: slides.map(function (s) { return Math.round(s.getBoundingClientRect().width); }),
                    dots: dots.length, on: dots.findIndex(function (d) { return d.classList.contains("nexa-on"); }),
                    prevDisabled: arrows[0] ? arrows[0].disabled : null, nextDisabled: arrows[1] ? arrows[1].disabled : null,
                    opacity: slides.map(function (s) { return s.style.opacity; }) };
            })()`);
            const click = (id, which) => js(`(function () { document.querySelector('[data-id="${id}"]').querySelectorAll(".nexa-carousel-arrow")[${which}].click(); return 1; })()`);
            await wait(200);

            await ok('slides the track\'s size, one per view; three dots, the first on; no "previous" at the start', async () => {
                const c = await car('car');
                assert.deepStrictEqual(c.widths, [300, 300, 300]);
                assert.deepStrictEqual([c.scroll, c.dots, c.on, c.prevDisabled, c.nextDisabled], [0, 3, 0, true, false]);
            });
            await ok('next: scrolls one slide on (snapping); the variable follows ({slide} = 1), the dot too', async () => {
                await click('car', 1); await wait(700);
                const c = await car('car');
                assert.deepStrictEqual([c.scroll, c.on, c.prevDisabled], [300, 1, false]);
                assert.strictEqual(await text('vSlide'), '1');
            });
            await ok('Set Variable slide = 2 (Logic): the carousel goes there; the last one: no "next" (no loop)', async () => {
                await emit('go', 2); await wait(700);
                const c = await car('car');
                assert.deepStrictEqual([c.scroll, c.on, c.nextDisabled], [600, 2, true]);
            });
            await ok('keys: ArrowLeft goes back one', async () => {
                await js(`(function () { var t = document.querySelector('[data-id="car"] .nexa-carousel-track'); t.focus(); t.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); return 1; })()`);
                await wait(700);
                assert.strictEqual((await car('car')).on, 1);
                assert.strictEqual(await text('vSlide'), '1');
            });
            await ok('a mouse drag to the left: the next slide', async () => {
                const b = await js(`(function () { var r = document.querySelector('[data-id="car"]').getBoundingClientRect(); return { x: r.left + 200, y: r.top + 50 }; })()`);
                const mouse = (type, x) => send('Input.dispatchMouseEvent', { type, x, y: b.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
                await mouse('mouseMoved', b.x); await mouse('mousePressed', b.x);
                for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', b.x - i * 12); await wait(10); }
                await mouse('mouseReleased', b.x - 96); await wait(800);
                const c = await car('car');
                assert.deepStrictEqual([c.on, c.scroll], [2, 600]);
            });
            await ok('Populate -> Layout (a carousel): 2 per view with a 10 px gap; 5 slides = 4 pages; a template slide follows the slide\'s width', async () => {
                await emit('fill', [1, 2, 3, 4, 5].map((i) => ({ id: i, name: 'P' + i })));
                await wait(200);
                const c = await car('pc');
                assert.deepStrictEqual(c.widths, [145, 145, 145, 145, 145], '(300 - 10) / 2');
                assert.deepStrictEqual([c.dots, c.on], [4, 0]);
                const label = await js(`Math.round(document.querySelector('[data-id="pc#1::name"]').getBoundingClientRect().width)`);
                assert.strictEqual(label, 145, 'the label keeps to both edges of the slide (its constraints), not the template\'s 100');
                assert.strictEqual(await text('pc#2::name'), 'P2');
            });
            await ok('On Slide Change: msg.index and the populated slide\'s msg.item', async () => {
                await click('pc', 1); await wait(700);
                assert.strictEqual(await text('vLast'), '1:P2');
                assert.strictEqual((await car('pc')).scroll, 155, 'one slide + the gap');
            });
            await ok('a fixed-size template in a slide: centred in the slide, inside its padding', async () => {
                const pos = () => js(`(function () { var s = document.querySelector('[data-id="pcC#1"]'), inner = s.firstElementChild; var a = s.getBoundingClientRect(), b = inner.getBoundingClientRect();
                    return [Math.round(b.left - a.left), Math.round(b.top - a.top), Math.round(b.width), Math.round(b.height)]; })()`);
                assert.deepStrictEqual(await pos(), [100, 10, 100, 80], '20 + (300 - 40 - 100) / 2 = 100; 10 + (100 - 20 - 80) / 2 = 10');
            });
            await ok('more than 10 slides: a counter "1 / 12" instead of a row of dots; it follows', async () => {
                const count = () => js(`(function () { var d = document.querySelector('[data-id="many"] .nexa-carousel-dots'); return [d.classList.contains("nexa-count"), d.textContent.trim(), d.querySelectorAll(".nexa-carousel-dot").length]; })()`);
                assert.deepStrictEqual(await count(), [true, '1 / 12', 0]);
                await click('many', 1); await wait(700);
                assert.deepStrictEqual((await count()).slice(0, 2), [true, '2 / 12']);
            });
            await ok('fade + autoplay: one slide shown at a time; it moves on by itself', async () => {
                // sampled every 150 ms for 1.6 s (every 500 ms it moves on, round the three)
                const seen = new Set();
                for (let i = 0; i < 11; i++) {
                    const c = await car('fd');
                    assert.strictEqual(c.opacity.filter((o) => o === '1').length, 1, 'one shown: ' + c.opacity);
                    assert.strictEqual(c.opacity.indexOf('1'), c.on, 'the dot is the one shown');
                    seen.add(c.on);
                    await wait(150);
                }
                assert.ok(seen.size > 1, 'autoplay moved on: ' + [...seen]);
            });
            assert.deepStrictEqual(logs.filter((l) => !/dev mode/.test(l)), []);
            return true;
        }, { width: 1100, height: 800, ready: "!!(window.__ctx && window.__ctx.ctl)", readyTries: 60 });
        if (r === null) return null;
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
