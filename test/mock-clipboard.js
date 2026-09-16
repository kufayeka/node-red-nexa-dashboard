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
  notify(msg, opts){ notifications.push(msg); },
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

// NOTE: removeComponents() (used by cut and by group/ungroup) does
// `screen.components = screen.components.filter(...)` — a REASSIGNMENT,
// not an in-place mutation. `comps` above is a snapshot of the array
// reference at one point in time and goes stale the moment that happens
// (same reason markDirty() has to explicitly resync projectConfigNode.
// screens = screens elsewhere in the real code). Always read
// `screen.components` fresh here instead of the stale `comps` alias.

console.log('--- COPY item[0], paste: expect a NEW id, offset +20,+20, original untouched ---');
mousedownOn(comps[0].id, { shiftKey: false });
var originalX = comps[0].x, originalY = comps[0].y, originalId = comps[0].id;
dispatchKey({ key: 'c', ctrlKey: true });
dispatchKey({ key: 'v', ctrlKey: true });
console.log('component count after copy-paste:', screen.components.length, '(expect 4)');
var pasted = screen.components[screen.components.length - 1];
console.log('pasted id !== original id?', pasted.id !== originalId);
console.log('pasted position offset by +20,+20?', pasted.x === originalX + 20 && pasted.y === originalY + 20);
console.log('original still present unchanged?', screen.components.some(c => c.id === originalId && c.x === originalX));

console.log('--- CUT item[1], paste: expect SAME id and SAME position restored ---');
var cutId = comps[1].id, cutX = comps[1].x, cutY = comps[1].y;
mousedownOn(cutId, { shiftKey: false });
dispatchKey({ key: 'x', ctrlKey: true });
console.log('component count after cut:', screen.components.length, '(expect 3)');
dispatchKey({ key: 'v', ctrlKey: true });
console.log('component count after cut-paste:', screen.components.length, '(expect 4)');
var restored = screen.components.find(c => c.id === cutId);
console.log('cut item restored with SAME id and SAME position?', !!restored && restored.x === cutX && restored.y === cutY);

console.log('--- paste AGAIN right after a cut-paste: should duplicate (new id), not collide ---');
dispatchKey({ key: 'v', ctrlKey: true });
console.log('component count after second paste:', screen.components.length, '(expect 5)');
var idsNow = screen.components.map(c => c.id);
var uniqueIds = new Set(idsNow);
console.log('all ids still unique (no collision)?', uniqueIds.size === idsNow.length);

console.log('--- copy a FULLY-grouped pair, paste: both get new ids sharing a NEW group id ---');
var a = comps[0].id, b = screen.components.find(c => c.id !== a && c.id !== restored.id && c.id !== pasted.id).id;
mousedownOn(a, { shiftKey: false });
mousedownOn(b, { shiftKey: true });
dispatchKey({ key: 'g', ctrlKey: true }); // group them
var groupIdBefore = screen.components.find(c => c.id === a).g;
mousedownOn(a, { shiftKey: false }); // re-select the whole group (click auto-expands)
dispatchKey({ key: 'c', ctrlKey: true });
dispatchKey({ key: 'v', ctrlKey: true });
var newOnes = screen.components.slice(-2);
console.log('pasted pair share a group id?', newOnes[0].g === newOnes[1].g && !!newOnes[0].g);
console.log('pasted group id is DIFFERENT from the original group id?', newOnes[0].g !== groupIdBefore);
console.log('screen.groups now has 2 entries (original + new)?', screen.groups.length === 2);

console.log('ALL OK');
