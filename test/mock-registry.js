global.document = {};
global.window = global;
const draggables = [];
function fakeJQ(selOrHtml, attrs) {
  const el = {
    _css: {}, _text: '', _attrs: attrs || {}, _children: [], _handlers: {},
    css(o){ if(typeof o==='string') return this._css[o]; Object.assign(this._css,o); return this; },
    text(t){ if(t===undefined) return this._text; this._text=t; return this; },
    html(h){ this._html=h; return this; },
    append(child){ this._children.push(child); return this; },
    appendTo(parent){ parent._children.push(this); this._parent=parent; return this; },
    empty(){ this._children=[]; return this; },
    val(v){ if(v===undefined) return this._val; this._val=v; return this; },
    prop(){ return this; },
    is(){ return false; },
    toggle(){ return this; },
    hide(){ return this; },
    show(){ return this; },
    remove(){ if(this._parent) this._parent._children = this._parent._children.filter(c=>c!==this); return this; },
    find(sel){
      if (sel === '.nexa-component') { const m=(this._children||[]).filter(c=>c._attrs&&c._attrs['class']==='nexa-component'); const c=fakeJQ(); c._collection=m; c.css=function(o){m.forEach(x=>Object.assign(x._css, typeof o==='string'?{}:o)); return this;}; return c; }
      if (sel && sel.indexOf('data-id')!==-1) { const id=sel.match(/"([^"]+)"/)[1]; return (this._children||[]).find(c=>c._attrs&&c._attrs['data-id']===id)||fakeJQ(); }
      return fakeJQ();
    },
    on(evt, fn){ (this._handlers[evt]=this._handlers[evt]||[]).push(fn); return this; },
    off(){ return this; },
    get(){ return { tagName: 'DIV', _fakeDomNode: true }; },
    offset(){ return {left:0, top:0}; },
    width(){ return 800; }, height(){ return 600; },
    draggable(opts){ this._draggableOpts=opts; draggables.push({el:this, opts}); return this; },
    get length(){ return 1; }
  };
  return el;
}
global.$ = function(sel, attrs){ return fakeJQ(sel, attrs); };
$.fn = {};
$.ajax = function(opts){ return { done(fn){ fn({value:1}); return this; }, fail(fn){ return this; } }; };

let actions = {}, configNodes = [], idCounter = 0;
global.RED = {
  plugins: { registerPlugin(id, def){ if (def.onadd) def.onadd(); } },
  actions: { add(id, fn){ actions[id]=fn; }, invoke(id){ actions[id](); } },
  menu: { addItem(){} },
  comms: { subscribe(){} },
  notify: function(msg, opts){ console.log('  [notify]', opts&&opts.type, msg); },
  events: { on(){}, emit(){} },
  log: { info: function(m){ console.log('  [RED.log.info]', m); } },
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

// Register a fake component type via the SAME queue pattern real component
// plugins use, BEFORE the core registry script has run — proves the
// load-order-tolerant bootstrap actually works in that direction.
window.NEXA = window.NEXA || { _q: [], registerComponent: function(id,def){ this._q.push([id,def]); } };
NEXA.registerComponent('mock-rect', {
  category: 'Basic', label: 'Rectangle', defaultSize: {w:120,h:80},
  defaults: { fill: { value: '#abc', type: 'color' } },
  render: function(el, props) { el._mockRenderedProps = props; console.log('  rect render() called with props', props); }
});

const fs = require('fs');
eval(fs.readFileSync(process.argv[2], 'utf8'));

// Register a SECOND component AFTER the core script has already run, proving
// the registry (not just the queue) accepts late registrations fine too.
NEXA.registerComponent('mock-text', {
  category: 'Basic', label: 'Text Label', defaultSize: {w:140,h:30},
  defaults: { text: { value: 'Hi', type: 'text' } },
  render: function(el, props) { el._mockRenderedProps = props; console.log('  text render() called with props', props); }
});

console.log('registered components:', NEXA.getComponents().map(c => c.id));

actions['nexa:open-pages-editor']();

// Capture the two PALETTE CHIP draggables by reference right after tray
// open, before either drop can add a third (the placed component's own
// move-draggable) into the same array and shift indices.
// Note: the sidebar's FIRST palette build happens during onadd(), which in
// this test is BEFORE 'mock-text' gets registered below (deliberately —
// this simulates the exact ordering hazard the buildPalette-refresh-on-
// tray-open mechanism exists to self-heal from). So there's a stale
// 1-chip snapshot (mock-rect only) ahead of the real one; grab the last
// two (the tray-open rebuild, which sees both registered components).
console.log('total draggables captured so far:', draggables.length);
// The sidebar's new "Events" tab also registers draggable chips on tray
// open now (after the components-palette rebuild), so filter by each
// component's own known label instead of assuming the last two entries.
const rectDraggables = draggables.filter(function (d) { return d.el._text === 'Rectangle'; });
const textDraggables = draggables.filter(function (d) { return d.el._text === 'Text Label'; });
const rectDrag = rectDraggables[rectDraggables.length - 1];
const textDrag = textDraggables[textDraggables.length - 1];

console.log('--- simulate dropping mock-rect ---');
rectDrag.opts.stop(null, { offset: { left: 300, top: 220 } });

console.log('--- simulate dropping mock-text ---');
textDrag.opts.stop(null, { offset: { left: 400, top: 320 } });

console.log('components on screen 1:', configNodes[0].screens[0].components.map(c => ({type: c.type, props: c.props})));
console.log('ALL OK');
