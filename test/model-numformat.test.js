'use strict';
// One number format for axes, tooltips, legends (src/model/numformat.js); fmt() in expressions.
//   node test/model-numformat.test.js
const assert = require('assert');
const M = require('../dist/nexa-model.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }
const f = (v, spec, unit) => M.formatValue(v, Object.assign({ separators: 'dot' }, spec), unit);

ok('as it is, the thousands separator on / off, dot or comma', () => {
    assert.strictEqual(f(1234567.25), '1,234,567.25');
    assert.strictEqual(f(1234567.25, { thousands: false }), '1234567.25');
    assert.strictEqual(f(1234567.25, { separators: 'comma' }), '1.234.567,25');
    assert.strictEqual(f(0.1 + 0.2), '0.3', 'no float noise');
    assert.strictEqual(f(-0.0000001, { decimals: 2 }), '0.00', 'no "-0"');
});

ok('decimals: fixed, a range', () => {
    assert.strictEqual(f(3.14159, { decimals: 2 }), '3.14');
    assert.strictEqual(f(3, { minDecimals: 1, maxDecimals: 3 }), '3.0');
    assert.strictEqual(f(3.14159, { minDecimals: 1, maxDecimals: 3 }), '3.142');
});

ok('short: K / M / B / T, 3 significant digits', () => {
    assert.strictEqual(f(999), '999');
    assert.strictEqual(f(1234, { notation: 'compact' }), '1.23K');
    assert.strictEqual(f(45678, { notation: 'compact' }), '45.7K');
    assert.strictEqual(f(2500000, { notation: 'compact' }), '2.5M');
    assert.strictEqual(f(7.1e9, { notation: 'compact' }, 'pcs'), '7.1B pcs');
    assert.strictEqual(f(1234, { notation: 'compact', separators: 'comma' }), '1,23K');
});

ok('engineering: an SI unit is scaled itself (1 500 kW = 1.5 MW, 0.002 s = 2 ms); another gets the prefix', () => {
    assert.strictEqual(f(1500, { notation: 'si' }, 'kW'), '1.5 MW');
    assert.strictEqual(f(0.002, { notation: 'si' }, 's'), '2 ms');
    assert.strictEqual(f(250, { notation: 'si' }, 'W'), '250 W');
    assert.strictEqual(f(1500, { notation: 'si' }, 'rpm'), '1.5k rpm');
    assert.deepStrictEqual(M.splitSiUnit('mA'), { factor: 1e-3, base: 'A' });
    assert.strictEqual(M.splitSiUnit('min'), null, '"min" is not milli-in');
});

ok('scientific, the unit before / hidden', () => {
    assert.strictEqual(f(123456, { notation: 'scientific', decimals: 2 }), '1.23e5');
    assert.strictEqual(f(12, { unitAt: 'before' }, '$'), '$ 12');
    assert.strictEqual(f(12, { unitAt: 'none' }, 'kW'), '12');
});

ok('the number and its shown unit apart (a text goes between them)', () => {
    assert.deepStrictEqual(M.formatParts(1500, { notation: 'si', separators: 'dot' }, 'kW'), { text: '1.5', unit: 'MW' });
    assert.deepStrictEqual(M.formatParts(1500, { separators: 'dot' }, 'kW'), { text: '1,500', unit: 'kW' });
    assert.deepStrictEqual(M.formatParts(2, { separators: 'dot' }, ''), { text: '2', unit: '' });
});

ok('fmt() in an expression', () => {
    const read = (src, ref) => ({ value: 15300, other: 4 })[ref];
    // fmt() follows the page's language (this machine's: "15,3K" in German)
    assert.ok(/^15[.,]3K units$/.test(M.evaluateExpression('fmt({value}, "compact") " units"', read)));
    assert.ok(/^3[.,]8 kW$/.test(M.evaluateExpression('fmt({value} / {other}, "si", 1, "W")', read)));
});

console.log(passed + ' passed');
console.log('ALL OK');
