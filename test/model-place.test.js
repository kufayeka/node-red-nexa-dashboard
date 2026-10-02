'use strict';
// Where a node is placed (src/model/layout.js placeOf / dockOf, tree.js onScreen / absBox):
// in the layout, free, on the screen, docked; its margin, padding and layer (z) as CSS.
//   node test/model-place.test.js

const assert = require('assert');
const M = require('../dist/nexa-model.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }

const col = { id: 'col', type: '@frame', x: 100, y: 50, w: 300, h: 400, layout: { mode: 'vertical', gap: 8 }, children: [] };
const free = { id: 'free', type: '@frame', x: 0, y: 0, w: 300, h: 200, children: [] };
const btn = (extra) => Object.assign({ id: 'b', type: 'kufayeka-rect', x: 10, y: 20, w: 120, h: 40, props: {} }, extra || {});

ok('placeOf: in an auto layout the layout (or absolute: free); elsewhere free; place wins', () => {
    assert.strictEqual(M.placeOf(btn(), col), 'flow');
    assert.strictEqual(M.placeOf(btn({ layoutChild: { absolute: true } }), col), 'free');
    assert.strictEqual(M.placeOf(btn(), free), 'free');
    assert.strictEqual(M.placeOf(btn(), null), 'free');
    assert.strictEqual(M.placeOf(btn({ place: 'dock' }), col), 'dock');
    assert.strictEqual(M.placeOf(btn({ place: 'screen' }), col), 'screen');
    assert.strictEqual(M.isInFlow(btn({ place: 'dock' }), col), false, 'docked: out of the flow');
    assert.strictEqual(M.placeOf({ type: '@frame', inSlot: 'a', place: 'dock' }, { slots: true, type: 'x' }), 'free', 'a slot frame is its component\'s');
});

ok('docked: anchored to the corner / edge of its parent, off by its margin; stretch along an edge; centre by calc', () => {
    const css = (dock, margin) => M.boxCss(btn({ place: 'dock', dock, margin }), free);
    let c = css({ x: 'end', y: 'end' }, { t: 0, r: 16, b: 12, l: 0 });
    assert.deepStrictEqual([c.position, c.left, c.right, c.top, c.bottom, c.margin], ['absolute', 'auto', '16px', 'auto', '12px', '0px']);
    c = css({ x: 'center', y: 'start', stretch: true }, { t: 4, r: 8, b: 0, l: 8 });
    assert.deepStrictEqual([c.left, c.right, c.width, c.top], ['8px', '8px', 'auto', '4px'], 'a header: the whole width');
    c = css({ x: 'start', y: 'center', stretch: true });
    assert.deepStrictEqual([c.left, c.top, c.bottom, c.height], ['0px', '0px', '0px', 'auto'], 'a side bar: the whole height');
    c = css({ x: 'center', y: 'center' }, { t: 0, r: 0, b: 0, l: 10 });
    assert.deepStrictEqual([c.left, c.top], ['calc(50% - 60px + 5px)', 'calc(50% - 20px + 0px)']);
    c = css({ x: 'end', y: 'start', stretch: true });
    assert.deepStrictEqual([c.width, c.right], ['120px', '0px'], 'a corner does not stretch');
    assert.strictEqual(M.hasConstraints(btn({ place: 'dock' }), free), false, 'the dock, not constraints');
});

ok('margin: the space around it in a layout (not for a free node: its x / y say where); padding for a component; z', () => {
    const m = { t: 4, r: 8, b: 4, l: 8 };
    assert.strictEqual(M.boxCss(btn({ margin: m }), col).margin, '4px 8px 4px 8px');
    assert.strictEqual(M.boxCss(btn({ margin: m }), free).margin, '');
    assert.strictEqual(M.boxCss(btn({ padding: { t: 6, r: 6, b: 6, l: 6 } }), free).padding, '6px 6px 6px 6px');
    assert.strictEqual(M.boxCss({ id: 'f', type: '@frame', w: 10, h: 10, padding: { t: 6, r: 6, b: 6, l: 6 } }, free).padding, undefined, 'a frame: its layout\'s padding');
    assert.strictEqual(M.boxCss(btn({ z: 3 }), col)['z-index'], '3');
    assert.strictEqual(M.boxCss(btn({ z: -2 }), free)['z-index'], '-2');
    assert.strictEqual(M.boxCss(btn(), free)['z-index'], '');
    assert.strictEqual(M.boxCss(btn({ scrollBehavior: 'sticky', z: 7 }), col)['z-index'], '7', 'sticky keeps its own z');
    assert.deepStrictEqual(M.marginOf(btn({ margin: 5 })), { t: 5, r: 5, b: 5, l: 5 });
});

ok('on the screen: its x / y are the surface\'s (absBox), and what it holds is placed from it', () => {
    const s = { width: 800, height: 600, components: [
        { id: 'card', type: '@frame', x: 100, y: 100, w: 200, h: 100, style: { clip: true }, children: [
            { id: 'pop', type: 'kufayeka-rect', place: 'screen', x: 500, y: 300, w: 50, h: 50 },
            { id: 'g', type: '@frame', place: 'screen', x: 20, y: 30, w: 100, h: 100, children: [{ id: 'in', type: 'kufayeka-rect', x: 5, y: 6, w: 10, h: 10 }] },
            { id: 'plain', type: 'kufayeka-rect', x: 5, y: 5, w: 10, h: 10 }] }] };
    assert.deepStrictEqual(M.absBox(s, 'pop'), { x: 500, y: 300, w: 50, h: 50 });
    assert.deepStrictEqual(M.absBox(s, 'in'), { x: 25, y: 36, w: 10, h: 10 });
    assert.deepStrictEqual(M.absBox(s, 'plain'), { x: 105, y: 105, w: 10, h: 10 });
    assert.strictEqual(M.onScreen(s.components[0].children[0]), true);
});

ok('breakpoints: z, margin, padding and the dock may differ per breakpoint', () => {
    ['z', 'margin', 'padding', 'dock'].forEach((k) => assert.ok(M.OVERRIDABLE.indexOf(k) !== -1, k));
});

console.log(`\n${passed} passed\nALL OK`);
