'use strict';
// The editor keeps its selection, end to end: an isolated Node-RED (temp userDir, 1899 / 1898;
// never the user's data/), the Pages editor in headless Chrome, real mouse clicks on the canvas.
// Each check is one of the ways the selection used to get lost (ARCHITECTURE.md, inspector).
//   node test/editor-selection-e2e.test.js     (needs Chrome, the dashboard built, ports 1899 / 1898 free)
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { withPage } = require('../sdk/testkit/cdp.js');
const RED_JS = path.resolve(__dirname, '../../../node-red/red.js');
const PORTS = { editor: 1899, pages: 1898 };
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-select-e2e-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, actual) => { if (!ok) failures++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (actual !== undefined ? '   ' + JSON.stringify(actual) : '')); };

function writeFlows() {
    const dir = path.join(S, 'nr');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.js'), 'module.exports = { uiPort: ' + PORTS.editor + ', flowFile: "flows.json", nexaDashboard: { screenWorkerPort: ' + PORTS.pages + ' }, logging: { console: { level: "warn" } }, editorTheme: { tours: false, projects: { enabled: false } } };\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'nr-select', version: '0.0.1', private: true }));
    const screen = { id: 'sS', name: 'Sel', path: '/sel', width: 900, height: 600, gridSize: 10, snap: false, treeVersion: 1, orphans: [], variables: [],
        logic: { nodes: [], wires: [] },
        components: [
            { id: 'A', type: 'nexa-ui-button', x: 40, y: 40, w: 140, h: 40, props: { text: 'A' } },
            { id: 'B', type: 'nexa-ui-input', x: 40, y: 140, w: 220, h: 64, props: { label: 'B' } },
            { id: 'T', type: 'nexa-ui-tabs', x: 400, y: 40, w: 360, h: 240, props: {} }
        ] };
    const project = { id: 'proj', type: 'kufayeka-nexa-project', name: 'Sel', sparkplugConnection: '', screens: [screen], templates: [], types: [], breakpoints: [], theme: null, variables: [] };
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
    try {
        for (let i = 0; i < 60; i++) { try { if (await fetch('http://127.0.0.1:' + PORTS.editor + '/').then((r) => r.status === 200)) break; } catch (e) { /* not yet */ } await wait(1000); }
        const r = await withPage('http://127.0.0.1:' + PORTS.editor + '/', async ({ js, send, logs }) => {
            await wait(3500);
            await js('RED.sidebar.show("nexa-dashboard-sidebar"); RED.actions.invoke("nexa:open-pages-editor"); true');
            await wait(2500);
            await js('(function(){ var b = Array.from(document.querySelectorAll("button")).find(function(b){ return /do not enable/i.test(b.textContent); }); if (b) b.click(); return true; })()');
            await js(`(function(){ var el = Array.from(document.querySelectorAll(".nexa-screen-list *")).find(function(e){ return e.children.length === 0 && e.textContent.trim() === "Sel"; }); ["mousedown","mouseup","click"].forEach(function(t){ el.dispatchEvent(new MouseEvent(t, {bubbles:true})); }); return 1; })()`);
            await wait(1500);
            const sel = () => js('__nexaEditorState.selectedIds.slice()');
            const node = (id) => `(function f(list){ for (var i=0;i<list.length;i++){ var n=list[i]; if (n.id===${JSON.stringify(id)}) return n; var c=f(n.children||[]); if (c) return c; } return null; })(__nexaEditorState.screens[0].components)`;
            // a real click (CDP mouse events) at the middle of a component on the canvas
            // at: "top" (near the top-left) or "bottom" (inside, near the bottom: clear of a Tabs' headers)
            const click = async (id, mods, at) => {
                const b = await js(`(function(){ var r = document.querySelector('[data-id="${id}"]').getBoundingClientRect(); return ${JSON.stringify(at || 'top')} === "bottom" ? { x: r.left + r.width / 2, y: r.bottom - 12 } : { x: r.left + Math.min(20, r.width / 2), y: r.top + Math.min(12, r.height / 2) }; })()`);
                const m = mods || 0;
                await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1, modifiers: m });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1, modifiers: m });
                await wait(400);
            };
            const key = async (k, code, vk, modifiers) => {
                await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers || 0 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers || 0 });
                await wait(300);
            };
            const showsTitle = (re) => js(`(function(){ var p = __nexaEditorState.propertiesPane; var t = p && p.get(0) ? p.get(0).textContent : ""; return ${re}.test(t); })()`);

            await click('A');
            check('a click on the canvas selects A', JSON.stringify(await sel()) === '["A"]', await sel());
            await js('__nexaEditorState.sidebarTabs.activateTab("properties"); true'); // the panel in view (the Screens tab was)
            await wait(300);

            // 1. typing in the Teleport field, then clicking B: B stays selected, A keeps what was typed
            // open every section of the panel (a fresh profile keeps some collapsed), then focus the field
            const typed = await js(`(function(){
                var p = __nexaEditorState.propertiesPane.get(0);
                Array.from(p.querySelectorAll("nx-section[collapsed]")).forEach(function(sec){ sec.removeAttribute("collapsed"); });
                var inp = Array.from(p.querySelectorAll("input")).find(function(i){ return /target/i.test(i.placeholder || ""); });
                if (!inp) return "no field";
                inp.focus(); return document.activeElement === inp; })()`);
            check('the Teleport field takes the focus', typed === true, typed);
            await send('Input.insertText', { text: 'zone1' });
            await wait(150);
            check('... and holds the typed text (not committed yet)', await js('document.activeElement && document.activeElement.value') === 'zone1' && !(await js(`${node('A')}.teleport`)), null);
            await click('B');
            await wait(600); // past the combobox's delayed commit
            check('clicking B while typing in A\'s panel: B is selected, and stays', JSON.stringify(await sel()) === '["B"]', await sel());
            check('what was typed went to A', await js(`${node('A')}.teleport`) === 'zone1', await js(`${node('A')}.teleport`));
            check('the panel shows B', await showsTitle('/\\bB\\b|Input/'), null);

            // 2. undo keeps the selection
            await js(`(function(){ var t = Array.from(__nexaEditorState.propertiesPane.get(0).querySelectorAll("nx-text")).find(function(e){ return e.label === "Label"; }); t.change("B2"); return 1; })()`);
            await wait(300);
            check('B\'s label changed', await js(`${node('B')}.props.label`) === 'B2', await js(`${node('B')}.props.label`));
            await js('document.activeElement && document.activeElement.blur && document.activeElement.blur(); document.body.focus(); true');
            await key('z', 'KeyZ', 90, 2);
            check('Ctrl+Z undid it', await js(`${node('B')}.props.label`) === 'B', await js(`${node('B')}.props.label`));
            check('... and B is still selected', JSON.stringify(await sel()) === '["B"]', await sel());

            // 3. a canvas-only redraw (a theme edit does this) keeps the outline / handles
            await js('__nexaEditor.render({ keepPanel: true }); true');
            await wait(200);
            check('after a redraw B still shows selected (outline)', /solid/.test(await js(`document.querySelector('[data-id="B"]').style.outline`)), await js(`document.querySelector('[data-id="B"]').style.outline`));

            // 4. Delete with a button of the inspector focused does not delete the component
            const focused = await js(`(function(){ var b = Array.from(__nexaEditorState.propertiesPane.get(0).querySelectorAll("button")).find(function(x){ return x.offsetParent !== null && !x.disabled; }); if (!b) return null; b.focus(); return document.activeElement === b; })()`);
            await key('Delete', 'Delete', 46);
            check('Delete with an inspector button focused: B is not deleted', focused && !!(await js(node('B'))), { focused });

            // 5. an edit that rebuilds the panel keeps the selection and the scroll
            const scroller = '__nexaEditorState.propertiesPane.get(0).parentNode';
            await js(`${scroller}.scrollTop = 200; true`);
            const before = await js(`${scroller}.scrollTop`);
            await js(`(function(){ var c = Array.from(__nexaEditorState.propertiesPane.get(0).querySelectorAll("input[type=checkbox]")).find(function(i){ return /Locked/.test((i.parentNode && i.parentNode.textContent) || ""); }); if (!c) return 0; c.click(); return 1; })()`);
            await wait(400);
            check('Locked: the panel rebuilt, B still selected', JSON.stringify(await sel()) === '["B"]' && await js(`${node('B')}.locked`) === true, await sel());
            check('... and the scroll position stayed', Math.abs((await js(`${scroller}.scrollTop`)) - before) <= 2 && before > 0, { before, after: await js(`${scroller}.scrollTop`) });

            // 6. a prop edit that changes a component's slots (a tab added) keeps the selection
            await click('T', 0, 'bottom');
            const t0 = await js(`(${node('T')}.children || []).length`);
            const added = await js(`(function(){ var l = __nexaEditorState.propertiesPane.get(0).querySelector("nx-list"); if (!l) return false; var b = l.querySelector(".nx-list-foot .nx-btn"); if (!b) return false; b.click(); return true; })()`);
            await wait(600);
            const t1 = await js(`(${node('T')}.children || []).length`);
            check('Tabs: a tab added (a slot frame more)', added && t1 === t0 + 1, { t0, t1, added });
            check('... and Tabs is still selected', JSON.stringify(await sel()) === '["T"]', await sel());

            const errs = logs.filter((l) => !/favicon|DevTools/.test(l));
            check('no errors in the editor', errs.length === 0, errs.slice(0, 3));
            return true;
        }, { width: 1600, height: 1000, ready: 'document.readyState === "complete" && !!window.RED && !!RED.sidebar', readyTries: 150 });
        if (r === null) console.log('SKIP: no Chrome');
    } finally {
        nr.kill();
        await wait(500);
        try { fs.rmSync(S, { recursive: true, force: true }); } catch (e) { /* still held */ }
    }
    console.log(failures ? 'FAILED: ' + failures : 'ALL OK');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
