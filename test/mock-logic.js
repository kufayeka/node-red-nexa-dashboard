// Verifies the Logic canvas as a pure GRAPH EDITOR — the engine that used
// to execute screen.logic live in the editor (onload on tray open,
// ctx.emit wired straight through) was removed on purpose: designing a
// screen should never have execution side effects just from opening the
// tray or wiring things up (that's what confused "kok pas di-edit udah
// jalan" was about) — see the big comment on findLogicNode in
// nexa-plugin.html. Actual execution is now only ever tested against
// lib/nexa-runtime-client.js (mock-runtime-client.js), which is the ONLY
// place screen.logic ever runs.
//
// What THIS file covers instead: multi-select (click/shift-click/marquee)
// and group-move for logic nodes, Delete removing the whole selection as
// one undo step, the drag-guard now working BOTH ways (a UI component chip
// dropped on the Logic tab is rejected, and vice versa), the Events
// sidebar's component-highlight surviving a tab switch, the Logic canvas
// re-rendering when you switch screens (it didn't, before), and the new
// Inject/Reload/Open URL node config dialogs. Wire-CREATION by dragging
// from an output dot to an input dot is exercised elsewhere (this file's
// predecessor already proved the radius-based hit test works); here wires
// are constructed directly as data where a test needs one, same as how
// every mock in this suite builds component positions as data rather than
// simulating raw mouse trajectories pixel-by-pixel.

const docListeners = {};
global.document = {
  addEventListener(evt, fn) { (docListeners[evt] = docListeners[evt] || []).push(fn); },
  removeEventListener(evt, fn) { if (docListeners[evt]) docListeners[evt] = docListeners[evt].filter(f => f !== fn); },
  createElementNS(ns, tag) { return fakeJQ('<' + tag + '>'); }
};
function fireDoc(evt, payload) { (docListeners[evt] || []).slice().forEach(fn => fn(payload)); }

function fakeDomNode() {
  const listeners = {};
  return {
    tagName: 'DIV',
    addEventListener(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    removeEventListener(evt, fn) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn); },
    _fire(evt, payload) { (listeners[evt] || []).slice().forEach(fn => fn(payload)); }
  };
}

const draggables = [];
const componentsById = {};
const logicNodeBoxesById = {}; // updated (re-appended) on every renderLogicCanvas() — always the CURRENT box for a given logic node id
let documentJQ = null;
let titledEls = []; // reset before each step that triggers a fresh render, same pattern as mock-layers.js

function fakeJQ(selOrHtml, attrs) {
  const domNode = fakeDomNode();
  const el = {
    _isFakeJQ: true, _tag: selOrHtml,
    _css: {}, _text: '', _attrs: attrs || {}, _children: [], _handlers: {}, _domNode: domNode,
    css(o, v) { if (typeof o === 'string') { if (v === undefined) return this._css[o]; this._css[o] = v; return this; } Object.assign(this._css, o); return this; },
    attr(k, v) { if (typeof k === 'object') { Object.assign(this._attrs, k); return this; } if (v === undefined) return this._attrs[k]; this._attrs[k] = v; return this; },
    data(k, v) { this._data = this._data || {}; if (v === undefined) return this._data[k]; this._data[k] = v; return this; },
    droppable(opts) { this._droppableOpts = opts; return this; },
    text(t) { if (t === undefined) return this._text; this._text = t; if (t === '+ Add Screen') global.__addScreenBtn = this; return this; },
    html(h) { if (h === undefined) return this._html; this._html = h; return this; },
    append(c) { this._children.push(c); return this; },
    appendTo(p) {
      p._children.push(this); this._parent = p;
      if (this._attrs && this._attrs['data-id']) componentsById[this._attrs['data-id']] = this;
      if (this._attrs && this._attrs['data-node-id'] && this._attrs['class'] === 'nexa-logic-node') logicNodeBoxesById[this._attrs['data-node-id']] = this;
      if (this._attrs && this._attrs.title) titledEls.push({ title: this._attrs.title, el: this });
      // Structural landmarks for elements with no id of their own — same
      // trick as the '<svg>' hook below, generalized: a class/attr this
      // specific to grab hold of from outside the plugin's own closure.
      if (this._attrs && this._attrs['class'] === 'nexa-screen-list') global.__screenListEl = this;
      if (this._attrs && this._attrs['data-comp-id']) (global.__eventsChips = global.__eventsChips || []).push(this);
      // Landmark for the UI canvas (real code gives it id="nexa-artboard")
      // — needed so tests can reach its .droppable() drop handler, which is
      // where drag-drop placement now actually happens (moved out of the
      // palette chip's own draggable "stop").
      if (this._attrs && this._attrs.id === 'nexa-artboard') global.__artboardEl = this;
      // renderLogicCanvas() appends its SVG wire-overlay straight into
      // logicArtboardEl, which otherwise has no id/class of its own to
      // hook on to (unlike artboardEl's real id="nexa-artboard") — this is
      // the one identifiable structural landmark to grab it by.
      if (this._tag === '<svg>') global.__logicArtboardEl = p;
      return this;
    },
    empty() { this._children = []; return this; },
    remove() { if (this._parent) this._parent._children = this._parent._children.filter(c => c !== this); return this; },
    val(v) { if (v === undefined) return this._val; this._val = v; return this; },
    prop(name, v) { if (v === undefined) return this._props && this._props[name]; this._props = this._props || {}; this._props[name] = v; return this; },
    is(sel) {
      if (sel === ':checked') return !!(this._props && this._props.checked);
      if (sel === ':visible') {
        // Real jQuery's :visible accounts for ANCESTOR display:none too
        // (an element isn't visible if a parent is hidden, even though its
        // OWN inline style never says so) — walk up _parent the same way,
        // or logicArtboardEl.is(":visible") would never actually reflect
        // the Logic PANE (an ancestor, several levels up) being hidden.
        var node = this;
        while (node) { if (node._css.display === 'none') return false; node = node._parent; }
        return true;
      }
      return false;
    },
    // NOTE: an earlier version of this mock had `!show` here instead of
    // `show` — inverted jQuery's real .toggle(bool) semantics (.toggle(true)
    // must SHOW, not hide). Never caught before because no earlier test
    // actually depended on toggle()'s visibility state being correct.
    toggle(show) { this._css.display = (show === undefined ? this._css.display === 'none' : show) ? '' : 'none'; return this; },
    hide() { this._css.display = 'none'; return this; },
    show() { this._css.display = ''; return this; },
    find(sel) {
      // Generic plain-class selector (".nexa-component" / ".nexa-palette-item"
      // / ".nexa-logic-node" / ...) — searches THIS element's own children,
      // same as real jQuery .find() searching descendants, and returns a
      // collection-like object whose .css() fans out to every match (same
      // pattern real code relies on for "reset every X, then re-highlight
      // the selected ones").
      if (sel && sel[0] === '.' && sel.indexOf('[') === -1) {
        var cls = sel.slice(1);
        var m = (this._children || []).filter(c => c._attrs && c._attrs['class'] === cls);
        var coll = fakeJQ(); coll._collection = m;
        // Must support BOTH .css({a:1,b:2}) AND .css("prop","value") — a
        // plain-object-only override here silently dropped every
        // two-argument call (e.g. refreshLogicSelectionVisuals's own
        // .css("border-color","transparent") reset), which is exactly the
        // kind of thing that looks like "nothing happened" without ever
        // throwing an error to say why.
        coll.css = function (o, v) { m.forEach(x => { if (typeof o === 'string') { x._css[o] = v; } else { Object.assign(x._css, o); } }); return this; };
        return coll;
      }
      // node-id/comp-id attribute selectors combine a class AND an attr
      // (e.g. '.nexa-logic-node[data-node-id="x"]') — checked before the
      // plain 'data-id' fallback below since e.g. "data-node-id".indexOf
      // ('data-id') is NOT a substring match (data-NODE-id != data-id).
      if (sel && sel.indexOf('data-node-id') !== -1) {
        const id = sel.match(/data-node-id="([^"]+)"/)[1];
        return logicNodeBoxesById[id] || fakeJQ();
      }
      if (sel && sel.indexOf('data-comp-id') !== -1) {
        const id = sel.match(/data-comp-id="([^"]+)"/)[1];
        const m = (this._children || []).filter(c => c._attrs && c._attrs['data-comp-id'] === id);
        const coll = fakeJQ();
        coll.css = function (o, v) { m.forEach(x => { if (typeof o === 'string') { x._css[o] = v; } else { Object.assign(x._css, o); } }); return this; };
        return coll;
      }
      if (sel && sel.indexOf('data-id') !== -1) { const id = sel.match(/"([^"]+)"/)[1]; return componentsById[id] || fakeJQ(); }
      return fakeJQ();
    },
    // Real jQuery's .closest() returns an EMPTY collection when nothing
    // matches — used by editor-tray.js's isEditableTarget() to check whether
    // a keydown's target is inside a code editor (ace/monaco/CodeMirror/
    // contenteditable). None of these tests ever target one, so this must
    // report "no match" (length 0), not a truthy length-1 result — the
    // latter silently made EVERY keydown look like it was inside a text
    // editor, permanently disabling this file's own Delete-key/Ctrl+Z/etc.
    // assertions further down.
    closest() { return { length: 0 }; },
    on(evt, fn) { (this._handlers[evt] = this._handlers[evt] || []).push(fn); return this; },
    off() { return this; },
    get() { return this._domNode; },
    offset() { return { left: 0, top: 0 }; },
    position() { return { left: 0, top: 0 }; },
    width() { return 800; }, height() { return 600; },
    get clientWidth() { return 800; }, get clientHeight() { return 600; },
    draggable(opts) { this._draggableOpts = opts; draggables.push({ el: this, opts }); return this; },
    get length() { return 1; }
  };
  domNode.clientWidth = 800; domNode.clientHeight = 600;
  domNode.scrollLeft = 0; domNode.scrollTop = 0;
  return el;
}
global.$ = function (sel, attrs) {
  if (sel === global.document) { if (!documentJQ) documentJQ = fakeJQ(); return documentJQ; }
  if (sel && sel._isFakeJQ) return sel; // already-wrapped (e.g. document.createElementNS's return value)
  return fakeJQ(sel, attrs);
};
$.fn = {};
$.ajax = function () { return { done(fn) { fn({ value: 1 }); return this; }, fail(fn) { return this; } }; };

// Palette chips no longer set their own _text (the label lives on a nested
// .red-ui-palette-label child, avoiding the duplicate-text overlap bug real
// jQuery's .text() as a GETTER would mask by concatenating descendant text
// nodes) — so label lookups must walk _children the same way, instead of
// reading the chip element's own _text directly.
function chipText(el) {
  if (el._text) return el._text;
  var kids = el._children || [];
  for (var i = 0; i < kids.length; i++) {
    var t = chipText(kids[i]);
    if (t) return t;
  }
  return '';
}

function mousedownOn(id, opts) {
  var el = componentsById[id];
  var handlers = el._handlers['mousedown'] || [];
  var evt = Object.assign({ stopPropagation() {}, shiftKey: false }, opts);
  handlers.forEach(fn => fn(evt));
}
function clickTitled(title, index) {
  var matches = titledEls.filter(t => t.title === title);
  var target = matches[index === undefined ? matches.length - 1 : index];
  if (!target) throw new Error('no titled element found: ' + title);
  var handlers = target.el._handlers['click'] || [];
  handlers.forEach(fn => fn({ preventDefault() {}, stopPropagation() {} }));
}

let actions = {}, configNodes = [], idCounter = 0, notifications = [], traySpec = null;
global.RED = {
  plugins: { registerPlugin(id, def) { if (def.onadd) def.onadd(); } },
  actions: { add(id, fn) { actions[id] = fn; }, invoke(id) { actions[id](); } },
  menu: { addItem() {} },
  comms: { subscribe() {} },
  notify(msg, opts) { notifications.push(msg); },
  events: { on() {}, emit() {} },
  log: { info() {}, warn() {} },
  nodes: {
    dirty() {},
    eachConfig(fn) { configNodes.forEach(fn); },
    getType(type) { return type === 'kufayeka-nexa-project' ? { defaults: { name: { value: 'Nexa Project' }, screens: { value: [] } } } : null; },
    id() { return 'cfg' + (++idCounter); },
    add(node) { configNodes.push(node); }
  },
  sidebar: { addTab() {} },
  tray: {
    show(opts) { traySpec = opts; const tr = fakeJQ(); opts.open(tr); if (opts.show) opts.show(); },
    close() { if (traySpec && traySpec.close) traySpec.close(); } // real close: callback, so onclose actually fires
  },
  // Both the sidebar (buildSidebarContent) AND the canvas (buildCanvasArea,
  // for its new UI/Logic sub-tabs) call RED.tabs.create now — track every
  // instance and let the test pick the one that has the tab it needs via
  // _tabs, same fix already applied to mock-layers.js for the same reason.
  tabs: {
    create(opts) {
      const tabs = {}; let active = null;
      const api = {
        addTab(t) { tabs[t.id] = t; if (!active) { active = t.id; if (opts.onchange) opts.onchange(t); } },
        activateTab(id) { active = id; if (opts.onchange) opts.onchange(tabs[id]); },
        renameTab(id, l) { if (tabs[id]) tabs[id].label = l; },
        _tabs: tabs
      };
      (global.__allTabsApis = global.__allTabsApis || []).push(api);
      return api;
    }
  }
};

global.window = global;
window.NEXA = window.NEXA || { _q: [], registerComponent: function (id, def) { this._q.push([id, def]); } };
NEXA.registerComponent('mock-button', {
  category: 'Basic', label: 'Button', defaultSize: { w: 100, h: 40 },
  capabilities: { resizable: true, rotatable: false, lockable: true },
  defaults: { text: { value: 'Click', type: 'text' } },
  bindable: ['props.text'],
  events: [{ name: 'click', label: 'Clicked' }],
  render: function () {}
});

const fs = require('fs');
eval(fs.readFileSync(process.argv[2], 'utf8'));

function dispatchKey(opts) {
  var hs = (documentJQ && documentJQ._handlers['keydown.nexa']) || [];
  var evt = Object.assign({ target: {}, preventDefault() {}, key: '', ctrlKey: false, metaKey: false, shiftKey: false }, opts);
  hs.forEach(fn => fn(evt));
}

actions['nexa:open-pages-editor']();
const screen = configNodes[0].screens[0];
console.log('screen.logic exists with empty nodes/wires by default?', Array.isArray(screen.logic.nodes) && Array.isArray(screen.logic.wires) && screen.logic.nodes.length === 0);

// canvasTabs (UI/Logic sub-tabs) is a SEPARATE RED.tabs.create instance from
// the sidebar's own — find it by which tabs it actually has, same pattern
// used throughout this suite.
const canvasTabsApi = global.__allTabsApis.filter(function (api) { return 'logic' in api._tabs; }).pop();

// Placement now happens in state.artboardEl / state.logicArtboardEl's own
// .droppable() "drop" handlers (editor-tray.js), not the palette chip's
// draggable "stop" (which now only shows the wrong-tab/no-canvas notices,
// unconditionally, exactly like a real drop always fires the draggable's
// own "stop" regardless of whether any droppable accepted it). A real
// browser drop only invokes the target's "drop" when it's visible AND
// matches its accept selector (state.artboardEl only accepts [data-type-id]
// chips, state.logicArtboardEl only [data-palette-type] ones) — a raw
// function call bypasses both of those checks for free, so these helpers
// replicate them explicitly instead of only calling drop() unconditionally.
function simulateComponentDrop(chip, x, y) {
  chip.opts.stop(null, { offset: { left: x, top: y } });
  if (global.__artboardEl.is(':visible') && chip.el._attrs['data-type-id']) {
    global.__artboardEl._droppableOpts.drop({ pageX: x, pageY: y }, { draggable: chip.el });
  }
}
function simulateLogicNodeDrop(chip, x, y) {
  chip.opts.stop(null, { offset: { left: x, top: y } });
  if (global.__logicArtboardEl.is(':visible') && chip.el._attrs['data-palette-type']) {
    global.__logicArtboardEl._droppableOpts.drop({ pageX: x, pageY: y }, { draggable: chip.el });
  }
}

console.log('--- reported bug: dragging a UI component chip onto the LOGIC tab must be rejected, not silently add the component ---');
canvasTabsApi.activateTab('logic');
const buttonDraggables = draggables.filter(d => chipText(d.el) === 'Button');
const buttonChip = buttonDraggables[buttonDraggables.length - 1];
notifications.length = 0;
simulateComponentDrop(buttonChip, 100, 100);
console.log('no component silently added while on the Logic tab?', screen.components.length === 0);
console.log('a warning notification was shown?', notifications.some(m => /UI tab/.test(m)));

console.log('--- dropping the same chip on the UI tab works normally ---');
canvasTabsApi.activateTab('ui');
simulateComponentDrop(buttonChip, 100, 100);
console.log('component added once on the UI tab?', screen.components.length === 1);
const buttonComp = screen.components[0];

console.log('--- the existing reverse guard (Events chip dropped on the UI tab) still works ---');
canvasTabsApi.activateTab('ui');
notifications.length = 0;
const onloadDraggables = draggables.filter(d => chipText(d.el) === 'On Load');
const onloadChip = onloadDraggables[onloadDraggables.length - 1];
simulateLogicNodeDrop(onloadChip, 50, 50);
console.log('no logic node silently added while on the UI tab?', screen.logic.nodes.length === 0);
console.log('a warning notification was shown?', notifications.some(m => /Logic tab/.test(m)));

console.log('--- drop 3 logic nodes for real, on the Logic tab ---');
canvasTabsApi.activateTab('logic');
function dropChip(label, x, y) {
  // Filter by class too, not just text — once an "On Load" NODE has been
  // dropped onto the canvas, its rendered box shares the exact same label
  // text as the PALETTE CHIP it came from (both show "On Load"), so text
  // alone is ambiguous between the two.
  const list = draggables.filter(d => chipText(d.el) === label && d.el._attrs['class'] === 'nexa-palette-item');
  simulateLogicNodeDrop(list[list.length - 1], x, y);
}
dropChip('On Load', 10, 10);
dropChip('Function', 200, 10);
dropChip('Debug', 400, 10);
console.log('3 logic nodes now on the screen?', screen.logic.nodes.length === 3);
const [onloadNode, fnNode, debugNode] = screen.logic.nodes;

console.log('--- multi-select: click one, shift-click another ---');
function boxMousedown(nodeId, opts) {
  logicNodeBoxesById[nodeId]._handlers['mousedown'][0](Object.assign({ stopPropagation() {} }, opts));
}
boxMousedown(onloadNode.id, { shiftKey: false });
boxMousedown(fnNode.id, { shiftKey: true });
// Product now highlights selection via `outline` (matching real Node-RED's
// node-selected styling more closely) rather than the `border-color` scheme
// this check used to look for — updated to match, not a product change.
function isLogicHighlighted(id) {
  return (logicNodeBoxesById[id]._css['outline'] || '').indexOf('#ffeb3b') !== -1;
}
console.log('onload node highlighted?', isLogicHighlighted(onloadNode.id));
console.log('function node highlighted?', isLogicHighlighted(fnNode.id));
console.log('debug node NOT highlighted?', !isLogicHighlighted(debugNode.id));

console.log('--- group-move: dragging one selected node moves every selected node by the same delta ---');
const onloadBefore = { x: onloadNode.x, y: onloadNode.y };
const fnBefore = { x: fnNode.x, y: fnNode.y };
const debugBefore = { x: debugNode.x, y: debugNode.y };
const onloadDrag = draggables.find(d => d.el === logicNodeBoxesById[onloadNode.id]);
onloadDrag.opts.start({ pageX: 0, pageY: 0 });
onloadDrag.opts.drag({ pageX: 30, pageY: 5 }, { position: {} });
onloadDrag.opts.stop({ pageX: 30, pageY: 5 });
console.log('dragged node moved?', onloadNode.x === onloadBefore.x + 30 && onloadNode.y === onloadBefore.y + 5);
console.log('other SELECTED node moved by the same delta?', fnNode.x === fnBefore.x + 30 && fnNode.y === fnBefore.y + 5);
console.log('NON-selected node did not move?', debugNode.x === debugBefore.x && debugNode.y === debugBefore.y);

console.log('--- marquee-select: drag a box covering only the function+debug nodes ---');
// Reset positions to known values so the marquee math is easy to reason about.
fnNode.x = 200; fnNode.y = 10;
debugNode.x = 400; debugNode.y = 10;
onloadNode.x = 900; onloadNode.y = 900; // moved well out of the way
const logicArtboardHandlers = global.__logicArtboardEl._handlers['mousedown'] || [];
logicArtboardHandlers.forEach(fn => fn({ target: global.__logicArtboardEl._domNode, shiftKey: false, pageX: 150, pageY: 0 }));
fireDoc('mousemove', { pageX: 600, pageY: 200 });
fireDoc('mouseup', {});
console.log('marquee selected function+debug, not onload?', logicSelectedIdsSnapshot());
function logicSelectedIdsSnapshot() {
  var fnHi = isLogicHighlighted(fnNode.id);
  var dbgHi = isLogicHighlighted(debugNode.id);
  var onHi = isLogicHighlighted(onloadNode.id);
  return fnHi && dbgHi && !onHi;
}

console.log('--- Delete removes the whole selection as ONE undo step ---');
titledEls = [];
dispatchKey({ key: 'Delete' });
console.log('both selected nodes removed, onload untouched?', screen.logic.nodes.length === 1 && screen.logic.nodes[0].id === onloadNode.id);
dispatchKey({ key: 'z', ctrlKey: true });
console.log('undo restores BOTH in one step?', screen.logic.nodes.length === 3);

console.log('--- reported bug: switching screens must refresh the Logic canvas, like the UI canvas already does ---');
// renderScreenList()'s own row click handler calls selectScreenFromSidebar
// internally — reach it the same way a real click on the sidebar's screen
// list would (global.__screenListEl is the plugin's own screenListEl,
// grabbed via the 'nexa-screen-list' class hook in the harness, since that
// internal var isn't otherwise reachable from outside its IIFE).
function clickScreenRow(name) {
  var rows = global.__screenListEl._children || [];
  var row = rows.find(r => (r._children || []).some(c => c._text === name));
  if (!row || !row._handlers.click) throw new Error('screen row for ' + name + ' not found in the sidebar list');
  row._handlers.click[0]();
}
const nodeCountBeforeSwitch = (global.__logicArtboardEl._children || []).filter(c => c._attrs && c._attrs['class'] === 'nexa-logic-node').length;
// Real "+ Add Screen" flow (addScreenFromSidebar) — makes a brand new,
// empty-logic screen active, same as a user clicking the sidebar button.
global.__addScreenBtn._handlers.click[0]();
const screen2 = configNodes[0].screens[configNodes[0].screens.length - 1];
const nodeCountAfterSwitch = (global.__logicArtboardEl._children || []).filter(c => c._attrs && c._attrs['class'] === 'nexa-logic-node').length;
console.log('Logic canvas showed screen1\'s 3 nodes before adding/switching?', nodeCountBeforeSwitch === 3);
console.log('Logic canvas shows the new screen\'s 0 nodes right after (auto-refreshed)?', nodeCountAfterSwitch === 0);

console.log('--- Events sidebar highlight must survive switching sidebar tabs (it used to only reappear on the NEXT selection change) ---');
clickScreenRow(screen.name); // back to screen 1, where buttonComp actually lives
mousedownOn(buttonComp.id, { shiftKey: false });
var sidebarTabsApi = global.__allTabsApis.filter(function (api) { return 'events' in api._tabs; }).pop();
sidebarTabsApi.activateTab('components'); // navigate away first
sidebarTabsApi.activateTab('events'); // renderEventsPanel() rebuilds every chip from scratch here
var latestChips = (global.__eventsChips || []).filter(c => c._attrs['data-comp-id'] === buttonComp.id).slice(-2); // 2 chips for mock-button: 1 event + 1 bindable prop
var highlighted = latestChips.length > 0 && latestChips.every(c => c._css.background === '#fff3e0');
console.log('component highlight present immediately after switching TO the Events tab?', highlighted);

console.log('--- new node types: Inject / Reload Page / Open URL exist in the palette and open their own config dialogs ---');
canvasTabsApi.activateTab('logic');
dropChip('Inject', 500, 500);
dropChip('Reload Page', 550, 550);
dropChip('Open URL', 600, 600);
const injectNode = screen.logic.nodes.find(n => n.type === 'inject');
const reloadNode = screen.logic.nodes.find(n => n.type === 'reload');
const urlNode = screen.logic.nodes.find(n => n.type === 'open-url');
console.log('all 3 new node types landed on the graph with their defaults?', injectNode.intervalMs === 5000 && !!reloadNode && urlNode.url === '' && urlNode.newTab === false);
logicNodeBoxesById[injectNode.id]._handlers['dblclick'][0]({ stopPropagation() {} });
console.log('double-clicking Inject opens its own config tray?', traySpec.title === 'Configure Inject Node');
logicNodeBoxesById[urlNode.id]._handlers['dblclick'][0]({ stopPropagation() {} });
console.log('double-clicking Open URL opens its own config tray?', traySpec.title === 'Configure Open URL Node');
console.log('Reload Page has no dblclick handler (nothing to configure)?', !logicNodeBoxesById[reloadNode.id]._handlers['dblclick']);
console.log('ALL OK');
