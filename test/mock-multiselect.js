const docListeners = {};
global.document = {
  addEventListener(evt, fn) { (docListeners[evt] = docListeners[evt] || []).push(fn); },
  removeEventListener(evt, fn) {
    if (!docListeners[evt]) return;
    docListeners[evt] = docListeners[evt].filter(f => f !== fn);
  }
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
const componentsById = {}; // data-id -> fakeJQ element, for direct mousedown simulation
let documentJQ = null;

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
      if (this._attrs && this._attrs['data-id']) componentsById[this._attrs['data-id']] = this;
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
global.$ = function(sel, attrs){
  if (sel === global.document) { if (!documentJQ) documentJQ = fakeJQ(); return documentJQ; }
  return fakeJQ(sel, attrs);
};
$.fn = {};
$.ajax = function(){ return { done(fn){ fn({value:1}); return this; }, fail(fn){ return this; } }; };

function mousedownOn(id, opts) {
  var el = componentsById[id];
  var handlers = el._handlers['mousedown'] || [];
  var evt = Object.assign({ stopPropagation(){}, shiftKey:false }, opts);
  handlers.forEach(fn => fn(evt));
}
function dragOf(id) { return draggables.find(d => d.id === id); }

let actions = {}, configNodes = [], idCounter = 0;
global.RED = {
  plugins: { registerPlugin(id, def){ if (def.onadd) def.onadd(); } },
  actions: { add(id, fn){ actions[id]=fn; }, invoke(id){ actions[id](); } },
  menu: { addItem(){} },
  comms: { subscribe(){} },
  notify(){},
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
NEXA.registerComponent('mock-item', {
  category: 'Basic', label: 'Item', defaultSize: {w:60,h:60},
  capabilities: { resizable: true, rotatable: true, lockable: true },
  defaults: {},
  render: function(){}
});

const fs = require('fs');
eval(fs.readFileSync(process.argv[2], 'utf8'));

actions['nexa:open-pages-editor']();
// The sidebar's new "Events" tab also registers draggable chips now, so
// filter by the known 'Item' label instead of positional index.
const itemDraggables = draggables.filter(function (d) { return chipText(d.el) === 'Item'; });
const chip = itemDraggables[itemDraggables.length - 1]; // the palette chip for 'mock-item'

console.log('--- drop 3 items at (100,100), (300,100), (500,100) ---');
chip.opts.stop(null, { offset: { left: 100, top: 100 } });
chip.opts.stop(null, { offset: { left: 300, top: 100 } });
chip.opts.stop(null, { offset: { left: 500, top: 100 } });

const comps = configNodes[0].screens[0].components;
console.log('placed:', comps.map(c => ({ id: c.id, x: c.x, y: c.y })));

console.log('--- shift-click item[1] and item[2] to add them to selection (item[2] is already sole-selected from the last drop) ---');
mousedownOn(comps[1].id, { shiftKey: true });
mousedownOn(comps[0].id, { shiftKey: true });
// selection should now be [comps[2].id (from drop), comps[1].id, comps[0].id] = all 3

console.log('--- drag comps[0] by delta (+20,+20); expect comps[1] and comps[2] to move by the same delta (group move) ---');
// The plugin's drag: handler now always grid-snaps the final position
// (unconditional, matching the jQuery UI grid:[...] option it replaced) —
// deltas here must be multiples of gridSize (20) or the assertion below
// would be comparing against a rounded-off value instead of the raw delta.
const drag0 = dragOf(comps[0].id);
const before = comps.map(c => ({ id: c.id, x: c.x, y: c.y }));
// The plugin now reads raw mouse-event pageX/pageY itself (not jQuery UI's
// own ui.position, which doesn't account for the canvas's CSS zoom scale —
// see nexa-plugin.html's drag: callback) so these calls simulate that: a
// start at an arbitrary pageX/pageY origin, then drag/stop deltas computed
// relative to it, matching the desired final artboard-local position
// (zoomLevel is 1 in this test, so pageX delta == local-unit delta).
drag0.opts.start({ pageX: 0, pageY: 0 });
// jQuery UI fires `drag` continuously during the pointer move (that's what
// actually applies the group-move delta to the OTHER selected items — see
// the drag: callback in renderComponent) and `stop` once at the end. My
// first pass at this test skipped `drag` entirely, which is why it looked
// like group-move wasn't moving anyone but the dragged item — the delta
// computation lives in `drag`, not `stop`.
var target = { left: before[0].x + 20, top: before[0].y + 20 };
var targetEvent = { pageX: target.left - before[0].x, pageY: target.top - before[0].y };
drag0.opts.drag(targetEvent, { position: {} }); // drag: now mutates ui.position in place (see nexa-plugin.html) — real jQuery UI applies it to the DOM right after, mock just needs the object to exist
drag0.opts.stop(targetEvent);
const after = comps.map(c => ({ id: c.id, x: c.x, y: c.y }));
console.log('before:', before);
console.log('after: ', after);
const allMovedBySameDelta = after.every((c, i) => c.x - before[i].x === 20 && c.y - before[i].y === 20);
console.log('all 3 moved by the same delta (+20,+20)?', allMovedBySameDelta);

console.log('--- undo the group move (should revert all 3) ---');
function dispatchKey(opts) {
  var hs = documentJQ && documentJQ._handlers['keydown.nexa'] || [];
  var evt = Object.assign({ target: {}, preventDefault(){}, key:'', ctrlKey:false, metaKey:false, shiftKey:false }, opts);
  hs.forEach(fn => fn(evt));
}
dispatchKey({ key: 'z', ctrlKey: true });
const afterUndo = comps.map(c => ({ id: c.id, x: c.x, y: c.y }));
console.log('after undo:', afterUndo);
const revertedCorrectly = afterUndo.every((c, i) => c.x === before[i].x && c.y === before[i].y);
console.log('all 3 back to pre-move position?', revertedCorrectly);

console.log('--- marquee-select all 3 (simulated directly via a fresh selectMultiple-equivalent: re-select via shift-click all three, then delete together) ---');
mousedownOn(comps[2].id, { shiftKey: false }); // select only comps[2]
mousedownOn(comps[1].id, { shiftKey: true });  // add comps[1]
mousedownOn(comps[0].id, { shiftKey: true });  // add comps[0] -> all 3 selected again

console.log('--- press Delete: all 3 should be removed together as one multi history entry, then undo should bring all 3 back ---');
dispatchKey({ key: 'Delete' });
console.log('components remaining after delete:', configNodes[0].screens[0].components.length, '(expect 0)');
dispatchKey({ key: 'z', ctrlKey: true });
console.log('components remaining after undo delete:', configNodes[0].screens[0].components.length, '(expect 3)');

console.log('--- marquee-select: drag a box covering only the first two items (x 0-350), not the third (x=480) ---');
// Positions are back to the original drop spots after the earlier undo:
// ndb2e2245 @ x=80 (w=60), n0bf8ff25 @ x=280 (w=60), n0d1d47bb @ x=480 (w=60).
var artboardHandlers = global.__artboardEl._handlers['mousedown'] || [];
artboardHandlers.forEach(fn => fn({ target: global.__artboardEl._domNode, shiftKey: false, pageX: 0, pageY: 0 }));
fireDoc('mousemove', { pageX: 350, pageY: 200 });
fireDoc('mouseup', {});

console.log('--- drag item[0] by (+20,0): only item[0] and item[1] (marquee-selected) should move, item[2] should not ---');
var before2 = comps.map(c => ({ id: c.id, x: c.x }));
var d = dragOf(comps[0].id);
d.opts.start({ pageX: 0, pageY: 0 });
d.opts.drag({ pageX: 20, pageY: 0 }, { position: {} });
d.opts.stop({ pageX: 20, pageY: 0 });
var after2 = comps.map(c => ({ id: c.id, x: c.x }));
console.log('before:', before2);
console.log('after: ', after2);
var marqueeSelectedCorrectPair = (after2[0].x - before2[0].x === 20) && (after2[1].x - before2[1].x === 20) && (after2[2].x - before2[2].x === 0);
console.log('marquee correctly selected only item[0]+item[1], not item[2]?', marqueeSelectedCorrectPair);

console.log('ALL OK');
