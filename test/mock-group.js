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
// the newest draggable for a node (a re-render registers a fresh one)
function state_selected() { return window.__nexaEditorState.selectedIds.slice(); }
function lastDragOf(id) { return draggables.filter(d => d.id === id).pop(); }
function dblclickOn(id, opts) {
  var el = componentsById[id];
  (el._handlers['dblclick'] || []).forEach(fn => fn(Object.assign({ stopPropagation(){} }, opts)));
}
function dropOnArtboard(x, y) {
  global.__artboardEl._droppableOpts.drop({ pageX: x, pageY: y }, { draggable: chip.el });
}

// Groups are tree nodes now (@group, see src/model/tree.js): a group hugs its
// children, their x / y are relative to it, and it is selected / dragged as one.
console.log('--- drop 3 items ---');
dropOnArtboard(100, 100);
dropOnArtboard(300, 100);
dropOnArtboard(500, 100);
const screen = configNodes[0].screens[0];
const [i0, i1, i2] = screen.components.slice();
const abs = (n) => {
  var g = screen.components.find(c => c.type === '@group' && (c.children || []).indexOf(n) !== -1);
  return { x: n.x + (g ? g.x : 0), y: n.y + (g ? g.y : 0) };
};
const absBefore = [i0, i1, i2].map(abs);
console.log('placed:', absBefore);

console.log('--- select item[0] and item[1] (shift-click), then Ctrl+G ---');
mousedownOn(i0.id, { shiftKey: false });
mousedownOn(i1.id, { shiftKey: true });
dispatchKey({ key: 'g', ctrlKey: true });
const group = screen.components.find(c => c.type === '@group');
console.log('a @group node now holds item[0] and item[1]?', !!group && group.children[0] === i0 && group.children[1] === i1);
console.log('item[2] stays top-level, the group takes their place in the stack?', screen.components.length === 2 && screen.components[0] === group && screen.components[1] === i2);
console.log('the group hugs its children (box = their bounds, children relative to it)?', group.x === i0.x + group.x && group.w === (i1.x + i1.w) - i0.x && i0.x === 0);
console.log('nothing moved on screen?', JSON.stringify([i0, i1, i2].map(abs)) === JSON.stringify(absBefore));
console.log('named "Group 1"?', group.name === 'Group 1');
console.log('the group is selected?', state_selected().length === 1 && state_selected()[0] === group.id);

console.log('--- a click on a member selects the whole group (Figma: outermost first); dragging moves the group ---');
dispatchKey({ key: 'Escape' });
mousedownOn(i1.id, { shiftKey: false });
console.log('clicking item[1] selected the group?', state_selected()[0] === group.id);
const gBefore = { x: group.x, y: group.y };
const d1 = lastDragOf(i1.id);
d1.opts.start({ pageX: 0, pageY: 0 });
const ui = { position: {} };
d1.opts.drag({ pageX: 20, pageY: 20 }, ui);
d1.opts.stop({ pageX: 20, pageY: 20 });
console.log('the group moved by (+20,+20)?', group.x - gBefore.x === 20 && group.y - gBefore.y === 20);
console.log('its children did not move inside it (x/y relative to the group)?', i0.x === 0 && i1.x === absBefore[1].x - absBefore[0].x);
console.log('the element under the pointer stays in place inside the group?', ui.position.left === i1.x && ui.position.top === i1.y);
console.log('item[2] untouched?', abs(i2).x === absBefore[2].x);

console.log('--- undo the move ---');
dispatchKey({ key: 'z', ctrlKey: true });
console.log('group back?', group.x === gBefore.x && group.y === gBefore.y);

console.log('--- double click dives into the group; Ctrl+click selects the deepest directly ---');
mousedownOn(i0.id, { shiftKey: false });
dblclickOn(i0.id);
console.log('double click on item[0] (group selected) selected item[0]?', state_selected()[0] === i0.id);
mousedownOn(i1.id, { shiftKey: false });
console.log('then a click on its sibling item[1] selects the sibling (same depth)?', state_selected()[0] === i1.id);
mousedownOn(i2.id, { shiftKey: false });
mousedownOn(i0.id, { shiftKey: false, ctrlKey: true });
console.log('Ctrl+click selected item[0] inside the group directly?', state_selected()[0] === i0.id);

console.log('--- moving a member inside the group: the group re-hugs (one undo step) ---');
const d0 = lastDragOf(i0.id);
d0.opts.start({ pageX: 0, pageY: 0 });
d0.opts.drag({ pageX: -40, pageY: 0 }, { position: {} });
d0.opts.stop({ pageX: -40, pageY: 0 });
const g2 = screen.components.find(c => c.type === '@group');
console.log('the group grew to the left, the member is at its left edge again?', g2.x === gBefore.x - 40 && i0.x === 0 && abs(i0).x === absBefore[0].x - 40);
console.log('item[1] did not move on screen?', abs(i1).x === absBefore[1].x);
dispatchKey({ key: 'z', ctrlKey: true });
console.log('undo restores the group and the member?', g2.x === gBefore.x && abs(i0).x === absBefore[0].x);

console.log('--- Ctrl+Shift+G ungroups (children keep their place), undo re-creates the group ---');
mousedownOn(i0.id, { shiftKey: false }); // selects the group
dispatchKey({ key: 'g', ctrlKey: true, shiftKey: true });
console.log('ungrouped: three top-level items again, in place?', screen.components.length === 3 && !screen.components.some(c => c.type === '@group') && JSON.stringify([i0, i1, i2].map(abs)) === JSON.stringify(absBefore));
dispatchKey({ key: 'z', ctrlKey: true });
console.log('undo: the group is back with the same members?', screen.components.length === 2 && screen.components[0].type === '@group' && screen.components[0].children[0] === i0);

console.log('--- deleting the group orphans its children (not deleted, not rendered) ---');
mousedownOn(i0.id, { shiftKey: false });
dispatchKey({ key: 'Delete' });
console.log('only item[2] is left in the tree, item[0] and item[1] are orphans?', screen.components.length === 1 && screen.components[0] === i2 && screen.orphans.length === 2 && screen.orphans[0] === i0);
dispatchKey({ key: 'z', ctrlKey: true });
console.log('undo: group and children back, no orphans?', screen.components.length === 2 && screen.orphans.length === 0);

console.log('--- grouping nodes of different parents is refused ---');
notifications.length = 0;
mousedownOn(i2.id, { shiftKey: false });
mousedownOn(i0.id, { shiftKey: true, ctrlKey: true }); // add item[0], deep inside the group
dispatchKey({ key: 'g', ctrlKey: true });
console.log('warned, no new group?', notifications.some(m => /share one parent/i.test(m)) && screen.components.filter(c => c.type === '@group').length === 1);

console.log('ALL OK');
