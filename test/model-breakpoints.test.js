'use strict';
// src/model/breakpoints.js (as lib/nexa-model.js): which breakpoint a width is in,
// the cascade Desktop -> Tablet -> Phone, merged object fields, the diff that
// becomes an override.   node test/model-breakpoints.test.js

const assert = require('assert');
const M = require('../lib/nexa-model.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }

ok('default breakpoints: < 1024 tablet, < 768 phone, else desktop', () => {
    const s = {};
    assert.deepStrictEqual([1280, 1024, 1023, 800, 768, 767, 390].map((w) => M.activeBreakpoint(s, w)),
        ['desktop', 'desktop', 'tablet', 'tablet', 'tablet', 'phone', 'phone']);
});
ok('a screen\'s own breakpoints (any order) win; the cascade chain', () => {
    const s = { breakpoints: [{ id: 'phone', name: 'Phone', max: 599 }, { id: 'tablet', name: 'Tablet', max: 899 }] };
    assert.strictEqual(M.activeBreakpoint(s, 700), 'tablet');
    assert.strictEqual(M.activeBreakpoint(s, 500), 'phone');
    assert.deepStrictEqual(M.chainFor(s, 'phone'), ['tablet', 'phone']);
    assert.deepStrictEqual(M.chainFor(s, 'tablet'), ['tablet']);
    assert.deepStrictEqual(M.chainFor(s, 'desktop'), []);
});
ok('overrides cascade: phone starts from tablet; objects merge key by key, the rest is replaced', () => {
    const node = { id: 'n', x: 10, w: 300, layout: { mode: 'horizontal', gap: 8, padding: { t: 8, r: 8, b: 8, l: 8 } }, props: { text: 'Hello', size: 20 },
        overrides: { tablet: { layout: { mode: 'vertical' }, w: 200 }, phone: { visibility: 'hide', props: { size: 14 }, layout: { padding: { t: 2 } } } } };
    const base = M.baseOf(node);
    M.applyOverrides(node, base, M.chainFor({}, 'phone'));
    assert.deepStrictEqual([node.x, node.w, node.visibility], [10, 200, 'hide']);
    assert.deepStrictEqual(node.layout, { mode: 'vertical', gap: 8, padding: { t: 2, r: 8, b: 8, l: 8 } });
    assert.deepStrictEqual(node.props, { text: 'Hello', size: 14 });
    // and back to the desktop: exactly as designed (a field the desktop did not have is gone)
    M.applyOverrides(node, base, []);
    assert.deepStrictEqual([node.w, node.visibility, node.layout.mode, node.props.size], [300, undefined, 'horizontal', 20]);
});
ok('resolveNode leaves the node as it is', () => {
    const node = { id: 'n', w: 300, overrides: { tablet: { w: 100 } } };
    assert.strictEqual(M.resolveNode(node, ['tablet']).w, 100);
    assert.strictEqual(node.w, 300);
});
ok('overrideDiff: only what differs (object fields per key); nothing -> {}', () => {
    const a = { x: 10, w: 300, props: { text: 'Hi', size: 20 }, layout: { mode: 'horizontal', gap: 8 } };
    const b = { x: 10, w: 120, props: { text: 'Hi', size: 14 }, layout: { mode: 'horizontal', gap: 8 } };
    assert.deepStrictEqual(M.overrideDiff(a, b), { w: 120, props: { size: 14 } });
    assert.deepStrictEqual(M.overrideDiff(a, JSON.parse(JSON.stringify(a))), {});
});

console.log(`\n${passed} passed\nALL OK`);
