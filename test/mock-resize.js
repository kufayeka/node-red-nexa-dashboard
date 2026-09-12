// Minimal fake "real DOM node" supporting addEventListener/removeEventListener,
// since wireResizeHandle/wireRotateHandle use raw DOM APIs (not jQuery .on()).
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
    css(o){ if(typeof o==='string') return this._css[o]; Object.assign(this._css,o); return this; },
    text(t){ if(t===undefined) return this._text; this._text=t; return this; },
    html(h){ this._html=h; return this; },
    append(c){ this._children.push(c); return this; },
    appendTo(p){
      p._children.push(this); this._parent=p;
      var cls = this._attrs && this._attrs['class'];
      if (cls) { (handlesByClass[cls] = handlesByClass[cls] || []).push(this); }
      return this;
    },
    empty(){ this._children=[]; return this; },
    remove(){ if(this._parent) this._parent._children = this._parent._children.filter(c=>c!==this); return this; },
    val(v){ if(v===undefined) return this._val; this._val=v; return this; },
    prop(){ return this; },
    is(){ return false; },
    closest(){ return { length: 0 }; },
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
    offset(){ return {left:0, top:0}; },
    width(){ return 800; }, height(){ return 600; },
    draggable(opts){ this._draggableOpts=opts; draggables.push({el:this, opts}); return this; },
    get length(){ return 1; }
  };
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
function dispatchKey(opts) {
  var hs = documentJQ && documentJQ._handlers['keydown.nexa'] || [];
  var evt = Object.assign({ target: {}, preventDefault(){}, key:'', ctrlKey:false, metaKey:false, shiftKey:false }, opts);
  hs.forEach(fn => fn(evt));
}
function undoFn(){ dispatchKey({ key: 'z', ctrlKey: true }); }
function redoFn(){ dispatchKey({ key: 'y', ctrlKey: true }); }
$.fn = {};
$.ajax = function(){ return { done(fn){ fn({value:1}); return this; }, fail(fn){ return this; } }; };

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
// The sidebar's new "Events" tab (renderEventsPanel) also registers
// draggable chips (On Load/On Render/On Close/Function/Debug) now, so the
// LAST registered draggable is no longer necessarily this test's own "Box"
// component chip — filter by its known label instead of positional index.
const boxDraggables = draggables.filter(function (d) { return chipText(d.el) === 'Box'; });
const boxDrag = boxDraggables[boxDraggables.length - 1];
boxDrag.opts.stop(null, { offset: { left: 200, top: 150 } });

const comp = configNodes[0].screens[0].components[0];
console.log('placed comp:', { x: comp.x, y: comp.y, w: comp.w, h: comp.h, rotation: comp.rotation, locked: comp.locked });

console.log('--- simulate resize via the SE corner handle ---');
const seHandle = handlesByClass['nexa-resize-handle'][4]; // nw,n,ne,e,se,s,sw,w
seHandle._domNode._fire('mousedown', { clientX: 300, clientY: 250, stopPropagation(){}, preventDefault(){} });
fireDoc('mousemove', { clientX: 350, clientY: 300 }); // +50,+50 screen delta, rotation=0 so local==screen
fireDoc('mouseup', {});
console.log('after SE resize (+50,+50, no rotation):', { x: comp.x, y: comp.y, w: comp.w, h: comp.h }, '(expect w=150,h=150, x/y unchanged)');

console.log('--- undo the resize ---');
undoFn();
console.log('after undo:', { x: comp.x, y: comp.y, w: comp.w, h: comp.h }, '(expect back to 100x100)');
console.log('--- redo the resize ---');
redoFn();
console.log('after redo:', { x: comp.x, y: comp.y, w: comp.w, h: comp.h }, '(expect 150x150 again)');

console.log('--- simulate rotate 90 degrees ---');
// comp is at x=160,y=100,w=150,h=150 (after redo) -> center at artboard (160+75, 100+75) = (235,175)
// offset() mocked to {left:0,top:0}, so screen center == artboard center.
const rotHandle = handlesByClass['nexa-rotate-handle'][0];
const cx = comp.x + comp.w/2, cy = comp.y + comp.h/2;
rotHandle._domNode._fire('mousedown', { clientX: cx, clientY: cy - 50, stopPropagation(){}, preventDefault(){} }); // start pointing "up" (angle -90deg)
fireDoc('mousemove', { clientX: cx + 50, clientY: cy }); // now pointing "right" (angle 0deg) -> +90deg delta
fireDoc('mouseup', {});
console.log('after rotate:', comp.rotation, '(expect ~90)');

console.log('--- lock toggle disables handles ---');
const lockIcon = handlesByClass['nexa-lock-handle'][handlesByClass['nexa-lock-handle'].length-1];
lockIcon._handlers.click[0]({ stopPropagation(){} });
console.log('locked now:', comp.locked, '(expect true)');

console.log('ALL OK');
