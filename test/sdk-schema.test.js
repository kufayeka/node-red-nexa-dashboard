'use strict';

// SDK metadata, tags and codecs, no browser: defineComponent's definition
// normalized (src/sdk/schema.js), the generic tag registry (src/sdk/tags.js)
// and the field codecs (src/sdk/field/codecs.js).
//   node test/sdk-schema.test.js

const assert = require('assert');
const load = require('./sdk-load.js');
global.window = global.window || global;
const S = load('schema.js');
const T = load('tags.js');
const C = load('field/codecs.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }

const DEF = {
    id: 'acme-thing', label: 'Thing', version: 2,
    migrate: (p, from) => { if (from < 2) { p.barColor = p.color; delete p.color; } return p; },
    properties: {
        align: { type: 'enum', default: 'left', options: ['left', { value: 'right', label: 'Right!' }] },
        opacity: { type: 'range', default: 1, min: 0, max: 1 },
        steps: { default: 4 },
        names: { default: [] }
    },
    inputs: { value: { type: 'number', throttle: 100 }, pens: { multiple: true }, legacy: { prop: 'readTag' } },
    outputs: { value: { fallback: 'value' } },
    events: { change: { label: 'On Change', payload: { value: 'any' } }, blur: 'On Blur' },
    actions: { reset: { label: 'Reset' }, bump: {} },
    states: { normal: { label: 'Normal' }, focus: { label: 'Focus', selector: '.box.focused', css: 'outline: 1px solid blue;' } },
    css: '.box { color: red; }',
    state: { zoom: 1 },
    view: function () {}
};

ok('inputs / outputs become tag props (default names, `prop` override, `multiple` = a list), then properties, then CSS', () => {
    const m = S.buildMeta(DEF);
    assert.deepStrictEqual(Object.keys(m.props), ['inputValue', 'inputPens', 'readTag', 'outputValue', 'align', 'opacity', 'steps', 'names', 'css', 'cssFocus']);
    assert.deepStrictEqual([m.props.inputValue.type, m.props.inputValue.access, m.props.inputValue.bindable], ['tag', 'read', false]);
    assert.deepStrictEqual([m.props.inputPens.type, m.props.inputPens.item.type, m.props.inputPens.default], ['list', 'tag', []]);
    assert.deepStrictEqual([m.props.outputValue.access, m.outputs[0].fallbackKey], ['write', 'inputValue']);
    assert.deepStrictEqual(m.inputs.map((i) => [i.name, i.key, i.throttle, i.multiple, i.type]),
        [['value', 'inputValue', 100, false, 'number'], ['pens', 'inputPens', 0, true, 'any'], ['legacy', 'readTag', 0, false, 'any']]);
    assert.ok(m.hideSparkplugWatch, 'a component with tags hides the generic Tag Watch');
});

ok('props: type inferred from the default, labels humanized, enum options normalized, css / state CSS props', () => {
    const m = S.buildMeta(DEF);
    assert.deepStrictEqual([m.props.steps.type, m.props.steps.label, m.props.names.type], ['number', 'Steps', 'list']);
    assert.deepStrictEqual(m.props.align.options, [{ value: 'left', label: 'left' }, { value: 'right', label: 'Right!', icon: undefined }]);
    assert.deepStrictEqual([m.props.css.default, m.props.cssFocus.default, m.props.cssFocus.state], ['.box { color: red; }', 'outline: 1px solid blue;', 'focus']);
    assert.strictEqual(m.props.cssNormal, undefined, 'a state without a selector has no CSS prop');
});

ok('events, actions, states, version, internal state', () => {
    const m = S.buildMeta(DEF);
    assert.deepStrictEqual(m.eventList.map((e) => [e.name, e.label]), [['change', 'On Change'], ['blur', 'On Blur']]);
    assert.deepStrictEqual(m.actionList.map((a) => [a.name, a.label]), [['reset', 'Reset'], ['bump', 'Bump']]);
    assert.deepStrictEqual(m.stateList.map((s) => [s.name, !!s.selector]), [['normal', false], ['focus', true]]);
    assert.deepStrictEqual([m.version, m.state], [2, { zoom: 1 }]);
});

ok('a property colliding with an input / output prop is refused; `id` is required', () => {
    assert.throws(() => S.buildMeta({ id: 'x', inputs: { a: { prop: 'k' } }, properties: { k: {} } }), /collides/);
    assert.throws(() => S.buildMeta({}), /id/);
});

ok('legacy defaults / default values / stylesheet / migrateProps', () => {
    const m = S.buildMeta(DEF);
    assert.deepStrictEqual(S.legacyDefaults(m).opacity, { value: 1, type: 'number' });
    assert.deepStrictEqual(S.legacyDefaults(m).cssFocus, { value: 'outline: 1px solid blue;', type: 'css' });
    const v = S.defaultValues(m);
    assert.strictEqual(S.buildStylesheet(m, v), '.box { color: red; }\n.box.focused {\noutline: 1px solid blue;\n}');
    assert.strictEqual(S.buildStylesheet(m, Object.assign({}, v, { cssFocus: '.x { a: b }', css: '' })), '.box { color: red; }\n.x { a: b }');
    assert.deepStrictEqual(S.migrateProps(m, { color: 'red' }), { barColor: 'red', __v: 2 });
    const current = { barColor: 'blue', __v: 2 };
    assert.strictEqual(S.migrateProps(m, current), current, 'already current: untouched');
});

ok('parts: each gets a css<Part> prop; the stylesheet is base, parts, then states; collisions refused', () => {
    const m = S.buildMeta(Object.assign({}, DEF, { parts: { label: { selector: '.lbl', css: 'font-weight: 600;' } } }));
    assert.deepStrictEqual([m.props.cssLabel.type, m.props.cssLabel.part, m.props.cssLabel.label], ['css', 'label', 'Label CSS']);
    assert.strictEqual(S.buildStylesheet(m, S.defaultValues(m)), '.box { color: red; }\n.lbl {\nfont-weight: 600;\n}\n.box.focused {\noutline: 1px solid blue;\n}');
    assert.throws(() => S.buildMeta({ id: 'x', properties: { cssLabel: {} }, parts: { label: { selector: '.l' } } }), /collides/);
    assert.throws(() => S.buildMeta({ id: 'x', parts: { focus: { selector: '.l' } }, states: { focus: { selector: '.f' } } }), /share the CSS prop/);
    assert.throws(() => S.buildMeta({ id: 'x', parts: { label: {} } }), /needs a selector/);
});

ok('tags: "{provider:address}", Sparkplug built in, any provider can register', () => {
    const t = T.parseTag('{sparkplug:Plant::Edge1::Mixer::Line1/Speed}');
    assert.deepStrictEqual([t.provider, t.valid, t.display], ['sparkplug', true, 'Plant / Edge1 / Mixer / Line1/Speed']);
    assert.deepStrictEqual(t.ref, { groupId: 'Plant', edgeNodeId: 'Edge1', deviceId: 'Mixer', metricName: 'Line1/Speed' });
    assert.strictEqual(T.parseTag('{sparkplug:Plant::Edge1::::M}').ref.deviceId, null, 'node-scoped metric');
    assert.strictEqual(T.parseTag('{sparkplug:bad}').valid, false);
    assert.deepStrictEqual([T.parseTag('{opcua:ns=2;s=X}').known, T.isTag('{opcua:ns=2;s=X}')], [false, false], 'unknown provider');
    T.defineTagProvider('opcua', { label: 'OPC UA', parse: (a) => (/^ns=\d+;s=.+$/.test(a) ? { id: a } : null) });
    assert.deepStrictEqual([T.parseTag('{opcua:ns=2;s=X}').valid, T.isTag('{opcua:ns=2;s=X}'), T.parseTag('{opcua:nope}').valid], [true, true, false]);
    assert.strictEqual(T.makeTag('opcua', 'ns=2;s=X'), '{opcua:ns=2;s=X}');
    T.extendTagProvider('opcua', { list: () => [{ address: 'ns=2;s=X' }] });
    assert.strictEqual(T.getTagProvider('opcua').list().length, 1);
    assert.deepStrictEqual(T.listTagProviders().map((p) => p.name), ['sparkplug', 'opcua']);
    assert.strictEqual(T.parseTag('plain text {not a tag}'), null);
    assert.throws(() => T.defineTagProvider('x', {}), /parse/);
});

ok('codecs: float / int / text parse, format, edit text, equals, live grouping; custom codecs', () => {
    const f = C.getCodec('float'), i = C.getCodec('int'), t = C.getCodec('text');
    const p = { decimals: 2, decimalSeparator: ',', thousandsSeparator: '.', max: 1000 };
    assert.strictEqual(f.format(1234.567, p), '1.234,57');
    assert.strictEqual(f.editText(1234.567, p), '1.234,57', 'grouped while typing');
    assert.strictEqual(f.editText(1234.567, Object.assign({}, p, { groupWhileTyping: false })), '1234,57');
    assert.deepStrictEqual(f.parse('999,999', p), { ok: true, value: 1000 });
    assert.deepStrictEqual(f.parse('1.000,5', p), { ok: false, reason: 'maximum is 1000' });
    assert.deepStrictEqual(f.parse('', p), { ok: false, empty: true, reason: 'empty' });
    assert.ok(f.equals('12.50', 12.5));
    assert.strictEqual(f.live(p).separator, '.');
    assert.deepStrictEqual(i.parse('12.5', {}), { ok: false, reason: 'whole number required' });
    assert.deepStrictEqual(t.parse('abcdef', { maxLength: 3 }), { ok: false, reason: 'maximum 3 characters' });
    assert.deepStrictEqual(t.parse('ab-1', { pattern: '[A-Z]{2}-\\d', patternMessage: 'XX-0' }), { ok: false, reason: 'XX-0' });
    C.defineCodec('ipv4', { parse: (x) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(x) ? { ok: true, value: x } : { ok: false, reason: 'invalid IP' }) });
    assert.deepStrictEqual(C.getCodec('ipv4').parse('10.0.0'), { ok: false, reason: 'invalid IP' });
    assert.throws(() => C.getCodec('nope'), /unknown codec/);
});

console.log(`\n${passed} passed\nALL OK`);
