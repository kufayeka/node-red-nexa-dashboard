'use strict';
// Shared variables across pages, end to end: two real browser pages on an isolated
// Node-RED (temp userDir, 1899 / 1898; never the user's data/). Page A sets the shared
// variable "mode"; page B, already open, must show the new value and fire its
// Watch Variable node.
//   node test/shared-vars-e2e.test.js     (needs Chrome, the dashboard built, ports 1899 / 1898 free)
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { withPage } = require('../sdk/testkit/cdp.js');
const RED_JS = path.resolve(__dirname, '../../../node-red/red.js');
const PORTS = { editor: 1899, pages: 1898 };
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-shared-e2e-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, actual) => { if (!ok) failures++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (actual !== undefined ? '   ' + JSON.stringify(actual) : '')); };

function screen(id, p, logic, components) {
    return { id, name: id, path: p, width: 400, height: 200, gridSize: 10, snap: false, treeVersion: 1, orphans: [], components: components || [], logic, variables: [] };
}

function writeFlows() {
    const dir = path.join(S, 'nr');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.js'), 'module.exports = { uiPort: ' + PORTS.editor + ', flowFile: "flows.json", nexaDashboard: { screenWorkerPort: ' + PORTS.pages + ' }, logging: { console: { level: "warn" } }, editorTheme: { tours: false, projects: { enabled: false } } };\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'nr-shared', version: '0.0.1', private: true }));
    // page A: one second after it loads, mode = "RUNNING" (shared: every page sees it)
    const a = screen('sA', '/a', {
        nodes: [
            { id: 'la', type: 'onload' }, { id: 'da', type: 'delay', delay: 1000, unit: 'ms' },
            { id: 'sa', type: 'set-variable', scope: '@shared', name: 'mode', op: 'set', valueSource: 'static', value: 'RUNNING' }
        ],
        wires: [{ from: 'la', to: 'da' }, { from: 'da', to: 'sa' }]
    });
    // page B: shows {mode}, and a Watch Variable on it records every change
    const b = screen('sB', '/b', {
        nodes: [
            { id: 'wb', type: 'on-variable-change', variables: [{ scope: '@shared', name: 'mode' }], scope: '@shared', name: 'mode' },
            { id: 'fb', type: 'function', code: 'window.__seen = (window.__seen || []).concat([msg.payload]); return null;' }
        ],
        wires: [{ from: 'wb', to: 'fb' }]
    }, [{ id: 'st', type: 'nexa-ui-stat', x: 10, y: 10, w: 220, h: 96, props: { label: 'Mode {mode}', inputValue: '1', change: '' } }]);
    const project = { id: 'proj', type: 'kufayeka-nexa-project', name: 'Shared', sparkplugConnection: '', screens: [a, b], templates: [], types: [], breakpoints: [], theme: null,
        variables: [], sharedVariables: [{ id: 'sv1', name: 'mode', type: 'string', defaultValue: 'IDLE' }] };
    fs.writeFileSync(path.join(dir, 'flows.json'), JSON.stringify([{ id: 'tab1', type: 'tab', label: 'T' }, project], null, 1));
    return dir;
}

const portFree = (port) => new Promise((resolve) => { const t = net.createServer().once('error', () => resolve(false)).once('listening', () => t.close(() => resolve(true))).listen(port, '127.0.0.1'); });

(async () => {
    for (const p of Object.values(PORTS)) {
        if (!(await portFree(p))) { console.error('port ' + p + ' is in use (a Node-RED running?) - stop it first'); process.exit(1); }
    }
    const dir = writeFlows();
    const nr = spawn(process.execPath, [RED_JS, '-u', dir], { cwd: path.resolve(RED_JS, '../../..'), stdio: ['ignore', fs.openSync(path.join(S, 'nr.log'), 'w'), fs.openSync(path.join(S, 'nr.err'), 'w')] });
    const base = 'http://127.0.0.1:' + PORTS.pages + '/nexa';
    try {
        for (let i = 0; i < 60; i++) { try { if (await fetch(base + '/b').then((r) => r.status === 200)) break; } catch (e) { /* not yet */ } await wait(1000); }
        await wait(1500);
        const stat = 'document.querySelector(\'[data-id="st"] > *\').renderRoot.textContent.replace(/\\s+/g, " ")';
        const r = await withPage(base + '/b', async ({ js, logs }) => {
            await wait(2000);
            const before = await js(stat);
            check('page B shows the default (IDLE)', /Mode IDLE/.test(before), before.trim().slice(0, 40));
            // page A, a second browser: sets mode = RUNNING one second after it loads
            await withPage(base + '/a', async () => { await wait(2500); }, { ready: 'document.readyState === "complete"', readyTries: 100 });
            await wait(500);
            const after = await js(stat);
            const seen = await js('window.__seen || []');
            check('page B shows the value page A set (RUNNING)', /Mode RUNNING/.test(after), after.trim().slice(0, 40));
            check('page B\'s Watch Variable fired with it', seen.indexOf('RUNNING') !== -1, seen);
            check('no page errors on B', logs.filter((l) => !/favicon/.test(l)).length === 0, logs);
            return true;
        }, { ready: 'document.readyState === "complete"', readyTries: 100 });
        if (r === null) console.log('SKIP: no Chrome');
    } finally {
        nr.kill();
        await wait(500);
        try { fs.rmSync(S, { recursive: true, force: true }); } catch (e) { /* still held */ }
    }
    console.log(failures ? 'FAILED: ' + failures : 'ALL OK');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
