'use strict';
// Components with slots (src/model/tree.js syncSlots, layout.js inSlot): a Tabs holds one
// frame per tab; what is dropped goes into a slot frame; a slot frame stays in its
// component and fills its slot.   node test/model-slots.test.js

const assert = require('assert');
const M = require('../dist/nexa-model.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }
let n = 0;
const genId = () => 'id' + (++n);

function surface() {
    const tabs = { id: 'tabs', type: 'nexa-ui-tabs', x: 10, y: 20, w: 400, h: 300, props: {} };
    return { width: 800, height: 600, components: [tabs] };
}

ok('syncSlots: one frame per slot, in order; a gone slot keeps its frame (not used); it comes back', () => {
    const s = surface(), t = s.components[0];
    assert.strictEqual(M.syncSlots(t, [{ name: 'a', label: 'Overview' }, { name: 'b' }], genId), true);
    assert.strictEqual(t.slots, true);
    assert.deepStrictEqual(t.children.map((c) => [c.type, c.inSlot, c.slotLabel]), [['@frame', 'a', 'Overview'], ['@frame', 'b', 'b']]);
    assert.ok(M.isSlotHost(t) && M.isContainer(t) && M.isSlotFrame(t.children[0]));
    assert.strictEqual(M.syncSlots(t, [{ name: 'a', label: 'Overview' }, { name: 'b' }], genId), false, 'nothing to do');
    const a = t.children[0];
    M.syncSlots(t, [{ name: 'b' }, { name: 'c', label: 'Trends' }], genId);
    assert.deepStrictEqual(t.children.map((c) => [c.inSlot, !!c.slotUnused]), [['b', false], ['c', false], ['a', true]]);
    M.syncSlots(t, [{ name: 'a', label: 'Overview 2' }, { name: 'b' }], genId);
    assert.strictEqual(t.children[0], a, 'the same frame (its content) is back');
    assert.deepStrictEqual([a.slotUnused, a.slotLabel], [undefined, 'Overview 2']);
    assert.strictEqual(M.slotOf(t, 'b').inSlot, 'b');
});

ok('syncSlots: a slot renamed in place (the value of a tab edited) keeps its frame and content, no "not used" left', () => {
    const s = surface(), t = s.components[0];
    M.syncSlots(t, [{ name: 'overview' }, { name: 'tab-7', label: 'Tab 7' }], genId);
    const f7 = t.children[1];
    M.insert(s, f7.id, null, { id: 'chart', type: 'nexa-ui-line-chart', x: 0, y: 0, w: 10, h: 10 });
    // the value of the new tab edited: "tab-7" -> "testingg"
    assert.strictEqual(M.syncSlots(t, [{ name: 'overview' }, { name: 'testingg', label: 'Testing' }], genId), true);
    assert.deepStrictEqual(t.children.map((c) => [c.inSlot, !!c.slotUnused]), [['overview', false], ['testingg', false]], 'renamed, nothing left unused');
    assert.strictEqual(t.children[1], f7, 'the same frame');
    assert.strictEqual(f7.slotLabel, 'Testing');
    assert.deepStrictEqual(M.kids(f7).map((c) => c.id), ['chart'], 'its content kept');
    // a reorder is not a rename; a new tab is added; a removed one is kept unused (as before)
    M.syncSlots(t, [{ name: 'testingg' }, { name: 'overview' }], genId);
    assert.deepStrictEqual(t.children.map((c) => c.inSlot), ['testingg', 'overview']);
    M.syncSlots(t, [{ name: 'testingg' }, { name: 'overview' }, { name: 'tab-3' }], genId);
    assert.deepStrictEqual(t.children.map((c) => [c.inSlot, !!c.slotUnused]), [['testingg', false], ['overview', false], ['tab-3', false]]);
    M.syncSlots(t, [{ name: 'testingg' }, { name: 'tab-3' }], genId);
    assert.deepStrictEqual(t.children.map((c) => [c.inSlot, !!c.slotUnused]), [['testingg', false], ['tab-3', false], ['overview', true]]);
    // renamed to a name an unused frame has: that frame comes back (its content), the renamed one stays unused
    M.syncSlots(t, [{ name: 'testingg' }, { name: 'overview' }], genId);
    assert.deepStrictEqual(t.children.map((c) => [c.inSlot, !!c.slotUnused]), [['testingg', false], ['overview', false], ['tab-3', true]]);
});

ok('what is dropped goes into a slot frame, not into the component; a slot frame stays in it', () => {
    const s = surface(), t = s.components[0];
    M.syncSlots(t, [{ name: 'a' }, { name: 'b' }], genId);
    const fa = t.children[0], fb = t.children[1];
    assert.throws(() => M.insert(s, 'tabs', null, { id: 'x', type: 'kufayeka-text', w: 10, h: 10 }), /slots/);
    M.insert(s, fa.id, null, { id: 'x', type: 'kufayeka-text', x: 5, y: 6, w: 10, h: 10 });
    assert.strictEqual(M.parentOf(s, 'x'), fa);
    M.move(s, 'x', fb.id, null);
    assert.strictEqual(M.parentOf(s, 'x'), fb, 'from one slot to another');
    assert.throws(() => M.move(s, fa.id, null, null), /slot stays/);
    assert.throws(() => M.wrapInGroup(s, [fa.id], { id: 'g' }), /slots stay/);
    assert.deepStrictEqual(M.unwrap(s, 'tabs'), [], 'a component is not ungrouped');
    assert.deepStrictEqual(M.unwrap(s, fa.id), [], 'nor its slot');
});

ok('deleting the component: what its slots held becomes orphans, where it was on the surface', () => {
    const s = surface(), t = s.components[0];
    M.syncSlots(t, [{ name: 'a' }], genId);
    const fa = t.children[0];
    fa.x = 0; fa.y = 40; // the readback: the panel under the tab headers
    M.insert(s, fa.id, null, { id: 'x', type: 'kufayeka-text', x: 5, y: 6, w: 10, h: 10 });
    M.remove(s, 'tabs');
    assert.deepStrictEqual(s.orphans.map((o) => [o.id, o.x, o.y]), [['x', 15, 66]]);
});

ok('a slot frame fills its slot: no box of its own, no constraints, no rotation, no hug', () => {
    const f = { type: '@frame', inSlot: 'a', x: 3, y: 4, w: 50, h: 60, layout: { mode: 'vertical', sizeH: 'hug' } };
    const css = M.boxCss(f, { type: 'nexa-ui-tabs', slots: true });
    assert.deepStrictEqual([css.position, css.left, css.top, css.width, css.height], ['absolute', '0', '0', '100%', '100%']);
    assert.strictEqual(M.hasConstraints(f, null), false);
    assert.strictEqual(M.canRotate(f, null), false);
    assert.strictEqual(M.frameHugs(f, 'h'), false);
    assert.strictEqual(M.frameCss(f).display, 'flex', 'its own layout, as any frame');
});

console.log(`\n${passed} passed\nALL OK`);
