const docListeners = {};
// documentElement.style stub: @codemirror/view's browser-environment
// detection (bundled into the editor script now) runs at module-load time
// and reads doc.documentElement.style unconditionally whenever `document`
// is defined at all (its own SSR fallback only kicks in if `document` is
// fully undefined).
global.document = {
  documentElement: { style: {} },
  addEventListener(evt, fn) { (docListeners[evt] = docListeners[evt] || []).push(fn); },
  removeEventListener(evt, fn) { if (docListeners[evt]) docListeners[evt] = docListeners[evt].filter(f => f !== fn); }
};
function fireDoc(evt, payload) { (docListeners[evt] || []).slice().forEach(fn => fn(payload)); }
function fakeDomNode() {
  const listeners = {};
  return {
    tagName: 'DIV',
    addEventListener(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    removeEventListener(evt, fn) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn); }
  };
}
const draggables = [];
// Palette chips no longer set their own _text (the label lives on a nested
// .red-ui-palette-label child) — walk _children the same way instead of
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
const componentsById = {};
let documentJQ = null;
function fakeJQ(selOrHtml, attrs) {
  const domNode = fakeDomNode();
  const el = {
    _css: {}, _text: '', _attrs: attrs || {}, _children: [], _handlers: {}, _domNode: domNode,
    css(o){ if(typeof o==='string') return this._css[o]; Object.assign(this._css,o); return this; },
    attr(k,v){ if(v===undefined) return this._attrs[k]; this._attrs[k]=v; return this; },
    data(k,v){ this._data=this._data||{}; if(v===undefined) return this._data[k]; this._data[k]=v; return this; },
    droppable(opts){ this._droppableOpts=opts; return this; },
    text(t){ if(t===undefined) return this._text; this._text=t; return this; },
    html(h){ this._html=h; return this; },
    append(c){ this._children.push(c); return this; },
    appendTo(p){
      p._children.push(this); this._parent=p;
      if (this._attrs && this._attrs['data-id']) componentsById[this._attrs['data-id']] = this;
      // Landmark for the UI canvas (real code gives it id="nexa-artboard")
      // — needed so tests can reach its .droppable() drop handler, which is
      // where drag-drop placement now actually happens (moved out of the
      // palette chip's own draggable "stop").
      if (this._attrs && this._attrs.id === 'nexa-artboard') global.__artboardEl = this;
      return this;
    },
    empty(){ this._children=[]; return this; },
    remove(){ if(this._parent) this._parent._children=this._parent._children.filter(c=>c!==this); return this; },
    val(v){ if(v===undefined) return this._val; this._val=v; return this; },
    prop(){ return this; },
    is(){ return false; },
    closest(){ return { length: 0 }; },
    toggle(){ return this; },
    hide(){ return this; },
    show(){ return this; },
    find(sel){
      if (sel === '.nexa-component') { const m=(this._children||[]).filter(c=>c._attrs&&c._attrs['class']==='nexa-component'); const c=fakeJQ(); c._collection=m; c.css=function(o){m.forEach(x=>Object.assign(x._css, typeof o==='string'?{}:o)); return this;}; return c; }
      if (sel && sel.indexOf('data-id')!==-1) { const id=sel.match(/"([^"]+)"/)[1]; return componentsById[id] || fakeJQ(); }
      return fakeJQ();
    },
    on(evt, fn){ (this._handlers[evt]=this._handlers[evt]||[]).push(fn); return this; },
    off(){ return this; },
    get(){ return this._domNode; },
    offset(){ return {left:0, top:0}; },
    width(){ return 800; }, height(){ return 600; },
    draggable(opts){ this._draggableOpts=opts; draggables.push({el:this, opts, id: (this._attrs||{})['data-id']}); return this; },
    get length(){ return 1; }
  };
  return el;
}
global.$ = function(sel, attrs){ if (sel === global.document) { if (!documentJQ) documentJQ = fakeJQ(); return documentJQ; } return fakeJQ(sel, attrs); };
$.fn = {};
$.ajax = function(){ return { done(fn){ fn({value:1}); return this; }, fail(fn){ return this; } }; };

function mousedownOn(id, opts) {
  var el = componentsById[id];
  var handlers = el._handlers['mousedown'] || [];
  var evt = Object.assign({ stopPropagation(){}, shiftKey:false }, opts);
  handlers.forEach(fn => fn(evt));
}
function dragOf(id) { return draggables.find(d => d.id === id); }
function dispatchKey(opts) {
  var hs = documentJQ && documentJQ._handlers['keydown.nexa'] || [];
  var evt = Object.assign({ target: {}, preventDefault(){}, key:'', ctrlKey:false, metaKey:false, shiftKey:false }, opts);
  hs.forEach(fn => fn(evt));
}

let actions = {}, configNodes = [], idCounter = 0, notifications = [];
global.RED = {
  plugins: { registerPlugin(id, def){ if (def.onadd) def.onadd(); } },
  actions: { add(id, fn){ actions[id]=fn; }, invoke(id){ actions[id](); } },
  menu: { addItem(){} },
  comms: { subscribe(){} },
  notify(msg, opts){ notifications.push(msg); console.log('  [notify]', opts&&opts.type, msg); },
  events: { on(){}, emit(){} },
  log: { info(){} },
  nodes: {
    dirty(){},
    eachConfig(fn){ configNodes.forEach(fn); },
    getType(type){ return type==='kufayeka-nexa-project' ? {defaults:{name:{value:'Nexa Project'},screens:{value:[]}}} : null; },
    id(){ return 'cfg'+(++idCounter); },
    add(node){ configNodes.push(node); }
  },
  sidebar: { addTab(){} },
  tray: { show(opts){ const tr=fakeJQ(); opts.open(tr); if(opts.show) opts.show(); }, close(){} },
  tabs: { create(opts){ const tabs={}; let active=null; return {
    addTab(t){ tabs[t.id]=t; if(!active){active=t.id; if(opts.onchange) opts.onchange(t);} },
    activateTab(id){ active=id; if(opts.onchange) opts.onchange(tabs[id]); },
    renameTab(id,l){ if(tabs[id]) tabs[id].label=l; }
  }; } }
};

global.window = global;
window.NEXA = window.NEXA || { _q: [], registerComponent: function(id,def){ this._q.push([id,def]); } };
NEXA.registerComponent('mock-item', { category:'Basic', label:'Item', defaultSize:{w:60,h:60}, capabilities:{resizable:true,rotatable:true,lockable:true}, defaults:{}, render(){} });

const fs = require('fs');
// records what it was rendered with (to see {variables} resolved on the canvas)
const renderedText = {};
NEXA.registerComponent('mock-label', { category: 'Basic', label: 'Label', defaultSize: { w: 80, h: 20 }, defaults: {}, render(el, props, ctx) { renderedText[ctx.namespace] = props.text; } });
eval(fs.readFileSync(process.argv[2], 'utf8'));

// Frames capture (Figma): drops from the palette and drags go INTO the frame
// under the pointer — into its auto layout at the pointer's place in the flow —
// and a node dragged out of every frame lands on the root where it was let go.
// (No real layout here: the flow children get the x / y a browser would give
// them by hand, the way canvas/layout-readback.js reads them back.)
actions['nexa:open-pages-editor']();
const screen = configNodes[0].screens[0];
const chipOf = (label) => draggables.filter((d) => chipText(d.el) === label).pop();
const drop = (label, x, y) => global.__artboardEl._droppableOpts.drop({ pageX: x, pageY: y }, { draggable: chipOf(label).el });
const lastDragOf = (id) => draggables.filter((d) => d.id === id).pop();
const ids = (list) => list.map((n) => n.id).join(',');
function dragNode(id, from, to) {
  const d = lastDragOf(id);
  d.opts.start({ pageX: from.x, pageY: from.y });
  d.opts.drag({ pageX: to.x, pageY: to.y }, { position: {} });
  d.opts.stop({ pageX: to.x, pageY: to.y });
}
// what a browser would lay out: a row, padding 8, gap 8, children side by side
function flow(frame) {
  let x = 8;
  frame.children.forEach((c) => { if (!(c.layoutChild && c.layoutChild.absolute)) { c.x = x; c.y = 8; x += c.w + 8; } });
}

console.log('--- the palette has a Layout section ---');
console.log('Frame / Row / Column / Grid chips?', ['Frame', 'Row (auto layout)', 'Column (auto layout)', 'Grid'].every((l) => !!chipOf(l)));

console.log('--- drop a Row, then items into it ---');
drop('Row (auto layout)', 400, 300);
const row = screen.components[screen.components.length - 1];
console.log('a Row frame (horizontal auto layout, named Row) at the root?', row.type === '@frame' && row.layout.mode === 'horizontal' && row.name === 'Row' && Tree_parent(row) === null);
console.log('   box', row.x, row.y, row.w, row.h);
drop('Item', 330, 300);                     // inside the row
const i1 = row.children[0];
console.log('an Item dropped on the row went into it?', row.children.length === 1 && screen.components.indexOf(i1) === -1);
flow(row);
drop('Item', 500, 300);                     // right of item 1 -> after it
const i2 = row.children[1];
flow(row);
drop('Item', 290, 300);                     // left of item 1's centre -> first
const i0 = row.children[0];
flow(row);
console.log('dropped left of the first item -> first; right -> after?', ids(row.children) === [i0.id, i1.id, i2.id].join(','));
drop('Item', 50, 50);                       // on empty canvas -> root
const free = screen.components[screen.components.length - 1];
console.log('dropped outside every frame -> the root?', free.type === 'mock-item' && row.children.indexOf(free) === -1);

console.log('--- drag a root node into the row: between two items ---');
mousedownOn(free.id, {});
const rowAbs = { x: row.x, y: row.y };
const between = { x: rowAbs.x + i1.x + i1.w + 4, y: rowAbs.y + 20 };  // in the gap after item 1
dragNode(free.id, { x: 80, y: 80 }, between);
console.log('it went into the row after item 1?', ids(row.children) === [i0.id, i1.id, free.id, i2.id].join(','));
console.log('one undo step brings it back to the root?', (dispatchKey({ key: 'z', ctrlKey: true }), screen.components.some((n) => n.id === free.id) && row.children.length === 3));

console.log('--- reorder inside the row (a flow drag, not a free move) ---');
flow(row);
mousedownOn(row.id, {});
mousedownOn(i0.id, { ctrlKey: true });      // the item itself (Ctrl = deepest)
const i0Abs = { x: row.x + i0.x + 10, y: row.y + i0.y + 10 };
const afterLast = { x: row.x + i2.x + i2.w - 2, y: row.y + 20 };
dragNode(i0.id, i0Abs, afterLast);
console.log('the first item now last, still in the row?', ids(row.children) === [i1.id, i2.id, i0.id].join(','));

console.log('--- drag an item out of the row onto empty canvas ---');
flow(row);
mousedownOn(i1.id, { ctrlKey: true });
const grabAt = { x: row.x + 1 + i1.x + 5, y: row.y + 1 + i1.y + 5 };  // +1: inside the row's border
dragNode(i1.id, grabAt, { x: 700, y: 520 });
const out = screen.components.find((n) => n.id === i1.id);
console.log('out of the row, on the root where it was let go (grab kept)?', !!out && out.x === 695 && out.y === 515 && row.children.length === 2);

console.log('--- a locked frame does not capture ---');
row.locked = true;
drop('Item', row.x + 20, row.y + 20);
console.log('dropped on a locked frame -> the root?', row.children.length === 2);
delete row.locked;

console.log('--- Frame selection (Ctrl+Alt+G) ---');
const a = screen.components.find((n) => n.id === out.id), b = free;
mousedownOn(a.id, {});
mousedownOn(b.id, { shiftKey: true });
dispatchKey({ key: 'g', ctrlKey: true, altKey: true });
const fr = screen.components.find((n) => n.type === '@frame' && /^Frame \d+$/.test(n.name || ''));
console.log('a frame "Frame 1" holds both (no fill, no layout), selected?', !!fr && fr.name === 'Frame 1' && fr.children.length === 2 && !fr.layout && window.__nexaEditorState.selectedIds[0] === fr.id);

console.log('--- variables: the canvas shows {name} resolved in the scope chain of each node ---');
screen.variables = [{ id: 'v1', name: 'line', type: 'string', defaultValue: 'L1' }];
screen.components.push({ id: 'VP', type: '@frame', name: 'Panel', x: 10, y: 10, w: 300, h: 100, variables: [{ id: 'v2', name: 'label', type: 'string', defaultValue: 'outer' }], children: [
  { id: 'VL', type: 'mock-label', x: 0, y: 0, w: 80, h: 20, props: { text: '{line}/{label}' } },
  { id: 'VI', type: '@frame', name: 'Inner', x: 0, y: 30, w: 100, h: 40, variables: [{ id: 'v3', name: 'label', type: 'string', defaultValue: 'shadow' }], children: [
    { id: 'VS', type: 'mock-label', x: 0, y: 0, w: 80, h: 20, props: { text: '{line}/{label}' } }] }] },
  { id: 'VR', type: 'mock-label', x: 400, y: 10, w: 80, h: 20, props: { text: '{line}/{label}' } });
window.__nexaEditor.render();
console.log('nearest declaration wins; outside the frame its variable stays as written?',
  renderedText.VL === 'L1/outer' && renderedText.VS === 'L1/shadow' && renderedText.VR === 'L1/{label}', JSON.stringify(renderedText));
screen.variables[0].defaultValue = 'L9';
window.__nexaEditor.render();
console.log('a changed default shows after a render?', renderedText.VS === 'L9/shadow');

console.log('--- the Events tab offers a Set Variable chip per declared variable ---');
window.__nexaEditorState.sidebarTabs.activateTab('events');
const setChips = draggables.filter((d) => /^Set (screen|Panel|Inner)\./.test(chipText(d.el) || '')).map((d) => chipText(d.el));
console.log('Set screen.line / Set Panel.label / Set Inner.label?', ['Set screen.line', 'Set Panel.label', 'Set Inner.label'].every((l) => setChips.indexOf(l) !== -1) || JSON.stringify(setChips));

console.log('ALL OK');

function Tree_parent(node) {
  return screen.components.indexOf(node) !== -1 ? null : 'nested';
}
