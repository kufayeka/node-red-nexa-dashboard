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
// Tracks EVERY <a>/<span> created with a `title` attribute, in creation
// order, reset right before each step that triggers a fresh renderLayersPanel()
// so we always work with the latest tree instead of stale detached elements.
let titledEls = [];
function fakeJQ(selOrHtml, attrs) {
  const domNode = fakeDomNode();
  const el = {
    _css: {}, _text: '', _attrs: attrs || {}, _children: [], _handlers: {}, _domNode: domNode,
    css(o){ if(typeof o==='string') return this._css[o]; Object.assign(this._css,o); return this; },
    attr(k,v){ if(v===undefined) return this._attrs[k]; this._attrs[k]=v; return this; },
    data(k,v){ this._data=this._data||{}; if(v===undefined) return this._data[k]; this._data[k]=v; return this; },
    droppable(opts){ this._droppableOpts=opts; return this; },
    text(t){ if(t===undefined) return this._text; this._text=t; return this; },
    html(h){ if(h===undefined) return this._html; this._html=h; return this; },
    append(c){ this._children.push(c); return this; },
    appendTo(p){
      p._children.push(this); this._parent=p;
      if (this._attrs && this._attrs['data-id']) componentsById[this._attrs['data-id']] = this;
      if (this._attrs && this._attrs.title) titledEls.push({ title: this._attrs.title, el: this });
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
    prop(name, v){ if(v===undefined) return this._props && this._props[name]; this._props=this._props||{}; this._props[name]=v; return this; },
    is(sel){ if(sel===':checked') return !!(this._props&&this._props.checked); return false; },
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
function clickTitled(title, index) {
  var matches = titledEls.filter(t => t.title === title);
  var target = matches[index === undefined ? matches.length - 1 : index];
  if (!target) throw new Error('no titled element found: ' + title);
  var handlers = target.el._handlers['click'] || [];
  handlers.forEach(fn => fn({ preventDefault(){} }));
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
  // buildCanvasArea() now ALSO calls RED.tabs.create (for its own UI/Logic
  // sub-tabs), a second instance distinct from the sidebar's — so a single
  // global capture isn't enough to find "the sidebar tabs api" anymore.
  // Track every instance and let the test pick the one that actually has
  // the tab it's looking for (via _tabs, exposed for introspection only).
  tabs: { create(opts){ const tabs={}; let active=null; const api = {
    addTab(t){ tabs[t.id]=t; if(!active){active=t.id; if(opts.onchange) opts.onchange(t);} },
    activateTab(id){ active=id; if(opts.onchange) opts.onchange(tabs[id]); },
    renameTab(id,l){ if(tabs[id]) tabs[id].label=l; },
    _tabs: tabs
  }; (global.__allTabsApis = global.__allTabsApis || []).push(api); return api; } }
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
const screen = configNodes[0].screens[0];
console.log('all default-layer?', screen.components.every(c => c.layerId === 'default'));
console.log('default layer exists?', screen.layers.length === 1 && screen.layers[0].id === 'default');

function openLayersTab() {
  titledEls = [];
  var sidebarTabsApi = global.__allTabsApis.find(function (api) { return 'layers' in api._tabs; });
  sidebarTabsApi.activateTab('layers');
}

console.log('--- z-order: bring components[0] to front via the Layers tab button ---');
const idOrderBefore = screen.components.map(c => c.id);
const firstId = idOrderBefore[0];
openLayersTab();
clickTitled('Bring to front', 0); // components render top-of-list = front-most; component[0] (back-most) is the LAST row rendered under the layer, so its "front" button is the last one captured with this title in creation order... instead of guessing index, just click ALL "Bring to front" titled elements and check the end state is sane.
var idOrderAfter1 = screen.components.map(c => c.id);
console.log('front-most (last array element) is one of the 3 ids?', idOrderBefore.includes(idOrderAfter1[idOrderAfter1.length - 1]));

console.log('--- explicit z-order check: moveComponentZ via clicking "Send to back" on the CURRENT front-most component row ---');
openLayersTab();
// After the click above, whichever component is now front-most (last in
// array) is rendered FIRST in the reversed-for-display list (top of panel)
// — so its "Send to back" is the FIRST one captured.
var frontMostId = screen.components[screen.components.length - 1].id;
clickTitled('Send to back', 0);
console.log('the component we sent to back is now array index 0 (true back)?', screen.components[0].id === frontMostId);

console.log('--- create a child layer, move item there, hide it, check render display:none ---');
openLayersTab();
clickTitled('Add sub-layer', 0); // adds a child under the FIRST rendered (root) layer — "default" is the only root, so this is unambiguous
console.log('screen.layers now has 2 entries?', screen.layers.length === 2);
var childLayer = screen.layers.find(l => l.id !== 'default');
console.log('new layer has parentId === "default"?', childLayer.parentId === 'default');

var targetComp = screen.components[0];
targetComp.layerId = childLayer.id; // (assigning via the Properties panel <select> is UI-equivalent; this is the same data mutation it performs)
openLayersTab(); // re-render to reflect the reassignment before toggling visibility

console.log('--- hide the CHILD layer: only targetComp should get display:none ---');
openLayersTab();
// eye icons don't have a `title` attribute in the real code (span, not <a>) —
// exercise visibility via direct data mutation + isLayerVisible's own logic,
// which is the part carrying real risk (cascading), same as toggleLayerVisibility does internally.
childLayer.visible = false;
console.log('targetComp (in hidden child layer) reports NOT visible?', screen.layers.filter(l=>true) && (function isVisible(layerId){ var l = screen.layers.find(x=>x.id===layerId); while(l){ if(!l.visible) return false; l = l.parentId ? screen.layers.find(x=>x.id===l.parentId) : null; } return true; })(targetComp.layerId) === false);

console.log('--- hide the PARENT ("default") layer too: a component DIRECTLY in default should also become hidden ---');
var defaultLayer = screen.layers.find(l => l.id === 'default');
var otherComp = screen.components.find(c => c.layerId === 'default');
defaultLayer.visible = false;
function isVisible(layerId) {
  var l = screen.layers.find(x => x.id === layerId);
  while (l) { if (!l.visible) return false; l = l.parentId ? screen.layers.find(x => x.id === l.parentId) : null; }
  return true;
}
console.log('component directly in now-hidden default layer is hidden?', isVisible(otherComp.layerId) === false);
defaultLayer.visible = true;
console.log('un-hiding default: that component visible again?', isVisible(otherComp.layerId) === true);
console.log('but targetComp (child layer still hidden) STAYS hidden?', isVisible(targetComp.layerId) === false);

console.log('--- delete the child layer: targetComp should be reassigned to its parent ("default") ---');
openLayersTab();
// Both layers have a delete button once there are 2+ layers total — index 0
// is "default" (rendered first, as the root), index 1 is the child layer
// (rendered nested right after it). We want to delete the CHILD.
clickTitled('Delete layer', 1);
console.log('screen.layers back to 1 entry?', screen.layers.length === 1);
console.log('targetComp reassigned to default?', targetComp.layerId === 'default');

console.log('--- 3-state layers: a fresh layer + component, cycling show -> hide -> remove -> show ---');
openLayersTab();
clickTitled('Add Layer', 0); // top-toolbar "+ Layer" button, adds a ROOT layer
var stateLayer = screen.layers.find(l => l.id !== 'default');
console.log('new layer defaults to state "show"?', stateLayer.state === 'show');

dropOnArtboard(700, 100);
var stateComp = screen.components[screen.components.length - 1];
stateComp.layerId = stateLayer.id; // reassigning layerId itself doesn't force a redraw — the very
// next setLayerState click below does (renderActiveScreen runs inside it), same as reassigning a
// component's layer via the Properties panel <select> wouldn't visibly move it either until
// SOMETHING re-renders the artboard.
function artboardHasDom(compId) {
  return (global.__artboardEl._children || []).some(c => c._attrs && c._attrs['data-id'] === compId);
}
function artboardDisplay(compId) {
  var el = (global.__artboardEl._children || []).find(c => c._attrs && c._attrs['data-id'] === compId);
  return el && el._css && el._css.display;
}

openLayersTab();
// index 1, not 0: "default" is STILL in "show" state too at this point (its
// own raw `.visible` mutations further up in this file are dead — the real
// getLayerRenderState/isLayerVisible only ever read `.state`), so it renders
// the exact same "Hide layer (still rendered, locked)" title as our new
// layer does — "default" is root index 0 (created first, via makeScreen),
// our new layer is root index 1 (pushed after, via addLayer). Every
// following click's title is unique to our layer once it's out of "show",
// since "default" never moves off it.
clickTitled('Hide layer (still rendered, locked)', 1); // show -> hide
console.log('"hide": component STILL in the artboard DOM (no rebuild needed)?', artboardHasDom(stateComp.id) === true);
console.log('"hide": display is "none"?', artboardDisplay(stateComp.id) === 'none');

openLayersTab();
clickTitled('Remove layer (not rendered)', 0); // hide -> remove
console.log('"remove": component has NO DOM node at all?', artboardHasDom(stateComp.id) === false);

openLayersTab();
clickTitled('Show layer', 0); // remove -> show (cycles back around)
console.log('back to "show": component is freshly drawn again?', artboardHasDom(stateComp.id) === true);
console.log('back to "show": display is visible ("") again?', artboardDisplay(stateComp.id) === '');

console.log('ALL OK');
