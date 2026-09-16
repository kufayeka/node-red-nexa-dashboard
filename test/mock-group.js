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
eval(fs.readFileSync(process.argv[2], 'utf8'));

actions['nexa:open-pages-editor']();
// The sidebar's new "Events" tab also registers draggable chips now, so
// filter by the known 'Item' label instead of positional index.
const itemDraggables = draggables.filter(function (d) { return chipText(d.el) === 'Item'; });
const chip = itemDraggables[itemDraggables.length - 1];

console.log('--- drop 3 items ---');
// Placement now happens in the artboard's own .droppable() "drop" handler
// (editor-tray.js), not the palette chip's draggable "stop" — simulate a
// real drop by calling that handler directly with the chip as ui.draggable.
function dropOnArtboard(x, y) {
  global.__artboardEl._droppableOpts.drop({ pageX: x, pageY: y }, { draggable: chip.el });
}
dropOnArtboard(100, 100);
dropOnArtboard(300, 100);
dropOnArtboard(500, 100);
const comps = configNodes[0].screens[0].components;
const screen = configNodes[0].screens[0];
console.log('ids:', comps.map(c => c.id));

console.log('--- select item[0] and item[1] (shift-click), then Ctrl+G to group ---');
mousedownOn(comps[0].id, { shiftKey: false });
mousedownOn(comps[1].id, { shiftKey: true });
dispatchKey({ key: 'g', ctrlKey: true });
console.log('comp[0].g === comp[1].g?', comps[0].g === comps[1].g, '(expect true)');
console.log('comp[2].g is undefined?', comps[2].g === undefined, '(expect true)');
console.log('screen.groups.length:', screen.groups.length, '(expect 1)');

console.log('--- click item[1] alone (no shift): should auto-select the WHOLE group (item[0] too) ---');
mousedownOn(comps[1].id, { shiftKey: false });
console.log('--- drag item[1] by (+20,+20): item[0] should move too (grouped), item[2] should not ---');
// The plugin's drag: handler now reads raw mouse-event pageX/pageY itself
// (not jQuery UI's own ui.position, which doesn't account for the canvas's
// CSS zoom scale) and always grid-snaps (gridSize 20) the result, matching
// the jQuery UI grid:[...] option it replaces — so simulate a start origin
// plus a delta that's already a grid multiple.
const before = comps.map(c => ({ id: c.id, x: c.x, y: c.y }));
const d1 = dragOf(comps[1].id);
d1.opts.start({ pageX: 0, pageY: 0 });
d1.opts.drag({ pageX: 20, pageY: 20 }, { position: {} }); // drag: now mutates ui.position in place (see nexa-plugin.html)
d1.opts.stop({ pageX: 20, pageY: 20 });
const after = comps.map(c => ({ id: c.id, x: c.x, y: c.y }));
console.log('before:', before);
console.log('after: ', after);
const groupMovedTogether = (after[0].x - before[0].x === 20) && (after[0].y - before[0].y === 20) && (after[1].x - before[1].x === 20) && (after[2].x - before[2].x === 0);
console.log('clicking one grouped member dragged BOTH members together, third untouched?', groupMovedTogether);

console.log('--- undo the group-move (should revert both grouped members) ---');
dispatchKey({ key: 'z', ctrlKey: true });
console.log('reverted:', comps.map(c => ({ id: c.id, x: c.x, y: c.y })));

console.log('--- Ctrl+Shift+G to ungroup ---');
// The preceding undo (like every applyHistoryEvent) cleared selectedIds —
// re-select the group by clicking a member first, same as a real user
// would have to (undo doesn't keep anything selected in this app, a
// pre-existing behavior, not new to grouping).
mousedownOn(comps[0].id, { shiftKey: false });
dispatchKey({ key: 'g', ctrlKey: true, shiftKey: true });
console.log('comp[0].g after ungroup:', comps[0].g, '(expect undefined)');
console.log('comp[1].g after ungroup:', comps[1].g, '(expect undefined)');
console.log('screen.groups.length after ungroup:', screen.groups.length, '(expect 0)');

console.log('--- undo the ungroup (should re-create the group) ---');
dispatchKey({ key: 'z', ctrlKey: true });
console.log('comp[0].g === comp[1].g after undo-ungroup?', comps[0].g === comps[1].g && !!comps[0].g, '(expect true)');
console.log('screen.groups.length after undo-ungroup:', screen.groups.length, '(expect 1)');

console.log('--- attempting to group an already-grouped member with a third should warn and refuse ---');
notifications.length = 0;
mousedownOn(comps[0].id, { shiftKey: false }); // selects the whole group (item0+item1)
mousedownOn(comps[2].id, { shiftKey: true });  // add the ungrouped item2
dispatchKey({ key: 'g', ctrlKey: true });
console.log('warned about already-grouped member?', notifications.some(m => /already/i.test(m)));
console.log('screen.groups.length still 1 (no new group created)?', screen.groups.length === 1);

console.log('ALL OK');
