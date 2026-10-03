'use strict';

// The plugin rules' guard (sdk/lint-plugin.js, docs/PLUGIN_RULES.md): the linter itself on a
// plugin made to break each rule, then every Nexa plugin next to the dashboard in this workspace.
//   node test/plugin-rules.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lintPlugin, RULES } = require('../sdk/lint-plugin.js');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('✔ ' + label); }

function fakePlugin(files, pkg) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-lint-'));
    fs.mkdirSync(path.join(dir, 'dist')); fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(path.join(dir, 'test', 'browser.test.js'), '');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg || { scripts: { test: 'x' }, 'node-red': { plugins: { a: 'b' } } }));
    Object.keys(files).forEach((f) => fs.writeFileSync(path.join(dir, 'dist', f), files[f]));
    return dir;
}
const rules = (problems) => problems.map((p) => p.rule).sort();

ok('every rule fires on code that breaks it', () => {
    const dir = fakePlugin({ 'bad.js': [
        'import { html } from "lit";',
        'import x from "https://cdn.example.com/x.js";',
        'import { defineComponent } from "../../nexa-sdk/nexa-component-sdk.js";',
        'import "./ok.js";',
        'defineComponent({ id: "a-b", inspector: () => html`` });',
        'NEXA.registerComponent("x", {});',
        'setInterval(() => {}, 100);',
        'fetch("/x"); new WebSocket("ws://x");',
        'localStorage.setItem("a", 1);',
        'eval("1"); new Function("return 1");',
        'RED.notify("x"); window.RED;',
        'document.querySelector(".x");'
    ].join('\n') });
    const got = rules(lintPlugin(dir));
    ['sdk-import-only', 'no-inspector', 'no-legacy-register', 'no-set-interval', 'network', 'storage', 'no-eval', 'no-red-global', 'no-document-query']
        .forEach((r) => assert.ok(got.includes(r), r + ' missing in ' + got));
    assert.strictEqual(got.filter((r) => r === 'sdk-import-only').length, 2, 'lit and the URL; not the SDK facade nor ./ok.js');
});

ok('comments and strings are not code; a justified exception passes, an unjustified one does not', () => {
    const dir = fakePlugin({ 'ok.js': [
        '// setInterval( in a comment; fetch( too',
        '/* inspector: in a block comment */',
        'const help = "use fetch( on the server";',
        '// nexa-lint-allow network: the plugin\'s own admin route, editor only',
        'fetch("x");',
        'fetch("y"); // nexa-lint-allow network:',
        'this.p.label;  // this.RED.x is not the global',
        'obj.RED.x;'
    ].join('\n') });
    const got = lintPlugin(dir);
    assert.deepStrictEqual(got.map((p) => p.rule + ':' + p.line), ['network:6'], JSON.stringify(got));
});

ok('the package: node-red.plugins, scripts.test, test/browser.test.js', () => {
    const dir = fakePlugin({}, { name: 'x' });
    fs.rmSync(path.join(dir, 'test', 'browser.test.js'));
    assert.strictEqual(rules(lintPlugin(dir)).filter((r) => r === 'package').length, 3);
    assert.ok(Object.keys(RULES).every((r) => /PLUGIN_RULES §\d/.test(RULES[r])), 'every rule points to its section');
});

const plugins = fs.readdirSync(path.join(__dirname, '..', '..')).filter((n) => /^nexa-component-/.test(n));
plugins.forEach((name) => {
    ok('the plugin ' + name + ' follows the rules', () => {
        const problems = lintPlugin(path.join(__dirname, '..', '..', name));
        assert.deepStrictEqual(problems.map((p) => p.file + ':' + p.line + ' ' + p.rule), []);
    });
});

console.log(passed + ' passed');
console.log('ALL OK');
