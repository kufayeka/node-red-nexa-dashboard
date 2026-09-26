'use strict';

// The screen node tree (src/model/tree.js) and the migration of pre-tree
// screens (src/model/migrate.js). No browser.
//   node test/model-tree.test.js

const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

function load(rel) {
    const out = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'model', rel)], bundle: true, format: 'cjs', platform: 'neutral', write: false });
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
    return mod.exports;
}
const T = load('tree.js');
const M = load('migrate.js');
const L = load('layout.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }
let n = 0;
const gen = () => 'x' + (++n);
const leaf = (id, x, y, w, h) => ({ id, type: 'mock', x, y, w: w || 10, h: h || 10, props: {} });
const ids = (list) => list.map((c) => c.id);

ok('walk / find / locate / ancestors over nested containers', () => {
    const s = { components: [leaf('a', 0, 0), { id: 'g', type: '@group', x: 100, y: 50, w: 50, h: 50, children: [leaf('b', 5, 5), { id: 'f', type: '@frame', x: 10, y: 10, w: 30, h: 30, children: [leaf('c', 1, 2)] }] }] };
    assert.deepStrictEqual(ids(T.allNodes(s)), ['a', 'g', 'b', 'f', 'c']);
    assert.strictEqual(T.find(s, 'c').x, 1);
    const loc = T.locate(s, 'b');
    assert.deepStrictEqual([loc.parent.id, loc.index, loc.orphan], ['g', 0, false]);
    assert.deepStrictEqual(ids(T.ancestors(s, 'c')), ['g', 'f']);
    assert.ok(T.isAncestor(s, 'g', 'c') && !T.isAncestor(s, 'f', 'b'));
    assert.deepStrictEqual(T.absBox(s, 'c'), { x: 111, y: 62, w: 10, h: 10 }, 'offsets add up');
    assert.deepStrictEqual(T.parentSize(s, 'c'), { w: 30, h: 30 });
    assert.deepStrictEqual(T.parentSize({ width: 800, height: 600, components: [leaf('z', 0, 0)] }, 'z'), { w: 800, h: 600 });
});

ok('insert / move (reparent + reorder, same-list index) / refuses a move into itself', () => {
    const s = { components: [leaf('a', 0, 0), leaf('b', 0, 0), leaf('c', 0, 0), { id: 'g', type: '@group', children: [] }] };
    T.move(s, 'a', null, 3); // after c (index counted with a still in the list)
    assert.deepStrictEqual(ids(s.components), ['b', 'c', 'a', 'g']);
    T.move(s, 'b', 'g', 0);
    assert.deepStrictEqual([ids(s.components), ids(T.find(s, 'g').children)], [['c', 'a', 'g'], ['b']]);
    T.insert(s, 'g', 0, leaf('d', 0, 0));
    assert.deepStrictEqual(ids(T.find(s, 'g').children), ['d', 'b']);
    assert.throws(() => T.move(s, 'g', 'g'), /inside itself/);
    assert.throws(() => T.insert(s, 'a', 0, leaf('e', 0, 0)), /not a container/);
});

ok('deleting a container orphans its children; an orphan can be placed again', () => {
    const s = { components: [{ id: 'g', type: '@group', children: [leaf('a', 1, 1), leaf('b', 2, 2)] }, leaf('c', 0, 0)] };
    T.remove(s, 'g');
    assert.deepStrictEqual([ids(s.components), ids(s.orphans)], [['c'], ['a', 'b']]);
    assert.strictEqual(T.locate(s, 'a').orphan, true, 'found among the orphans');
    assert.deepStrictEqual(ids(T.allNodes(s)), ['c'], 'orphans are not part of the tree');
    assert.deepStrictEqual(ids(T.allNodes(s, { orphans: true })), ['c', 'a', 'b']);
    T.placeOrphan(s, 'b', null, 0);
    assert.deepStrictEqual([ids(s.components), ids(s.orphans)], [['b', 'c'], ['a']]);
    T.remove(s, 'c');
    assert.deepStrictEqual(ids(s.components), ['b'], 'a plain component is simply deleted');
});

ok('orphans keep their place on screen (surface coordinates)', () => {
    const s = { components: [{ id: 'g', type: '@group', x: 100, y: 50, w: 20, h: 20, children: [leaf('a', 5, 5)] }] };
    T.remove(s, 'g');
    assert.deepStrictEqual([s.orphans[0].x, s.orphans[0].y], [105, 55]);
});

ok('tidyContainer: a group left empty goes (and so on up), the groups around re-hug', () => {
    const s = { components: [{ id: 'outer', type: '@group', x: 0, y: 0, w: 100, h: 100, children: [
        leaf('keep', 0, 0, 10, 10),
        { id: 'inner', type: '@group', x: 50, y: 50, w: 50, h: 50, children: [{ id: 'innermost', type: '@group', x: 0, y: 0, w: 50, h: 50, children: [leaf('x', 0, 0, 50, 50)] }] }] }] };
    T.move(s, 'x', null, null);
    assert.deepStrictEqual(T.tidyContainer(s, 'innermost'), ['innermost', 'inner']);
    const outer = T.find(s, 'outer');
    assert.deepStrictEqual([ids(outer.children), outer.w, outer.h], [['keep'], 10, 10], 'outer hugs what is left');
    assert.deepStrictEqual(T.tidyContainer(s, null), [], 'the root is left alone');
    const f = { components: [{ id: 'fr', type: '@frame', x: 0, y: 0, w: 80, h: 80, children: [] }] };
    assert.deepStrictEqual([T.tidyContainer(f, 'fr'), ids(f.components)], [[], ['fr']], 'an empty frame stays (it is a box of its own)');
});

ok('wrap in a group keeps everything in place; the group hugs; unwrap restores', () => {
    const s = { components: [leaf('a', 100, 100, 50, 20), leaf('b', 0, 0), leaf('c', 200, 150, 30, 30)] };
    const g = T.wrapInGroup(s, ['c', 'a'], { id: 'g', name: 'G' });
    assert.deepStrictEqual(ids(s.components), ['b', 'g'], 'at the top-most member\'s position');
    assert.deepStrictEqual([g.x, g.y, g.w, g.h], [100, 100, 130, 80]);
    assert.deepStrictEqual(ids(g.children), ['a', 'c'], 'members keep their order');
    assert.deepStrictEqual([T.absBox(s, 'a'), T.absBox(s, 'c')], [{ x: 100, y: 100, w: 50, h: 20 }, { x: 200, y: 150, w: 30, h: 30 }]);
    T.find(s, 'c').x += 50; // a member moved: the group refits, nothing else moves
    T.refitGroupsUp(s, 'c');
    assert.deepStrictEqual([g.w, T.absBox(s, 'a').x, T.absBox(s, 'c').x], [180, 100, 250]);
    assert.throws(() => T.wrapInGroup(s, ['b', 'a'], { id: 'g2' }), /share one parent/);
    T.unwrap(s, 'g');
    assert.deepStrictEqual(ids(s.components), ['b', 'a', 'c']);
    assert.deepStrictEqual([T.find(s, 'a').x, T.find(s, 'c').x, T.find(s, 'c').y], [100, 250, 150]);
});

ok('effective visibility / lock follow the most restrictive ancestor; findByName; cloneWithNewIds', () => {
    const s = { components: [{ id: 'g', type: '@group', name: 'Alarms', visibility: 'hide', children: [{ id: 'h', type: '@group', name: 'Inner', locked: true, children: [leaf('a', 0, 0)] }] }] };
    assert.deepStrictEqual([T.effectiveVisibility(s, 'a'), T.effectiveLocked(s, 'a'), T.effectiveLocked(s, 'g')], ['hide', true, false]);
    T.find(s, 'a').visibility = 'remove';
    assert.strictEqual(T.effectiveVisibility(s, 'a'), 'remove');
    assert.deepStrictEqual(ids(T.findByName(s, 'Alarms')), ['g']);
    const copy = T.cloneWithNewIds(T.find(s, 'g'), gen);
    assert.ok(copy.id !== 'g' && copy.children[0].id !== 'h' && copy.children[0].children[0].id !== 'a');
    assert.strictEqual(copy.children[0].children[0].type, 'mock');
});

ok('migrate: one default layer changes nothing but the version; idempotent', () => {
    const s = { width: 800, height: 600, layers: [{ id: 'default', name: 'Default Layer', parentId: null, state: 'show' }],
        components: [{ id: 'a', type: 'mock', x: 10, y: 10, w: 10, h: 10, layerId: 'default' }] };
    M.migrateSurface(s);
    assert.deepStrictEqual(s.components, [{ id: 'a', type: 'mock', x: 10, y: 10, w: 10, h: 10 }]);
    assert.deepStrictEqual([s.layers, s.groups, s.treeVersion, s.orphans], [undefined, undefined, 1, []]);
    const again = JSON.stringify(s);
    M.migrateSurface(s);
    assert.strictEqual(JSON.stringify(s), again);
});

ok('migrate: layers -> named groups (nested, visibility), old groups -> groups; nothing moves on screen', () => {
    const s = { width: 800, height: 600,
        layers: [{ id: 'default', name: 'Default Layer', parentId: null, state: 'show' }, { id: 'L2', name: 'Popup', parentId: null, state: 'hide' },
            { id: 'L3', name: 'Popup buttons', parentId: 'L2', state: 'show' }, { id: 'L4', name: 'Empty', parentId: null, visible: false }],
        groups: [{ id: 'G1' }],
        components: [
            { id: 'a', type: 'mock', x: 10, y: 10, w: 10, h: 10, layerId: 'default' },
            { id: 'b', type: 'mock', x: 300, y: 200, w: 100, h: 50, layerId: 'L2' },
            { id: 'c', type: 'mock', x: 320, y: 260, w: 40, h: 20, layerId: 'L3' },
            { id: 'd', type: 'mock', x: 50, y: 400, w: 20, h: 20, layerId: 'default', g: 'G1' },
            { id: 'e', type: 'mock', x: 90, y: 420, w: 20, h: 20, layerId: 'default', g: 'G1' },
            { id: 'f', type: 'mock', x: 5, y: 5, w: 5, h: 5, layerId: 'gone' }
        ] };
    const before = {};
    s.components.forEach((c) => { before[c.id] = { x: c.x, y: c.y, w: c.w, h: c.h }; });
    M.migrateSurface(s);
    assert.deepStrictEqual(ids(s.components), ['a', 'L2', 'G1', 'f', 'L4']);
    const popup = T.find(s, 'L2');
    assert.deepStrictEqual([popup.type, popup.name, popup.visibility, ids(popup.children)], ['@group', 'Popup', 'hide', ['b', 'L3']]);
    assert.deepStrictEqual([T.find(s, 'L3').name, ids(T.find(s, 'L3').children)], ['Popup buttons', ['c']]);
    assert.deepStrictEqual([T.find(s, 'G1').name, ids(T.find(s, 'G1').children)], ['Group 1', ['d', 'e']]);
    assert.deepStrictEqual([T.find(s, 'L4').visibility, T.find(s, 'L4').children], ['hide', []], 'an empty layer is kept (Layer Control)');
    Object.keys(before).forEach((id) => assert.deepStrictEqual(T.absBox(s, id), before[id], id + ' did not move'));
    assert.deepStrictEqual([T.effectiveVisibility(s, 'c'), T.effectiveVisibility(s, 'a')], ['hide', 'show']);
    assert.ok(T.allNodes(s).every((node) => node.layerId === undefined && node.g === undefined));
});

ok('migrate: a hidden default layer hides its top-level components', () => {
    const s = { layers: [{ id: 'default', name: 'Default Layer', state: 'remove' }], components: [{ id: 'a', type: 'mock', x: 0, y: 0, w: 1, h: 1, layerId: 'default' }] };
    M.migrateSurface(s);
    assert.strictEqual(s.components[0].visibility, 'remove');
});

ok('layout: a frame without auto layout is a plain box; its children keep x / y', () => {
    const f = L.makeFrame('none'); f.id = 'f';
    const c = leaf('c', 5, 6, 30, 20);
    assert.strictEqual(L.hasAutoLayout(f), false);
    assert.strictEqual(L.frameCss(f).display, '');
    assert.deepStrictEqual([L.boxCss(c, f).position, L.boxCss(c, f).left, L.boxCss(c, f).width], ['absolute', '5px', '30px']);
    assert.strictEqual(L.canRotate(c, f), true);
});

ok('layout: row -> flex; fixed / fill / cross fill; alignment, gap, padding, wrap', () => {
    const f = { id: 'f', type: '@frame', w: 300, h: 80, children: [], layout: { mode: 'horizontal', padding: { t: 1, r: 2, b: 3, l: 4 }, gap: 6, alignX: 'center', alignY: 'end', wrap: true, rowGap: 9 } };
    const css = L.frameCss(f);
    assert.deepStrictEqual([css.display, css['flex-direction'], css['flex-wrap'], css['justify-content'], css['align-items'], css['column-gap'], css['row-gap'], css.padding],
        ['flex', 'row', 'wrap', 'center', 'flex-end', '6px', '9px', '1px 2px 3px 4px']);
    const fixed = L.boxCss(leaf('a', 50, 50, 40, 20), f);
    assert.deepStrictEqual([fixed.position, fixed.left, fixed.flex, fixed.width, fixed.height], ['relative', 'auto', '0 0 auto', '40px', '20px']);
    const fill = L.boxCss(Object.assign(leaf('b', 0, 0, 40, 20), { layoutChild: { w: 'fill', h: 'fill' } }), f);
    assert.deepStrictEqual([fill.flex, fill.width, fill['min-width'], fill['align-self'], fill.height], ['1 1 0px', 'auto', '0px', 'stretch', 'auto']);
    assert.strictEqual(L.canRotate(leaf('a', 0, 0), f), false, 'no rotation in a layout');
    const abs = L.boxCss(Object.assign(leaf('z', 7, 8), { layoutChild: { absolute: true } }), f);
    assert.deepStrictEqual([abs.position, abs.left, abs.top], ['absolute', '7px', '8px'], 'absolute = out of the flow');
    assert.strictEqual(L.frameCss(Object.assign({}, f, { layout: Object.assign({}, f.layout, { gap: 'auto' }) }))['justify-content'], 'space-between');
});

ok('layout: column swaps the axes; hug only for a child that lays out its own content', () => {
    const f = { id: 'f', type: '@frame', layout: { mode: 'vertical', alignX: 'center', alignY: 'start' } };
    const css = L.frameCss(f);
    assert.deepStrictEqual([css['flex-direction'], css['justify-content'], css['align-items']], ['column', 'flex-start', 'center']);
    const fillW = L.boxCss(Object.assign(leaf('a', 0, 0, 40, 20), { layoutChild: { w: 'fill' } }), f);
    assert.deepStrictEqual([fillW['align-self'], fillW.width, fillW.flex], ['stretch', 'auto', '0 0 auto'], 'width is the cross axis here');
    const hugLeaf = L.boxCss(Object.assign(leaf('b', 0, 0, 40, 20), { layoutChild: { h: 'hug' } }), f);
    assert.strictEqual(hugLeaf.height, '20px', 'a plain component has no content size: hug = fixed');
    const inner = { id: 'i', type: '@frame', w: 10, h: 10, layout: { mode: 'horizontal' }, layoutChild: { w: 'hug' }, children: [] };
    assert.strictEqual(L.boxCss(inner, f).width, 'max-content');
    const hugging = { id: 'h', type: '@frame', w: 10, h: 10, layout: { mode: 'vertical', sizeW: 'hug', sizeH: 'hug' } };
    assert.deepStrictEqual([L.boxCss(hugging, null).width, L.boxCss(hugging, null).height, L.boxCss(hugging, null).position], ['max-content', 'max-content', 'absolute']);
});

ok('layout: grid tracks, gaps, placement and spans', () => {
    const f = { id: 'g', type: '@frame', layout: { mode: 'grid', gap: 4, rowGap: 2, columns: [{ size: 120, unit: 'px' }, { size: 2, unit: 'fr' }, { unit: 'auto' }], rows: [{ size: 40, unit: 'px' }] } };
    const css = L.frameCss(f);
    assert.deepStrictEqual([css.display, css['grid-template-columns'], css['grid-template-rows'], css['column-gap'], css['row-gap']], ['grid', '120px 2fr auto', '40px', '4px', '2px']);
    const placed = L.boxCss(Object.assign(leaf('a', 0, 0), { layoutChild: { col: 2, colSpan: 2, row: 1, w: 'fill' } }), f);
    assert.deepStrictEqual([placed['grid-column'], placed['grid-row'], placed.width, placed['justify-self']], ['2 / span 2', '1', 'auto', 'stretch']);
    assert.strictEqual(L.boxCss(Object.assign(leaf('b', 0, 0), { layoutChild: { rowSpan: 3 } }), f)['grid-row'], 'span 3');
});

ok('layout: frame style (fill, stroke, radius, clip); wrapIn a frame keeps positions and does not hug', () => {
    const css = L.frameCss({ type: '@frame', style: { fill: '#fff', stroke: '#000', strokeWidth: 2, radius: 6, clip: true } });
    assert.deepStrictEqual([css.background, css.border, css['border-radius'], css.overflow], ['#fff', '2px solid #000', '6px', 'hidden']);
    const s = { components: [leaf('a', 100, 100, 50, 20), leaf('b', 200, 150, 30, 30)] };
    const fr = T.wrapIn(s, ['a', 'b'], { id: 'fr', type: '@frame' });
    assert.deepStrictEqual([fr.type, fr.x, fr.y, fr.w, fr.h, T.absBox(s, 'b').x, T.absBox(s, 'b').y], ['@frame', 100, 100, 130, 80, 200, 150]);
    T.find(s, 'a').x = -10; T.fitGroup(fr);
    assert.strictEqual(fr.x, 100, 'fitGroup leaves a frame alone');
});

console.log(`\n${passed} passed\nALL OK`);
