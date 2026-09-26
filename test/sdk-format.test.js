'use strict';

// Number formatting / parsing of the SDK (src/sdk/format.js — moved here from
// @kufayeka/nexa-component-fields, together with this test). Pure functions.
//   node test/sdk-format.test.js

const assert = require('assert');
const F = require('./sdk-load.js')('format.js').default;
let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }

ok('formatNumber: decimals, decimal separator, thousands separator', () => {
    assert.strictEqual(F.formatNumber(1234567.891, { decimals: 2 }), '1234567.89');
    assert.strictEqual(F.formatNumber(1234567.891, { decimals: 2, decimalSeparator: ',', thousandsSeparator: '.' }), '1.234.567,89');
    assert.strictEqual(F.formatNumber('1234567.891', { decimals: 1, thousandsSeparator: ',' }), '1,234,567.9');
    assert.strictEqual(F.formatNumber(-1234.5, { decimals: 0, thousandsSeparator: ' ' }), '-1 235');
    assert.strictEqual(F.formatNumber(0.1 + 0.2, { decimals: 2 }), '0.30');
    assert.strictEqual(F.formatNumber(-0.001, { decimals: 2, decimalSeparator: ',' }), '0,00', 'no "-0,00"');
    assert.strictEqual(F.formatNumber(12.5, { decimals: -1, decimalSeparator: ',' }), '12,5', '-1 = as is');
    assert.strictEqual(F.formatNumber(1e-7, { decimals: -1 }), '0.0000001', 'no exponent notation');
});

ok('formatNumber: non-numbers pass through (tag "???", text), same separators are refused', () => {
    assert.strictEqual(F.formatNumber('???', { decimals: 2 }), '???');
    assert.strictEqual(F.formatNumber('abc', {}), 'abc');
    assert.strictEqual(F.formatNumber(null, {}), '');
    assert.strictEqual(F.formatNumber(true, { decimals: 0 }), '1');
    assert.strictEqual(F.formatNumber(1234.5, { decimals: 1, decimalSeparator: ',', thousandsSeparator: ',' }), '1234,5', 'thousands dropped when equal to the decimal separator');
});

ok('editText: rounded, decimal separator, never thousands', () => {
    assert.strictEqual(F.editText(1234567.891, { decimals: 2, decimalSeparator: ',', thousandsSeparator: '.' }), '1234567,89');
});

ok('parseNumber: configured separators, numpad ".", thousands, garbage', () => {
    const de = { decimalSeparator: ',', thousandsSeparator: '.' };
    assert.deepStrictEqual(F.parseNumber('12,5', de), { ok: true, value: 12.5 });
    assert.deepStrictEqual(F.parseNumber('12.5', de), { ok: true, value: 12.5 }, 'a single "." (numpad) is the decimal point');
    assert.deepStrictEqual(F.parseNumber('1.234,5', de), { ok: true, value: 1234.5 });
    assert.deepStrictEqual(F.parseNumber('1.234.567', de), { ok: true, value: 1234567 });
    assert.deepStrictEqual(F.parseNumber('1,234.5', {}), { ok: true, value: 1234.5 });
    assert.deepStrictEqual(F.parseNumber(' -3 ', {}), { ok: true, value: -3 });
    assert.deepStrictEqual(F.parseNumber('1 234', { thousandsSeparator: ' ' }), { ok: true, value: 1234 });
    assert.deepStrictEqual(F.parseNumber('.5', {}), { ok: true, value: 0.5 });
    assert.strictEqual(F.parseNumber('', {}).empty, true);
    for (const bad of ['abc', '1-2', '1e5', '--1', '1,2,3.4.5x']) assert.strictEqual(F.parseNumber(bad, {}).ok, false, bad);
});

ok('validateNumber: integer, min / max, rounding to the decimals', () => {
    const p = (t) => F.parseNumber(t, {});
    assert.deepStrictEqual(F.validateNumber(p('12.5'), { integer: true }), { ok: false, reason: 'whole number required' });
    assert.deepStrictEqual(F.validateNumber(p('12'), { integer: true, min: 0, max: 100 }), { ok: true, value: 12 });
    assert.deepStrictEqual(F.validateNumber(p('-1'), { min: 0 }), { ok: false, reason: 'minimum is 0' });
    assert.deepStrictEqual(F.validateNumber(p('101'), { max: '100' }), { ok: false, reason: 'maximum is 100' });
    assert.deepStrictEqual(F.validateNumber(p('1.2345'), { decimals: 2 }), { ok: true, value: 1.23 });
    assert.deepStrictEqual(F.validateNumber(p('1.2345'), { decimals: -1, min: '' }), { ok: true, value: 1.2345 });
    assert.strictEqual(F.validateNumber(p('x'), {}).ok, false);
});

ok('liveGroup: groups the integer part while typing and keeps the caret after the same digit', () => {
    const de = { decimalSeparator: ',', thousandsSeparator: '.' };
    // typing "1234567,5" one character at a time
    let text = '', caret = 0;
    for (const ch of '1234567,5') {
        const r = F.liveGroup(text.slice(0, caret) + ch + text.slice(caret), caret + 1, ch, de);
        text = r.text; caret = r.caret;
    }
    assert.deepStrictEqual({ text, caret }, { text: '1.234.567,5', caret: 11 });
    // caret in the middle: "1.234|" + "5" -> "12.345|"
    assert.deepStrictEqual(F.liveGroup('1.2345', 6, '5', de), { text: '12.345', caret: 6 });
    assert.deepStrictEqual(F.liveGroup('1.2534', 4, '5', de), { text: '12.534', caret: 4 }, 'typed after "2": caret stays after it');
    // deleting a digit regroups
    assert.deepStrictEqual(F.liveGroup('1.23', 4, null, de), { text: '123', caret: 3 });
});

ok('liveGroup: a typed "." or "," is the decimal point, a second one is ignored, sign + leading zeros', () => {
    const de = { decimalSeparator: ',', thousandsSeparator: '.' };
    assert.deepStrictEqual(F.liveGroup('1.234.', 6, '.', de), { text: '1.234,', caret: 6 }, 'numpad "." -> decimal comma');
    assert.deepStrictEqual(F.liveGroup('1.234,5,', 8, ',', de), { text: '1.234,5', caret: 7 }, 'second decimal ignored');
    assert.deepStrictEqual(F.liveGroup('-12345', 6, '5', de), { text: '-12.345', caret: 7 });
    assert.deepStrictEqual(F.liveGroup('0012', 4, '2', de), { text: '12', caret: 2 });
    assert.deepStrictEqual(F.liveGroup('0,5', 3, '5', de), { text: '0,5', caret: 3 });
    const us = { decimalSeparator: '.', thousandsSeparator: ',' };
    assert.deepStrictEqual(F.liveGroup('1234,', 5, ',', us), { text: '1,234.', caret: 6 }, '"," typed in a dot-decimal field is the decimal point');
    assert.deepStrictEqual(F.liveGroup('abc', 3, 'c', us), { text: '', caret: 0 });
    assert.deepStrictEqual(F.liveGroup('1234', 4, '4', { decimalSeparator: '.' }), { text: '1234', caret: 4 }, 'no thousands separator: unchanged');
});

ok('parseNumber strict (grouped while typing): only the configured separators', () => {
    const de = { decimalSeparator: ',', thousandsSeparator: '.', strict: true };
    assert.deepStrictEqual(F.parseNumber('1.234', de), { ok: true, value: 1234 }, '"." is thousands here, not a decimal');
    assert.deepStrictEqual(F.parseNumber('1.234.567,5', de), { ok: true, value: 1234567.5 });
    assert.deepStrictEqual(F.parseNumber('1 234.5', { decimalSeparator: '.', thousandsSeparator: ' ', strict: true }), { ok: true, value: 1234.5 });
    assert.strictEqual(F.parseNumber('12,5', { decimalSeparator: '.', thousandsSeparator: ' ', strict: true }).ok, false);
});

console.log(`\n${passed} passed\nALL OK`);
