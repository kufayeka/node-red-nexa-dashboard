'use strict';

// The inspector's property tree, no browser: nodes from a component's schema, row
// summaries, the search, where a selection goes when its node disappears, list ops
// (src/sdk/kit/prop-tree/model.js).
//   node test/kit-prop-tree.test.js

const assert = require('assert');
const load = require('./sdk-load.js');
global.window = global.window || global;
const S = load('schema.js');
const M = load('kit/prop-tree/model.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }

const meta = S.buildMeta({
    id: 'acme-tabs',
    inputs: { value: { label: 'Value' } },
    properties: {
        title: { type: 'string', default: 'Line 1', group: 'General' },
        tabs: { type: 'list', group: 'General', noun: 'tab', default: [{ label: 'Overview', disabled: false }, { label: 'Alarms', disabled: true }],
            item: { fields: { label: { type: 'string' }, disabled: { type: 'boolean' } } } },
        size: { type: 'number', unit: 'px', default: 12, group: 'Style', section: 'Text' },
        weight: { type: 'enum', options: [{ value: 600, label: 'Semibold' }], default: 600, group: 'Style', section: 'Text' },
        bg: { type: 'color', default: '#0f62fe', group: 'Style', bindable: true },
        css: { type: 'css', default: '.x {\n  color: red;\n}', group: 'Style' },
        secret: { type: 'string', hidden: true },
        hint: { type: 'string', group: 'General', visibleWhen: (p) => !!p.title }
    }
});

ok('groups by first appearance, sections inside, hidden / visibleWhen left out', () => {
    const roots = M.buildTree(meta, { title: 'L1', tabs: meta.props.tabs.default });
    assert.deepStrictEqual(roots.map((g) => g.label), ['Data', 'General', 'Style']);
    const style = roots[2];
    assert.deepStrictEqual(style.children.map((n) => n.id), ['@Style/Text', 'bg', 'css']);
    assert.deepStrictEqual(style.children[0].children.map((n) => n.id), ['size', 'weight']);
    assert.strictEqual(style.children[0].children[0].depth, 2);
    assert.ok(roots[1].children.some((n) => n.id === 'hint'));
    assert.ok(!M.buildTree(meta, { title: '' })[1].children.some((n) => n.id === 'hint'), 'visibleWhen false');
    assert.ok(!M.indexTree(roots).has('secret'));
});

ok('list items are children, their fields grandchildren; labels from the first text field', () => {
    const map = M.indexTree(M.buildTree(meta, { tabs: [{ label: 'Overview' }, { label: '' }] }));
    assert.deepStrictEqual(map.get('tabs').children.map((n) => n.label), ['Overview', 'Tab 2']);
    assert.deepStrictEqual(map.get('tabs#0').children.map((n) => n.id), ['tabs#0.label', 'tabs#0.disabled']);
    assert.strictEqual(map.get('tabs#0.disabled').field.type, 'boolean');
    assert.deepStrictEqual(M.ancestorIds(map, 'tabs#1.label'), ['@General', 'tabs', 'tabs#1']);
});

ok('summaries: simple values only', () => {
    const P = meta.props;
    assert.deepStrictEqual(M.summary(P.size, 14), { text: '14 px' });
    assert.deepStrictEqual(M.summary(P.weight, 600), { text: 'Semibold' });
    assert.deepStrictEqual(M.summary(P.bg, '#ff0000'), { text: '#ff0000', swatch: '#ff0000' });
    assert.deepStrictEqual(M.summary(P.bg, '{sparkplug:G/E/D/Color}'), { text: '{sparkplug:G/E/D/Color}', bound: true });
    assert.deepStrictEqual(M.summary(P.bg, '{token:colors.primary}'), { text: 'colors.primary', token: true });
    assert.deepStrictEqual(M.summary(P.css, undefined), { text: '3 lines · .x {' });
    assert.deepStrictEqual(M.summary(P.tabs, [1, 2, 3]), { text: '[3 tabs]', empty: false });
    assert.deepStrictEqual(M.summary(P.title, ''), { text: '', empty: true });
    assert.strictEqual(M.emptyText(P.inputValue), 'not bound');
    assert.deepStrictEqual(M.summary(P.title, 'x', {}, (v) => 'custom ' + v), { text: 'custom x', empty: false });
});

ok('search: labels, keys and values; ancestors kept; counts the hits', () => {
    const roots = M.buildTree(meta, { title: 'Line 1', tabs: [{ label: 'Alarms' }], bg: '#abcdef' });
    const text = (n) => (n.kind === 'prop' ? M.summary(n.prop, ({ title: 'Line 1', bg: '#abcdef' })[n.key]).text : '');
    let r = M.visibleRows(roots, 'abcdef', () => false, text);
    assert.deepStrictEqual(r.rows.map((x) => x.node.id), ['@Style', 'bg']);
    assert.strictEqual(r.hits, 1);
    r = M.visibleRows(roots, 'alarms', () => false, text);
    assert.deepStrictEqual(r.rows.map((x) => x.node.id), ['@General', 'tabs', 'tabs#0']);
    r = M.visibleRows(roots, '', (id) => id === '@Style', text);
    assert.deepStrictEqual(r.rows.map((x) => x.node.id), ['@Data', '@General', '@Style', '@Style/Text', 'bg', 'css']);
});

ok('a vanished selection goes to the nearest node', () => {
    const roots = M.buildTree(meta, { tabs: [{ label: 'A' }] });
    const map = M.indexTree(roots);
    assert.strictEqual(M.nearestId(map, 'tabs#0.label', roots), 'tabs#0.label');
    assert.strictEqual(M.nearestId(map, 'tabs#3.label', roots), 'tabs#0');
    const empty = M.buildTree(meta, { tabs: [] });
    assert.strictEqual(M.nearestId(M.indexTree(empty), 'tabs#0.label', empty), 'tabs');
    assert.strictEqual(M.nearestId(M.indexTree(empty), 'gone', empty), 'inputValue');
    assert.strictEqual(M.nearestId(new Map(), 'x', []), null);
});

ok('list ops work on a copy and say where the item went', () => {
    const a = [{ l: 'A' }, { l: 'B' }, { l: 'C' }];
    assert.deepStrictEqual(M.listOp(a, 'up', 2), { next: [{ l: 'A' }, { l: 'C' }, { l: 'B' }], index: 1 });
    assert.deepStrictEqual(M.listOp(a, 'down', 0).index, 1);
    assert.deepStrictEqual(M.listOp(a, 'remove', 2), { next: [{ l: 'A' }, { l: 'B' }], index: 1 });
    const d = M.listOp(a, 'duplicate', 0);
    assert.strictEqual(d.next.length, 4); assert.notStrictEqual(d.next[1], a[0]); assert.strictEqual(d.index, 1);
    assert.deepStrictEqual(M.listOp(a, 'add', -1, () => ({ l: 'N' })).index, 3);
    assert.strictEqual(a.length, 3, 'the input untouched');
});

ok('editor kinds', () => {
    assert.strictEqual(M.editorKind(meta.props.css), 'large');
    assert.strictEqual(M.editorKind(meta.props.tabs), 'list');
    assert.strictEqual(M.editorKind(meta.props.size), 'inline');
    assert.strictEqual(M.editorKind({ type: 'json', editor: 'acme-curve' }), 'custom');
});

console.log(passed + ' passed');
console.log('ALL OK');
