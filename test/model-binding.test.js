'use strict';
// A prop's value: static or a binding priority list (src/model/binding.js): the first source with a
// value wins, static last; expressions over scoped references (no eval); legacy strings still read;
// the tags a value needs subscribed.   node test/model-binding.test.js

const assert = require('assert');
const M = require('../dist/nexa-model.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }

// a world: what each source has now
function reader(world) {
    return (src, ref) => (world[src] || {})[ref];
}

ok('the first source with a value wins; one without falls through; static is the last', () => {
    const v = M.bindingList([{ src: 'sparkplug', ref: 'G::E::D::State' }, { src: 'shared', ref: 'state' }, { src: 'msg', ref: 'payload.state' }], 'IDLE');
    const w = { sparkplug: { 'G::E::D::State': 'RUNNING' }, shared: { state: 'SHARED' }, msg: {} };
    assert.deepStrictEqual(M.resolveValue(v, reader(w)), { value: 'RUNNING', from: 0 });
    w.sparkplug['G::E::D::State'] = '???';                         // the tag is unknown (offline)
    assert.deepStrictEqual(M.resolveValue(v, reader(w)), { value: 'SHARED', from: 1 });
    w.shared.state = null;
    w.msg['payload.state'] = 'FROM MSG';
    assert.deepStrictEqual(M.resolveValue(v, reader(w)), { value: 'FROM MSG', from: 2 });
    w.msg['payload.state'] = undefined;
    assert.deepStrictEqual(M.resolveValue(v, reader(w)), { value: 'IDLE', from: -1 }, 'static, last');
});

ok('0, false and "" are values, not "none"', () => {
    const v = M.bindingList([{ src: 'app', ref: 'a' }], 99);
    for (const x of [0, false, '']) assert.deepStrictEqual(M.resolveValue(v, reader({ app: { a: x } })).value, x);
    assert.strictEqual(M.resolveValue(42, reader({})).value, 42, 'a static value is itself');
});

ok('expressions: arithmetic over scoped references, joined text (the user\'s example)', () => {
    const w = { screen: { var3: 8 }, app: { var1: 2 }, shared: { var2: 4 }, sparkplug: { 'sparkplug::abxdefg': 7 } };
    const e = '(0.5 * [screen]{var3}) / [app]{var1} / [shared]{var2} + 10 / 5 + [sparkplug]{sparkplug::abxdefg} " unit"';
    // (0.5*8)/2/4 + 2 + 7 = 0.5 + 2 + 7 = 9.5, then " unit"
    assert.strictEqual(M.evaluateExpression(e, reader(w)), '9.5 unit');
    assert.strictEqual(M.evaluateExpression('[app]{var1} * 3', reader(w)), 6);
    assert.strictEqual(M.evaluateExpression('"Line " [screen]{var3} ": " round(10 / 3, 2)', reader(w)), 'Line 8: 3.33');
    assert.strictEqual(M.evaluateExpression('[screen]{var3} > 5 ? "high" : "low"', reader(w)), 'high');
    assert.strictEqual(M.evaluateExpression('"12.5" * 2', reader({})), 25, 'numeric text is a number');
    assert.strictEqual(M.evaluateExpression('[app]{missing} + 1', reader(w)), null, 'a reference without a value: none');
    assert.strictEqual(M.evaluateExpression('1 / 0', reader(w)), null, 'no Infinity');
    assert.ok(M.parseExpression('(1 +').error, 'a syntax error is reported, not thrown');
    assert.strictEqual(M.evaluateExpression('(1 +', reader(w)), null);
    assert.ok(M.parseExpression('alert(1)').error, 'only known functions');
    assert.deepStrictEqual(M.referencesOf(e).map((r) => r.src), ['screen', 'app', 'shared', 'sparkplug']);
});

ok('an expression source falls through when it has no value', () => {
    const v = M.bindingList([{ src: 'expr', ref: '[app]{x} * 2' }, { src: 'shared', ref: 'y' }], 0);
    assert.deepStrictEqual(M.resolveValue(v, reader({ app: {}, shared: { y: 5 } })), { value: 5, from: 1 });
    assert.deepStrictEqual(M.resolveValue(v, reader({ app: { x: 4 }, shared: { y: 5 } })), { value: 8, from: 0 });
});

ok('legacy strings are still read: tag, message, variable, template text; __fallback = static', () => {
    assert.deepStrictEqual(M.toBindingList('{sparkplug:G::E::D::M}', 'f'), { sources: [{ src: 'sparkplug', ref: 'G::E::D::M' }], static: 'f', legacy: true });
    assert.deepStrictEqual(M.toBindingList('{msg.payload.v}').sources, [{ src: 'msg', ref: 'payload.v' }]);
    assert.deepStrictEqual(M.toBindingList('{speed}').sources, [{ src: 'var', ref: 'speed' }]);
    const t = M.toBindingList('Line {line}: {sparkplug:G::E::D::S} rpm');
    assert.strictEqual(t.sources[0].src, 'expr');
    assert.strictEqual(M.evaluateExpression(t.sources[0].ref, reader({ var: { line: 1 }, sparkplug: { 'G::E::D::S': 1500 } })), 'Line 1: 1500 rpm');
    assert.strictEqual(M.isBoundValue('{asset:logo}'), false, 'an asset is a value');
    assert.strictEqual(M.isBoundValue('{token:colors.bg}'), false, 'a token is a value');
    assert.strictEqual(M.isBoundValue(M.bindingList([], 1)), true);
});

ok('the tags to subscribe: tag sources and tags inside expressions', () => {
    const v = M.bindingList([{ src: 'sparkplug', ref: 'G::E::D::A' }, { src: 'expr', ref: '[sparkplug]{G::E::D::B} * 2' }, { src: 'app', ref: 'x' }], 0);
    assert.deepStrictEqual(M.tagRefsOf(v), [{ provider: 'sparkplug', address: 'G::E::D::A' }, { provider: 'sparkplug', address: 'G::E::D::B' }]);
    assert.deepStrictEqual(M.tagRefsOf('{sparkplug:G::E::D::C}'), [{ provider: 'sparkplug', address: 'G::E::D::C' }]);
    assert.deepStrictEqual(M.tagRefsOf(12), []);
    assert.strictEqual(M.readsMessage(M.bindingList([{ src: 'expr', ref: '[msg]{payload} + 1' }], 0)), true);
    assert.strictEqual(M.readsMessage('{msg.x}'), true);
});

ok('source kinds are a registry (OPC UA and others later)', () => {
    const k = M.registerSourceKind('opcua', { label: 'OPC UA tag', tag: true, provider: 'opcua' });
    assert.strictEqual(M.sourceKind('opcua'), k);
    const v = M.bindingList([{ src: 'opcua', ref: 'ns=2;s=Motor.Speed' }], 0);
    assert.deepStrictEqual(M.tagRefsOf(v), [{ provider: 'opcua', address: 'ns=2;s=Motor.Speed' }]);
    assert.ok(M.sourceKinds().map((x) => x.name).includes('param'));
});

console.log(passed + ' passed');
console.log('ALL OK');
