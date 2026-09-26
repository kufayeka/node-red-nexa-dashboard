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

// A project saved before the node tree: flat components, layers (one nested,
// one hidden) and an old group. Opening the editor migrates it.
configNodes.push({ id: 'cfg-old', type: 'kufayeka-nexa-project', name: 'Old', templates: [], screens: [{
  id: 'old1', name: 'Old screen', path: '/old', width: 800, height: 600, gridSize: 20, snap: true,
  layers: [{ id: 'default', name: 'Default Layer', parentId: null, state: 'show' }, { id: 'pop', name: 'Popup', parentId: null, state: 'hide' }, { id: 'popb', name: 'Popup buttons', parentId: 'pop', state: 'show' }],
  groups: [{ id: 'G1', x: 0, y: 0, w: 0, h: 0 }],
  components: [
    { id: 'a', type: 'mock-item', x: 40, y: 40, w: 60, h: 60, layerId: 'default' },
    { id: 'b', type: 'mock-item', x: 300, y: 200, w: 60, h: 60, layerId: 'pop' },
    { id: 'c', type: 'mock-item', x: 320, y: 300, w: 60, h: 60, layerId: 'popb' },
    { id: 'd', type: 'mock-item', x: 100, y: 400, w: 60, h: 60, layerId: 'default', g: 'G1' },
    { id: 'e', type: 'mock-item', x: 200, y: 400, w: 60, h: 60, layerId: 'default', g: 'G1' }
  ], logic: { nodes: [], wires: [] } }] });

eval(fs.readFileSync(process.argv[2], 'utf8'));
actions['nexa:open-pages-editor']();
const screen = configNodes[0].screens[0];
const byId = (id) => { var f = null; (function walk(l) { l.forEach(n => { if (n.id === id) f = n; if (n.children) walk(n.children); }); })(screen.components); return f; };
const rendered = (id) => !!componentsById[id] && (function inTree(el) { while (el) { if (el === global.__artboardEl) return true; el = el._parent; } return false; })(componentsById[id]);
const render = () => { Object.keys(componentsById).forEach(k => delete componentsById[k]); window.__nexaEditor.render(); };

console.log('--- the old screen was migrated to the node tree on open ---');
console.log('top level: a, the Popup group, Group 1?', JSON.stringify(screen.components.map(n => n.id)) === JSON.stringify(['a', 'pop', 'G1']));
console.log('layers / groups / layerId are gone?', screen.layers === undefined && screen.groups === undefined && byId('a').layerId === undefined && screen.treeVersion === 1);
console.log('Popup is a hidden group holding b and the nested "Popup buttons" group?', byId('pop').type === '@group' && byId('pop').visibility === 'hide' && JSON.stringify(byId('pop').children.map(n => n.id)) === JSON.stringify(['b', 'popb']));
console.log('b keeps its place on screen (x relative to the group)?', byId('pop').x + byId('b').x === 300 && byId('pop').y + byId('b').y === 200);

console.log('--- rendering follows effective visibility ---');
render();
console.log('a (visible) is drawn and draggable?', rendered('a') && draggables.some(d => d.id === 'a'));
console.log('the hidden Popup group is drawn but display:none, and so are its children (instant to show again)?',
  rendered('pop') && componentsById['pop']._css.display === 'none' && rendered('c') && componentsById['c']._css.display === 'none');
console.log('children are drawn INSIDE their group\'s element?', componentsById['b']._parent === componentsById['pop'] && componentsById['c']._parent === componentsById['popb']);
console.log('a hidden node takes no clicks (no mousedown wiring)?', !(componentsById['b']._handlers.mousedown || []).length);

byId('pop').visibility = 'remove';
render();
console.log('"remove": the group and everything inside is not drawn at all?', !rendered('pop') && !rendered('b') && !rendered('c'));
delete byId('pop').visibility;
render();
console.log('back to "show": drawn again and visible?', rendered('c') && componentsById['c']._css.display === '');

console.log('--- a locked group locks what is inside ---');
byId('G1').locked = true;
draggables.length = 0;
render();
console.log('no drag wiring for the locked group nor its children?', !draggables.some(d => d.id === 'G1' || d.id === 'd' || d.id === 'e'));
console.log('but they can still be selected (click wiring present)?', (componentsById['d']._handlers.mousedown || []).length > 0);
mousedownOn('d', {});
dispatchKey({ key: 'Delete' });
console.log('Delete does nothing to a locked group?', !!byId('G1') && byId('G1').children.length === 2);

console.log('ALL OK');
