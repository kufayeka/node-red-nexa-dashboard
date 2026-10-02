'use strict';
// src/model/theme.js (as lib/nexa-model.js): tokens, semantic tokens light / dark, the
// palettes' own tokens and colors.primary, an app's own categories, generated palettes,
// the CSS variables, {token:…} in props and in a frame's CSS.   node test/model-theme.test.js

const assert = require('assert');
const M = require('../dist/nexa-model.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }

const T = M.themeOf({});

ok('tokens by path; semantic ones follow their references, light and dark', () => {
    assert.strictEqual(M.resolveToken(T, 'colors.blue.600'), '#0f62fe');
    assert.strictEqual(M.resolveToken(T, 'fontSizes.lg'), 18);
    assert.strictEqual(M.resolveToken(T, 'spacing.4'), 16);
    assert.strictEqual(M.resolveToken(T, 'colors.bg.subtle', 'light'), '#f4f4f4');
    assert.strictEqual(M.resolveToken(T, 'colors.bg.subtle', 'dark'), '#262626');
    assert.strictEqual(M.resolveToken(T, 'colors.fg', 'dark'), '#f4f4f4');
    assert.strictEqual(M.resolveToken(T, 'colors.nope'), undefined);
});
ok('each palette has its own tokens (Chakra\'s colorPalette); colors.primary is the primary palette', () => {
    assert.strictEqual(M.resolveToken(T, 'colors.red.solid'), '#da1e28');
    assert.strictEqual(M.resolveToken(T, 'colors.red.subtle', 'dark'), '#520408');
    assert.strictEqual(M.resolveToken(T, 'colors.yellow.contrast'), '#000000', 'black on yellow');
    assert.strictEqual(M.resolveToken(T, 'colors.gray.solid', 'dark'), '#ffffff');
    assert.strictEqual(M.resolveToken(T, 'colors.primary.solid'), M.resolveToken(T, 'colors.blue.solid'));
    assert.strictEqual(M.resolveToken(T, 'colors.primary.300'), '#78a9ff');
});
ok('an app\'s own category replaces the default\'s; its primary palette', () => {
    const t = M.themeOf({ theme: { primary: 'green', fontSizes: { body: 15 }, semantic: { brand: { light: '{colors.primary.600}', dark: '#abcdef' } } } });
    assert.strictEqual(M.resolveToken(t, 'colors.primary.solid'), '#198038');
    assert.strictEqual(M.resolveToken(t, 'fontSizes.body'), 15);
    assert.strictEqual(M.resolveToken(t, 'fontSizes.lg'), undefined, 'the app\'s font sizes are its own list');
    assert.strictEqual(M.resolveToken(t, 'colors.brand'), '#198038');
    assert.strictEqual(M.resolveToken(t, 'colors.brand', 'dark'), '#abcdef');
    assert.strictEqual(M.resolveToken(t, 'spacing.4'), 16, 'the rest: the defaults');
    assert.strictEqual(M.themeOf({ theme: { primary: 'nope' } }).primary, 'blue');
});
ok('a palette from one colour: 500 is that colour, lighter to 50, darker to 950', () => {
    const p = M.generatePalette('#6366f1');
    assert.deepStrictEqual(Object.keys(p), M.SHADES);
    assert.strictEqual(p['500'], '#6366f1');
    const lum = (h) => { const n = parseInt(h.slice(1), 16); return (n >> 16 & 255) * 0.3 + (n >> 8 & 255) * 0.59 + (n & 255) * 0.11; };
    const l = M.SHADES.map((s) => lum(p[s]));
    assert.ok(l.every((v, i) => i === 0 || v < l[i - 1]), 'darker at each step: ' + l.map(Math.round).join(' '));
    assert.strictEqual(M.generatePalette('not a colour'), null);
});
ok('CSS variables: every token on the root, the dark values that differ on the dark selector; px where a size', () => {
    const css = M.themeCss(T, ':root', '.dark');
    assert.ok(css.indexOf('--nexa-colors-blue-600: #0f62fe;') !== -1);
    assert.ok(css.indexOf('--nexa-spacing-4: 16px;') !== -1);
    assert.ok(css.indexOf('--nexa-fontWeights-bold: 700;') !== -1);
    const dark = css.split('.dark {')[1];
    assert.ok(dark.indexOf('--nexa-colors-bg-subtle: #262626;') !== -1);
    assert.strictEqual(dark.indexOf('--nexa-colors-blue-500'), -1, 'a plain token is the same in both');
    assert.strictEqual(M.tokenVar('colors.bg.subtle'), 'var(--nexa-colors-bg-subtle)');
});
ok('{token:…} in props: a whole one keeps its type, in a text its value; the same object when none', () => {
    const props = { size: '{token:fontSizes.xl}', color: '{token:colors.primary.solid}', text: 'gap {token:spacing.2}px', plain: 3 };
    const out = M.resolveTokenProps(props, T, 'light');
    assert.deepStrictEqual(out, { size: 20, color: '#0f62fe', text: 'gap 8px', plain: 3 });
    assert.strictEqual(M.resolveTokenProps({ a: 1 }, T, 'light').a, 1);
    const same = { a: 'x' };
    assert.strictEqual(M.resolveTokenProps(same, T, 'dark'), same);
    assert.strictEqual(M.resolveTokenValue('{token:colors.bg}', T, 'dark'), '#161616');
});
ok('a frame\'s CSS: token fill / stroke / radius / gap become CSS variables (the mode needs no redraw)', () => {
    const f = { type: '@frame', w: 100, h: 100, layout: { mode: 'horizontal', gap: '{token:spacing.4}' },
        style: { fill: '{token:colors.bg.subtle}', stroke: '{token:colors.border}', strokeWidth: 1, radius: '{token:radii.md}' } };
    const css = M.frameCss(f);
    assert.strictEqual(css.background, 'var(--nexa-colors-bg-subtle)');
    assert.strictEqual(css.border, '1px solid var(--nexa-colors-border)');
    assert.strictEqual(css['border-radius'], 'var(--nexa-radii-md)');
    assert.strictEqual(css['column-gap'], 'var(--nexa-spacing-4)');
    // plain values as before
    const g = M.frameCss({ type: '@frame', layout: { mode: 'vertical', gap: 8 }, style: { fill: '#fff', radius: 4 } });
    assert.deepStrictEqual([g.background, g['border-radius'], g['row-gap']], ['#fff', '4px', '8px']);
});

console.log(`\n${passed} passed\nALL OK`);
