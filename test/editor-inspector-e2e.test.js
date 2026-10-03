'use strict';
// The properties panel is ONE property tree for every kind of node, end to end: an isolated
// Node-RED (temp userDir, 1899 / 1898; never the user's data/), the Pages editor in headless
// Chrome. A frame (auto layout, overlay), a group, a component in a frame's auto layout, a
// template instance (its params), a Lit component (its code, bindable props): their groups,
// what shows with an edit (visibleWhen, no rebuild), edits as one undo step, no errors.
// Screenshots (light) go to SHOTS_DIR when it is set.
//   node test/editor-inspector-e2e.test.js     (needs Chrome, the dashboard built, ports 1899 / 1898 free)
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { withPage } = require('../sdk/testkit/cdp.js');
const RED_JS = path.resolve(__dirname, '../../../node-red/red.js');
const PORTS = { editor: 1899, pages: 1898 };
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-inspector-e2e-'));
const SHOTS = process.env.SHOTS_DIR || '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, actual) => { if (!ok) failures++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (actual !== undefined ? '   ' + JSON.stringify(actual) : '')); };

function writeFlows() {
    const dir = path.join(S, 'nr');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.js'), 'module.exports = { uiPort: ' + PORTS.editor + ', flowFile: "flows.json", nexaDashboard: { screenWorkerPort: ' + PORTS.pages + ' }, logging: { console: { level: "warn" } }, editorTheme: { tours: false, projects: { enabled: false } } };\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'nr-inspector', version: '0.0.1', private: true }));
    const template = { id: 'tCard', name: 'Card', width: 160, height: 90, params: [{ name: 'title', label: 'Title', type: 'string', defaultValue: 'Pump' }, { name: 'speed', label: 'Speed', type: 'number', defaultValue: 0 }],
        components: [], variables: [], logic: { nodes: [], wires: [] } };
    const screen = { id: 'sI', name: 'Insp', path: '/insp', width: 900, height: 600, gridSize: 10, snap: false, treeVersion: 1, orphans: [], variables: [],
        logic: { nodes: [], wires: [] },
        components: [
            { id: 'F', type: '@frame', name: 'Row', x: 20, y: 20, w: 400, h: 120, layout: { mode: 'horizontal', gap: 8, padding: { t: 8, r: 8, b: 8, l: 8 } },
                children: [{ id: 'C', type: 'nexa-ui-button', x: 0, y: 0, w: 120, h: 40, props: { text: 'In row' } }] },
            { id: 'G', type: '@group', name: 'Grp', x: 20, y: 200, w: 200, h: 60,
                children: [{ id: 'G1', type: 'nexa-ui-button', x: 0, y: 0, w: 90, h: 40, props: { text: 'G1' } }, { id: 'G2', type: 'nexa-ui-button', x: 100, y: 10, w: 90, h: 40, props: { text: 'G2' } }] },
            { id: 'I', type: '@template', templateId: 'tCard', x: 500, y: 20, w: 160, h: 90, props: {}, paramValues: { title: 'P-101' } },
            { id: 'TB', type: 'nexa-ui-tabs', x: 20, y: 300, w: 360, h: 200, props: {} },
            { id: 'L', type: '@lit-component', x: 500, y: 200, w: 160, h: 60, props: {}, litCode: 'render() { return html`<b>hi</b>`; }', litStyles: '', litBindable: [{ name: 'label', type: 'string', defaultValue: 'x' }], litEvents: [] }
        ] };
    const project = { id: 'proj', type: 'kufayeka-nexa-project', name: 'Insp', sparkplugConnection: '', screens: [screen], templates: [template], types: [], breakpoints: [], theme: null, variables: [] };
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
            await js(`(function(){ var el = Array.from(document.querySelectorAll(".nexa-screen-list *")).find(function(e){ return e.children.length === 0 && e.textContent.trim() === "Insp"; }); ["mousedown","mouseup","click"].forEach(function(t){ el.dispatchEvent(new MouseEvent(t, {bubbles:true})); }); return 1; })()`);
            await wait(1500);
            await js('__nexaEditorState.sidebarTabs.activateTab("properties"); true');
            const pane = '__nexaEditorState.propertiesPane.get(0)';
            const select = async (id) => { await js(`(function(){ __nexaEditor.selectOnly ? __nexaEditor.selectOnly(${JSON.stringify(id)}) : null; return 1; })()`); await wait(500); };
            const rows = () => js(`Array.from(${pane}.querySelectorAll(".nx-tree-row")).map(function(r){ return r.dataset.id; })`);
            const groups = async () => (await rows()).filter((x) => /^@[^/]+$/.test(x)).map((x) => x.slice(1));
            const pick = async (id) => { const ok = await js(`(function(){ var r = ${pane}.querySelector('.nx-tree-row[data-id="${id}"]'); if (!r) return false; r.click(); return true; })()`); await wait(250); return ok; };
            const node = (id) => `(function f(list){ for (var i=0;i<list.length;i++){ var n=list[i]; if (n.id===${JSON.stringify(id)}) return n; var c=f(n.children||[]); if (c) return c; } return null; })(__nexaEditorState.screens[0].components)`;
            const shot = async (name) => {
                if (!SHOTS) return;
                // the editor's right part: the canvas edge and the whole sidebar
                const img = await send('Page.captureScreenshot', { format: 'png', clip: { x: 900, y: 0, width: 700, height: 1100, scale: 1 } });
                fs.mkdirSync(SHOTS, { recursive: true });
                fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(img.result.data, 'base64'));
            };
            // screenshots: the Nexa section of the sidebar alone, full height (Node-RED 5 stacks Debug below it)
            if (SHOTS) await js(`(function(){ Array.from(document.querySelectorAll(".red-ui-sidebar-section")).forEach(function(sec){
                if (sec.contains(${pane})) { sec.style.height = "100%"; sec.style.flex = "1 1 auto"; } else sec.style.display = "none"; });
                window.dispatchEvent(new Event("resize")); return 1; })()`);
            const hasSelect = await js('typeof __nexaEditor.selectOnly === "function"');
            check('the editor exposes selectOnly (test hook)', hasSelect, hasSelect);

            // a frame: its own groups; Auto layout rows follow the mode, without a rebuild
            await select('F');
            check('a frame: one tree, its groups', JSON.stringify(await groups()) === JSON.stringify(['General', 'Position & Size', 'Position', 'Constraints', 'Overlay', 'Auto layout', 'Fill & stroke', 'Zoom & pan', 'Variables', 'Teleport']), await groups());
            check('... Gap and Wrap shown for a row layout', (await rows()).includes('fr$gap') && (await rows()).includes('fr$wrap'), null);
            await shot('frame');
            await pick('fr$mode');
            const treeBefore = await js(`(function(){ window.__t = ${pane}.querySelector(".nx-pt-tree"); return 1; })()`);
            await js(`(function(){ var b = Array.from(${pane}.querySelectorAll(".nx-pt-pane .nx-seg-item")).find(function(x){ return /Grid/.test(x.title || x.textContent) || x.getAttribute("aria-label") === "Grid"; }); if (b) b.click(); return !!b; })()`);
            await wait(400);
            const afterGrid = await rows();
            check('mode → Grid: Columns / Rows appear, Wrap goes', afterGrid.includes('fr$columns') && afterGrid.includes('fr$rows') && !afterGrid.includes('fr$wrap'), afterGrid.filter((x) => /^fr\$/.test(x)));
            await shot('frame-grid');
            check('... the frame saved it', await js(`${node('F')}.layout.mode`) === 'grid', await js(`${node('F')}.layout.mode`));
            check('... the same tree (no rebuild), Auto layout still picked', await js(`(function(){ var on = ${pane}.querySelector(".nx-tree-row.nx-on"); return ${pane}.querySelector(".nx-pt-tree") === window.__t && on && on.dataset.id === "fr$mode"; })()`), treeBefore);
            await js('document.body.focus(); true');
            await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
            await wait(500);
            check('Ctrl+Z: one undo step back to Row', await js(`${node('F')}.layout.mode`) === 'horizontal', await js(`${node('F')}.layout.mode`));
            check('... the frame is still selected, its tree shows Wrap again', JSON.stringify(await js('__nexaEditorState.selectedIds')) === '["F"]' && (await rows()).includes('fr$wrap'), null);
            await pick('fr$oKind');
            await js(`(function(){ var b = Array.from(${pane}.querySelectorAll(".nx-pt-pane .nx-seg-item")).find(function(x){ return /Dialog/.test(x.textContent); }); if (b) b.click(); return !!b; })()`);
            await wait(400);
            check('Overlay → Dialog: its settings appear', (await rows()).includes('fr$oBackdrop') && (await rows()).includes('fr$oModal'), null);

            // a component in the frame's auto layout: Layout (sizing in the row) + the button's own
            await select('C');
            const cGroups = await groups();
            check('a component in a row: Layout, then its own groups', cGroups[0] === 'General' && cGroups.includes('Layout') && cGroups.includes('Position & Size') && cGroups.length > 6, cGroups);
            check('... sizing rows in the layout', (await rows()).includes('lc$childW'), null);
            await shot('component-in-row');

            // a component's list (Tabs): its items are rows; + on the list's row adds one (like Add Screen)
            await select('TB');
            const listId = await js(`(function(){ var r = Array.from(${pane}.querySelectorAll(".nx-tree-row.nx-pt-k-prop")).find(function(x){ return /^\\[\\d+ /.test((x.querySelector(".nx-pt-val") || {}).textContent || ""); }); return r ? r.dataset.id : null; })()`);
            const itemsBefore = await js(`${pane}.querySelectorAll('.nx-tree-row[data-id^="${listId}#"]').length`);
            await js(`(function(){ var b = ${pane}.querySelector('.nx-tree-row[data-id="${listId}"] .nx-tree-actions button'); if (b) b.click(); return !!b; })()`);
            await wait(500);
            const itemsAfter = await js(`${pane}.querySelectorAll('.nx-tree-row[data-id^="${listId}#"]').length`);
            check('Tabs: + on the list row adds a tab (an item row more), the new one picked', listId && itemsAfter === itemsBefore + 1 && new RegExp('^' + listId + '#' + itemsBefore + '$').test(await js(`${pane}.querySelector(".nx-tree-row.nx-on").dataset.id`)), { listId, itemsBefore, itemsAfter });
            await shot('tabs-list');

            // a group: its X / Y and size (follows children), Ungroup, Variables
            await select('G');
            check('a group: General, Position & Size, Variables …', JSON.stringify((await groups()).slice(0, 2)) === '["General","Position & Size"]' && (await groups()).includes('Variables'), await groups());
            await pick('var$variables');
            await js(`(function(){ var b = ${pane}.querySelector(".nx-pt-pane .nx-pt-add"); if (b) b.click(); return !!b; })()`);
            await wait(400);
            check('Variables → Add: one declared, picked', (await js(`(${node('G')}.variables || []).length`)) === 1 && /^var\$variables#0/.test(await js(`${pane}.querySelector(".nx-tree-row.nx-on").dataset.id`)), await js(`${node('G')}.variables`));

            // a template instance: its box and its params
            await select('I');
            check('a template instance: Parameters', (await groups()).includes('Parameters') && (await rows()).includes('param$title'), await groups());
            const titleRow = await js(`(${pane}.querySelector('.nx-tree-row[data-id="param$title"] .nx-pt-val') || {}).textContent`);
            check('... its row shows this instance\'s value', /P-101/.test(titleRow || ''), titleRow);
            await shot('template-instance');

            // a Lit component: its code (a dialog), bindable props as a list
            await select('L');
            check('a Lit component: Lit Code', (await groups()).includes('Lit Code') && (await rows()).includes('lit$bindable#0'), await groups());

            // the app's panels are property trees too: Theme, Breakpoints, Types
            const panelGroups = async (tab, paneVar) => {
                await js(`__nexaEditorState.sidebarTabs.activateTab(${JSON.stringify(tab)}); true`);
                await wait(500);
                return js(`Array.from(__nexaEditorState.${paneVar}.get(0).querySelectorAll(".nx-tree-row")).filter(function(r){ return /^@[^/]+$/.test(r.dataset.id); }).map(function(r){ return r.dataset.id.slice(1); })`);
            };
            const themeGroups = await panelGroups('theme', 'themePane');
            check('Theme: one tree (Mode, Colors, Semantic, Type, Space & shape)', JSON.stringify(themeGroups) === JSON.stringify(['Mode', 'Colors', 'Semantic', 'Type', 'Space & shape']), themeGroups);
            const sample = await js(`(function(){ var p = __nexaEditorState.themePane.get(0); var r = p.querySelector('.nx-tree-row[data-id="sample"]'); if (!r) return false; r.click(); return true; })()`);
            await wait(300);
            check('... its Sample row shows the colours in the pane', sample && await js(`!!__nexaEditorState.themePane.get(0).querySelector(".nx-pt-pane .nx-pt-info div")`), sample);
            await shot('theme');
            const bpGroups = await panelGroups('breakpoints', 'breakpointsPane');
            check('Breakpoints: one tree (Breakpoints, Ranges)', JSON.stringify(bpGroups) === JSON.stringify(['Breakpoints', 'Ranges']), bpGroups);
            check('... each breakpoint is a row', (await js(`__nexaEditorState.breakpointsPane.get(0).querySelectorAll('.nx-tree-row[data-id^="bps#"]').length`)) === 7, null);
            await panelGroups('types', 'typesPane');
            await js(`(function(){ var b = __nexaEditorState.typesPane.get(0).querySelector('button[title="New type"]'); if (b) b.click(); return !!b; })()`);
            await wait(500);
            const typeRows = await js(`Array.from(__nexaEditorState.typesPane.get(0).querySelectorAll(".nx-tree-row")).filter(function(r){ return /^@[^/]+$/.test(r.dataset.id); }).map(function(r){ return r.dataset.id.slice(1); })`);
            check('Types: a new type is a tree (Type, Parameters, Members) + its instances', JSON.stringify(typeRows) === JSON.stringify(['Type', 'Parameters', 'Members', 'Instances (app — every screen)']), typeRows);

            const errs = logs.filter((l) => !/favicon|DevTools/.test(l));
            check('no errors in the editor', errs.length === 0, errs.slice(0, 3));
            return true;
        }, { width: 1600, height: 1100, ready: 'document.readyState === "complete" && !!window.RED && !!RED.sidebar', readyTries: 150 });
        if (r === null) console.log('SKIP: no Chrome');
    } finally {
        nr.kill();
        await wait(500);
        try { fs.rmSync(S, { recursive: true, force: true }); } catch (e) { /* still held */ }
    }
    console.log(failures ? 'FAILED: ' + failures : 'ALL OK');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
