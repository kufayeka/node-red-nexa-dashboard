'use strict';
// src/model/breakpoints.js (as lib/nexa-model.js): the app's bands (xs … 3xl), which
// one a width is in, the design's band (the screen's width), the cascade away from the
// design, merged object fields, the diff that becomes an override, legacy Tablet / Phone
// overrides, fallbacks of bound props.   node test/model-breakpoints.test.js

const assert = require('assert');
const M = require('../dist/nexa-model.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }

const app = {};                       // no breakpoints of its own: the defaults
const desk = { width: 1920 };         // designed at 3xl
const laptop = { width: 1280 };       // designed at xl

ok('default bands, Tailwind: xs 0 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536 · 3xl 1920', () => {
    assert.deepStrictEqual([0, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1535, 1536, 1919, 1920, 3000].map((w) => M.bandOf(app, w)),
        ['xs', 'xs', 'sm', 'sm', 'md', 'md', 'lg', 'lg', 'xl', 'xl', '2xl', '2xl', '3xl', '3xl']);
    assert.strictEqual(M.rangeOf(app, 'md'), '768 – 1023 px');
    assert.strictEqual(M.rangeOf(app, '3xl'), '1920 px and up');
});
ok('the design is the band of the screen\'s width', () => {
    assert.strictEqual(M.designBreakpoint(app, desk), '3xl');
    assert.strictEqual(M.designBreakpoint(app, laptop), 'xl');
    assert.strictEqual(M.designBreakpoint(app, { width: 800 }), 'md');
});
ok('the cascade goes away from the design: narrower from the next wider, wider from the next narrower', () => {
    assert.deepStrictEqual(M.chainFor(app, laptop, 'sm'), ['lg', 'md', 'sm']);
    assert.deepStrictEqual(M.chainFor(app, laptop, 'lg'), ['lg']);
    assert.deepStrictEqual(M.chainFor(app, laptop, 'xl'), []);
    assert.deepStrictEqual(M.chainFor(app, laptop, '3xl'), ['2xl', '3xl']);
    assert.deepStrictEqual(M.chainFor(app, desk, 'xs'), ['2xl', 'xl', 'lg', 'md', 'sm', 'xs']);
});
ok('an app\'s own breakpoints (any order; the narrowest starts at 0), renamed ones keep their id', () => {
    const a = { breakpoints: [{ id: 'wide', name: 'Wide', min: 1200 }, { id: 'hmi', name: 'HMI', min: 700, preview: 800 }, { id: 'phone', name: 'Phone', min: 320 }] };
    assert.deepStrictEqual(M.breakpointsOf(a).map((b) => b.id + ':' + b.min), ['phone:0', 'hmi:700', 'wide:1200']);
    assert.deepStrictEqual([100, 699, 700, 1300].map((w) => M.bandOf(a, w)), ['phone', 'phone', 'hmi', 'wide']);
    assert.deepStrictEqual(M.chainFor(a, { width: 1920 }, 'phone'), ['hmi', 'phone']);
    assert.strictEqual(M.previewWidthOf(a, 'hmi'), 800);
    // a preview outside the band is kept inside it
    assert.strictEqual(M.previewWidthOf({ breakpoints: [{ id: 'a', min: 0, preview: 900 }, { id: 'b', min: 600 }] }, 'a'), 599);
});
ok('overrides cascade: sm starts from md; objects merge key by key, the rest is replaced', () => {
    const node = { id: 'n', x: 10, w: 300, layout: { mode: 'horizontal', gap: 8, padding: { t: 8, r: 8, b: 8, l: 8 } }, props: { text: 'Hello', size: 20 },
        overrides: { md: { layout: { mode: 'vertical' }, w: 200 }, sm: { visibility: 'hide', props: { size: 14 }, layout: { padding: { t: 2 } } } } };
    const base = M.baseOf(node);
    M.applyOverrides(node, base, M.chainFor(app, laptop, 'xs'));
    assert.deepStrictEqual([node.x, node.w, node.visibility], [10, 200, 'hide']);
    assert.deepStrictEqual(node.layout, { mode: 'vertical', gap: 8, padding: { t: 2, r: 8, b: 8, l: 8 } });
    assert.deepStrictEqual(node.props, { text: 'Hello', size: 14 });
    // md's is not sm's
    M.applyOverrides(node, base, M.chainFor(app, laptop, 'md'));
    assert.deepStrictEqual([node.w, node.visibility, node.props.size], [200, undefined, 20]);
    // and back to the design: exactly as designed (a field the design did not have is gone)
    M.applyOverrides(node, base, []);
    assert.deepStrictEqual([node.w, node.visibility, node.layout.mode, node.props.size], [300, undefined, 'horizontal', 20]);
});
ok('a band wider than the design does not reach the narrower ones', () => {
    const node = { id: 'n', props: { size: 16 }, overrides: { '3xl': { props: { size: 24 } } } };
    assert.strictEqual(M.resolveNode(node, M.chainFor(app, laptop, '3xl')).props.size, 24);
    assert.strictEqual(M.resolveNode(node, M.chainFor(app, laptop, '2xl')).props.size, 16);
    assert.strictEqual(M.resolveNode(node, M.chainFor(app, laptop, 'md')).props.size, 16);
});
ok('saved as Tablet / Phone: read as md / sm, and renamed by the migration', () => {
    const node = { id: 'n', w: 300, overrides: { tablet: { w: 200 }, phone: { w: 100 } } };
    assert.strictEqual(M.resolveNode(node, M.chainFor(app, desk, 'md')).w, 200);
    assert.strictEqual(M.resolveNode(node, M.chainFor(app, desk, 'xs')).w, 100);
    const surface = { treeVersion: 1, components: [{ id: 'f', type: '@frame', children: [node] }] };
    M.migrateSurface(surface);
    assert.deepStrictEqual(node.overrides, { md: { w: 200 }, sm: { w: 100 } });
});
ok('resolveNode leaves the node as it is', () => {
    const node = { id: 'n', w: 300, overrides: { md: { w: 100 } } };
    assert.strictEqual(M.resolveNode(node, ['md']).w, 100);
    assert.strictEqual(node.w, 300);
});
ok('overrideDiff: only what differs (object fields per key); nothing -> {}', () => {
    const a = { x: 10, w: 300, props: { text: 'Hi', size: 20 }, layout: { mode: 'horizontal', gap: 8 } };
    const b = { x: 10, w: 120, props: { text: 'Hi', size: 14 }, layout: { mode: 'horizontal', gap: 8 } };
    assert.deepStrictEqual(M.overrideDiff(a, b), { w: 120, props: { size: 14 } });
    assert.deepStrictEqual(M.overrideDiff(a, JSON.parse(JSON.stringify(a))), {});
});
ok('fallbacks: a bound prop with no value (none, null, ???, no message, not resolved) shows its fallback', () => {
    const raw = { a: '{sparkplug:G::N::D::M}', b: '{msg.payload.x}', c: '{speed}', d: 'Line {line}: {sparkplug:G::N::D::M}', e: '{ok}', f: 'static', g: '{nofb}',
        __fallback: { a: 0, b: 'waiting', c: 1, d: 'Line ?', e: 'x', f: 'never' } };
    const resolved = { a: '???', b: '', c: '{speed}', d: 'Line 3: ???', e: 42, f: 'static', g: null };
    const out = M.applyFallbacks(raw, resolved);
    assert.deepStrictEqual([out.a, out.b, out.c, out.d, out.e, out.f, out.g], [0, 'waiting', 1, 'Line ?', 42, 'static', null]);
    assert.strictEqual(M.applyFallbacks({ a: '{x}' }, resolved), resolved, 'nothing to fall back: the same object');
    assert.strictEqual(M.applyFallbacks(raw, { a: 5, b: 'x', c: 2, d: 'Line 3: 7', e: 1, f: 'static' }).a, 5, 'a value: no fallback');
});

console.log(`\n${passed} passed\nALL OK`);
