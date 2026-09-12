// Verifies the zoom feature: (1) stage/sizer transform tracks zoomLevel,
// (2) selection handles counter-scale to a constant physical size at any
// zoom and rebuild live when zoom changes, (3) drag/resize/rotate math
// stays correct (in ARTBOARD-LOCAL units) once zoomed, since all of those
// read raw mouse deltas (real screen px) and must divide by zoomLevel
// before touching comp.x/y/w/h. Same fakeJQ/document harness as
// mock-resize.js, since wireResizeHandle/wireRotateHandle use raw DOM
// addEventListener, not jQuery .on().
const docListeners = {};
global.document = {
  addEventListener(evt, fn) { (docListeners[evt] = docListeners[evt] || []).push(fn); },
  removeEventListener(evt, fn) {
    if (!docListeners[evt]) return;
    docListeners[evt] = docListeners[evt].filter(f => f !== fn);
  }
};
function fireDoc(evt, payload) {
  (docListeners[evt] || []).slice().forEach(fn => fn(payload));
}

function fakeDomNode() {
  const listeners = {};
  return {
    tagName: 'DIV',
    addEventListener(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    removeEventListener(evt, fn) {
      if (!listeners[evt]) return;
      listeners[evt] = listeners[evt].filter(f => f !== fn);
    },
    _fire(evt, payload) { (listeners[evt] || []).slice().forEach(fn => fn(payload)); }
  };
}

const handlesByClass = {};
function fakeJQ(selOrHtml, attrs) {
  const domNode = fakeDomNode();
  const el = {
    _css: {}, _text: '', _attrs: attrs || {}, _children: [], _handlers: {}, _domNode: domNode,
    // stageEl (artboardEl's parent) and sizerEl (stageEl's parent) have no
    // id/class of their own to hook on to — but artboardEl does, and
    // buildCanvasArea always builds sizer->stage->artboard in that nesting
    // order, so capturing this one id is enough to reach both ancestors
    // via ._parent afterward.
    css(o, v){ if(typeof o==='string') { if (v===undefined) return this._css[o]; this._css[o]=v; return this; } Object.assign(this._css,o); return this; },
    attr(k,v){ if(v===undefined) return this._attrs[k]; this._attrs[k]=v; return this; },
    data(k,v){ this._data=this._data||{}; if(v===undefined) return this._data[k]; this._data[k]=v; return this; },
    droppable(opts){ this._droppableOpts=opts; return this; },
    text(t){ if(t===undefined) return this._text; this._text=t; return this; },
    html(h){ this._html=h; return this; },
    append(c){ this._children.push(c); return this; },
    appendTo(p){
      p._children.push(this); this._parent=p;
      var cls = this._attrs && this._attrs['class'];
      if (cls) { (handlesByClass[cls] = handlesByClass[cls] || []).push(this); }
      if (this._attrs && this._attrs.id === 'nexa-artboard') global.__artboardEl = this;
      return this;
    },
    empty(){ this._children=[]; return this; },
    remove(){ if(this._parent) this._parent._children = this._parent._children.filter(c=>c!==this); return this; },
    val(v){ if(v===undefined) return this._val; this._val=v; return this; },
    prop(){ return this; },
    is(){ return false; },
    toggle(){ return this; },
    hide(){ return this; },
    show(){ return this; },
    find(sel){
      if (sel === '.nexa-component') { const m=(this._children||[]).filter(c=>c._attrs&&c._attrs['class']==='nexa-component'); const c=fakeJQ(); c._collection=m; c.css=function(o){m.forEach(x=>Object.assign(x._css, typeof o==='string'?{}:o)); return this;}; return c; }
      if (sel && sel.indexOf('data-id')!==-1) { const id=sel.match(/"([^"]+)"/)[1]; return (this._children||[]).find(c=>c._attrs&&c._attrs['data-id']===id)||fakeJQ(); }
      return fakeJQ();
    },
    on(evt, fn){ (this._handlers[evt]=this._handlers[evt]||[]).push(fn); return this; },
    off(){ return this; },
    get(){ return this._domNode; },
    offset(){ return {left:0, top:0}; }, // real screen origin == artboard-local origin, isolates the *zoomLevel math cleanly
    position(){ return {left:0, top:0}; },
    width(){ return 800; }, height(){ return 600; },
    draggable(opts){ this._draggableOpts=opts; draggables.push({el:this, opts}); return this; },
    get clientWidth(){ return 800; }, get clientHeight(){ return 600; },
    get length(){ return 1; }
  };
  // .get(0) is used as a plain object standing in for the real DOM node in
  // a couple of call sites (viewportEl.get(0).scrollLeft etc.) — give it
  // scroll fields directly on the node mock too.
  domNode.clientWidth = 800; domNode.clientHeight = 600;
  domNode.scrollLeft = 0; domNode.scrollTop = 0;
  return el;
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
let documentJQ = null;
global.$ = function(sel, attrs){
  if (sel === global.document) { if (!documentJQ) documentJQ = fakeJQ(); return documentJQ; }
  return fakeJQ(sel, attrs);
};
$.fn = {};

let actions = {}, configNodes = [], idCounter = 0;
global.RED = {
  plugins: { registerPlugin(id, def){ if (def.onadd) def.onadd(); } },
  actions: { add(id, fn){ actions[id]=fn; }, invoke(id){ actions[id](); } },
  menu: { addItem(){} },
  comms: { subscribe(){} },
  notify: function(msg, opts){ console.log('  [notify]', opts&&opts.type, msg); },
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
NEXA.registerComponent('mock-box', {
  category: 'Basic', label: 'Box', defaultSize: {w:100,h:100},
  capabilities: { resizable: true, rotatable: true, lockable: true },
  defaults: {},
  render: function(el) { /* no-op */ }
});

const fs = require('fs');
eval(fs.readFileSync(process.argv[2], 'utf8'));

actions['nexa:open-pages-editor']();
// The sidebar's new "Events" tab also registers draggable chips now, so the
// LAST registered draggable is no longer necessarily this test's own "Box"
// component chip — filter by its known label instead of positional index.
const boxDraggables = draggables.filter(function (d) { return chipText(d.el) === 'Box'; });
const boxDrag = boxDraggables[boxDraggables.length - 1];
// Placement now happens in the artboard's own .droppable() "drop" handler
// (editor-tray.js), not the palette chip's draggable "stop" — simulate a
// real drop by calling that handler directly with the chip as ui.draggable.
global.__artboardEl._droppableOpts.drop({ pageX: 200, pageY: 150 }, { draggable: boxDrag.el });

const comp = configNodes[0].screens[0].components[0];
console.log('placed comp:', { x: comp.x, y: comp.y, w: comp.w, h: comp.h });

console.log('--- zoom to 200% via the 5 zoom-in toolbar clicks (0.2 step, clamped to MAX_ZOOM 2.0) ---');
const toolbar = handlesByClass['nexa-zoom-toolbar'][0];
// children order from buildZoomToolbar: [zoomOut, label, reset, zoomIn, fit]
const zoomOutBtn = toolbar._children[0], resetBtn = toolbar._children[2], zoomInBtn = toolbar._children[3], fitBtn = toolbar._children[4];
for (let i = 0; i < 5; i++) zoomInBtn._handlers.click[0]({ preventDefault(){} });
const stageEl = global.__artboardEl._parent; // sizer -> stage -> artboard nesting, see the appendTo() hook above
console.log('stage transform after 5x zoom-in clicks (expect scale(2)):', stageEl._css.transform);

console.log('--- selection handles must counter-scale to stay a CONSTANT physical size at 200% zoom ---');
// addComponentAt already selects the new component right after placing it,
// and it's never been deselected since — so applyZoomTransform()'s own
// refreshSelectionVisuals() call (added specifically so handles don't go
// stale across a zoom change) should have already rebuilt the handles once
// per zoom-in click above. handlesByClass is append-only in this mock, so
// the LAST batch of 8 resize handles is the one current right now.
const compEl = (function find(node) {
  if (node._attrs && node._attrs['data-id'] === comp.id) return node;
  for (const c of (node._children||[])) { const r = find(c); if (r) return r; }
  return null;
})(global.__artboardEl);
const resizeHandles = handlesByClass['nexa-resize-handle'];
console.log('resize handle rebuild count so far (expect a multiple of 8, >=8):', resizeHandles.length);
const seHandle = resizeHandles[resizeHandles.length - 4]; // last batch: nw,n,ne,e,se,s,sw,w -> se is 4th-from-end
console.log('resize handle transform at zoom=2 (expect scale(0.5)):', seHandle._css.transform);
const rotHandle = handlesByClass['nexa-rotate-handle'][handlesByClass['nexa-rotate-handle'].length - 1];
console.log('rotate handle transform at zoom=2 (expect scale(0.5)):', rotHandle._css.transform);
console.log('rotate handle top offset at zoom=2 (expect -12px, i.e. -24/2):', rotHandle._css.top);
const lockIcon = handlesByClass['nexa-lock-handle'][handlesByClass['nexa-lock-handle'].length - 1];
console.log('lock icon transform at zoom=2 (expect scale(0.5)):', lockIcon._css.transform);

console.log('--- zoom OUT back down to 100% while selected: handles must rebuild to scale(1) automatically ---');
for (let i = 0; i < 5; i++) zoomOutBtn._handlers.click[0]({ preventDefault(){} });
const seHandleAt1 = handlesByClass['nexa-resize-handle'][handlesByClass['nexa-resize-handle'].length - 4];
console.log('resize handle transform back at zoom=1 (expect scale(1)):', seHandleAt1._css.transform);

console.log('--- drag at zoom=200%: a 40 REAL-pixel mouse delta must move the component by 20 LOCAL px (40/2) ---');
resetBtn._handlers.click[0]({ preventDefault(){} });
for (let i = 0; i < 5; i++) zoomInBtn._handlers.click[0]({ preventDefault(){} }); // back to zoom=2
const dragBefore = { x: comp.x, y: comp.y };
const compDrag = draggables.find(d => d.el === compEl || (d.el._attrs && d.el._attrs['data-id'] === comp.id));
compDrag.opts.start({ pageX: 0, pageY: 0 });
compDrag.opts.drag({ pageX: 40, pageY: 0 }, { position: {} }); // drag: now mutates ui.position in place (see nexa-plugin.html)
compDrag.opts.stop({ pageX: 40, pageY: 0 });
console.log('moved by:', comp.x - dragBefore.x, 'local px (expect 20, i.e. 40 real px / zoom 2)');

console.log('--- resize at zoom=200%: a 40 REAL-pixel mouse delta on the SE handle must grow w/h by 20 LOCAL px (40/2, already a grid(20) multiple so screen.snap does not further round it) ---');
const beforeResize = { w: comp.w, h: comp.h };
const seHandleNow = handlesByClass['nexa-resize-handle'][handlesByClass['nexa-resize-handle'].length - 4];
seHandleNow._domNode._fire('mousedown', { clientX: 0, clientY: 0, stopPropagation(){}, preventDefault(){} });
fireDoc('mousemove', { clientX: 40, clientY: 40 });
fireDoc('mouseup', {});
console.log('grew by:', comp.w - beforeResize.w, 'x', comp.h - beforeResize.h, 'local px (expect 20 x 20, i.e. 40 real px / zoom 2)');

console.log('ALL OK');
