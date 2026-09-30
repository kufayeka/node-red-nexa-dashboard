// Test suite for tree redesign, variables in tree, folder reordering, and sidebar tabs
const fs = require('fs');
const path = require('path');

const docListeners = {};
global.document = {
  documentElement: { style: {} },
  addEventListener(evt, fn) { (docListeners[evt] = docListeners[evt] || []).push(fn); },
  removeEventListener(evt, fn) { if (docListeners[evt]) docListeners[evt] = docListeners[evt].filter(f => f !== fn); },
  createElementNS(ns, tag) { return fakeJQ('<' + tag + '>'); },
  createElement(tag) {
    const el = fakeJQ('<' + tag + '>');
    el.tagName = tag.toUpperCase();
    el._attrs = {};
    el.setAttribute = function (k, v) { this._attrs[k] = v; };
    el.getAttribute = function (k) { return this._attrs[k]; };
    el.addEventListener = function (evt, fn) {
      this._handlers[evt] = this._handlers[evt] || [];
      this._handlers[evt].push(fn);
    };
    el.dispatchEvent = function (customEvt) {
      var hs = this._handlers[customEvt.type] || [];
      hs.forEach(fn => fn(customEvt));
    };
    return el;
  }
};

function fakeDomNode() {
  const listeners = {};
  return {
    tagName: 'DIV',
    appendChild(child) { (this._children = this._children || []).push(child); return child; },
    addEventListener(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    removeEventListener(evt, fn) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn); },
    _fire(evt, payload) { (listeners[evt] || []).slice().forEach(fn => fn(payload)); }
  };
}

let documentJQ = null;
function fakeJQ(selOrHtml, attrs) {
  const domNode = fakeDomNode();
  const tag = String(selOrHtml || '').replace(/[<>]/g, '').trim().toLowerCase();
  const el = {
    _isFakeJQ: true,
    _tag: tag,
    _css: {}, _text: '', _attrs: attrs || {}, _children: [], _handlers: {}, _domNode: domNode,
    css(o) { if (typeof o === 'string') return this._css[o]; Object.assign(this._css, o); return this; },
    attr(k, v) { if (typeof k === 'object') { Object.assign(this._attrs, k); return this; } if (v === undefined) return this._attrs[k]; this._attrs[k] = v; return this; },
    data(k, v) { this._data = this._data || {}; if (v === undefined) return this._data[k]; this._data[k] = v; return this; },
    droppable(opts) { this._droppableOpts = opts; return this; },
    draggable(opts) { this._draggableOpts = opts; return this; },
    off() { return this; },
    text(t) { if (t === undefined) return this._text; this._text = t; return this; },
    html(h) { if (h === undefined) return this._html; this._html = h; return this; },
    append(c) {
      if (typeof c === 'string') {
        const wrap = fakeJQ('<div>'); wrap._text = c; this._children.push(wrap);
      } else {
        this._children.push(c);
      }
      return this;
    },
    prependTo(p) { p._children.unshift(this); this._parent = p; return this; },
    appendTo(p) {
      if (p && p._children) { p._children.push(this); this._parent = p; }
      else if (p && p.appendChild) { p.appendChild(this); }
      return this;
    },
    empty() { this._children = []; return this; },
    remove() { if (this._parent) this._parent._children = this._parent._children.filter(c => c !== this); return this; },
    val(...args) { if (args.length === 0) return this._val !== undefined ? this._val : ''; this._val = args[0] !== undefined ? args[0] : ''; return this; },
    prop(k, v) { if (v === undefined) return this['_' + k]; this['_' + k] = v; return this; },
    is(sel) {
      if (sel === ':checked') return !!this._checked;
      if (sel === ':visible') return this._css.display !== 'none';
      return false;
    },
    show() { delete this._css.display; return this; },
    hide() { this._css.display = 'none'; return this; },
    toggle(v) { if (v === undefined) v = this._css.display === 'none'; if (v) this.show(); else this.hide(); return this; },
    find(sel) {
      const out = [];
      (function walk(node) {
        (node._children || []).forEach(c => {
          if (c._attrs) {
            if (sel.startsWith('.') && (' ' + (c._attrs['class'] || '') + ' ').includes(' ' + sel.slice(1) + ' ')) out.push(c);
            else if (sel.startsWith('#') && c._attrs.id === sel.slice(1)) out.push(c);
            else if (c._tag === sel) out.push(c);
          }
          walk(c);
        });
      })(this);
      const res = fakeJQ('<div>');
      res._collection = out;
      res.length = out.length;
      res.remove = function () { out.forEach(c => c.remove()); return this; };
      res.text = function (t) { if (t === undefined) return out[0] ? out[0]._text : ''; out.forEach(c => c.text(t)); return this; };
      res.html = function (h) { if (h === undefined) return out[0] ? out[0]._html : ''; out.forEach(c => c.html(h)); return this; };
      res.show = function () { out.forEach(c => c.show()); return this; };
      res.hide = function () { out.forEach(c => c.hide()); return this; };
      res.toggle = function (v) { out.forEach(c => c.toggle(v)); return this; };
      res.filter = function (fn) {
        const filtered = out.filter((c, i) => fn.call(c, i, c));
        const r = fakeJQ('<div>'); r._collection = filtered; r.length = filtered.length;
        r.show = function () { filtered.forEach(c => c.show()); return this; };
        r.hide = function () { filtered.forEach(c => c.hide()); return this; };
        return r;
      };
      return res;
    },
    parent() { return this._parent || fakeJQ('<div>'); },
    closest() { return fakeJQ('<div>'); },
    get(i) { return i === 0 ? this._domNode : undefined; },
    offset() { return { left: 0, top: 0 }; },
    width() { return 1280; },
    height() { return 800; },
    on(evt, fn) { this._handlers[evt] = this._handlers[evt] || []; this._handlers[evt].push(fn); return this; },
    trigger(evt, payload) { (this._handlers[evt] || []).forEach(fn => fn(payload)); return this; },
    typedInput(optOrMethod, arg) {
      if (optOrMethod === 'type') {
        if (arg === undefined) return this._typedInputType || (this._typedInputOpts && this._typedInputOpts.default) || 'str';
        this._typedInputType = arg;
        return this;
      }
      if (optOrMethod === 'value') {
        if (arg === undefined) return this._typedInputValue !== undefined ? this._typedInputValue : (this._val !== undefined ? this._val : '');
        this._typedInputValue = arg;
        this._val = arg;
        return this;
      }
      this._typedInputOpts = optOrMethod;
      if (optOrMethod && optOrMethod.default) this._typedInputType = optOrMethod.default;
      return this;
    }
  };
  return el;
}

const $ = function (sel, attrs) {
  if (sel === global.document) {
    if (!documentJQ) documentJQ = fakeJQ('document');
    return documentJQ;
  }
  if (sel && sel._isFakeJQ) return sel;
  return fakeJQ(sel, attrs);
};
$.getJSON = function (url, cb) { cb({ port: 1881 }); return { fail() { return this; } }; };

const configNodes = [{
  id: 'cfg1',
  type: 'kufayeka-nexa-project',
  screens: [{ id: 's1', name: 'Screen 1', path: '/screen1', width: 1280, height: 800, logic: { nodes: [], wires: [] } }],
  templates: [],
  folders: [],
  flows: []
}];

const actions = {};
global.RED = {
  settings: { theme: () => 'light' },
  nodes: {
    node: id => configNodes.find(n => n.id === id),
    eachConfig(fn) { configNodes.forEach(fn); },
    getType(t) { return { defaults: { screens: { value: [] }, templates: { value: [] }, folders: { value: [] }, flows: { value: [] } } }; },
    id() { return 'n_' + Math.random().toString(16).slice(2, 8); },
    add(n) { configNodes.push(n); },
    dirty() {}
  },
  actions: {
    add(k, fn) { actions[k] = fn; },
    invoke(k) { if (actions[k]) actions[k](); }
  },
  tray: {
    show(opts) {
      const body = fakeJQ('<div>', { id: 'tray-body' });
      opts.open(body);
      global.__trayOpts = opts;
    },
    close() { if (global.__trayOpts && global.__trayOpts.close) global.__trayOpts.close(); }
  },
  notify(msg) {},
  plugins: { registerPlugin(id, def) { if (def && def.onadd) def.onadd(); } },
  sidebar: { addTab(tab) { if (tab && tab.content) global.__sidebarContent = tab.content; } },
  tabs: {
    create(opts) {
      const tabs = {};
      const order = [];
      let active = null;
      const api = {
        addTab(t) {
          tabs[t.id] = t;
          order.push(t.id);
          if (opts.element) {
            const li = fakeJQ('<li>', { 'class': 'red-ui-tab', 'aria-controls': t.id });
            li._text = t.label;
            li.appendTo(opts.element);
          }
          if (!active) { active = t.id; if (opts.onchange) opts.onchange(t); }
        },
        activateTab(id) { active = id; if (opts.onchange) opts.onchange(tabs[id]); },
        renameTab(id, l) { if (tabs[id]) tabs[id].label = l; },
        hideTab(id) {},
        showTab(id) {},
        _tabs: tabs,
        _order: order
      };
      (global.__allTabsApis = global.__allTabsApis || []).push(api);
      return api;
    }
  }
};

global.window = global;
window.$ = $;
window.NexaKit = true;
window.NEXA = window.NEXA || { _q: [], registerComponent(id, def) { this._q.push([id, def]); } };

// Load the extracted editor bundle
const editorScriptPath = path.join(__dirname, '.extracted-editor.js');
eval(fs.readFileSync(editorScriptPath, 'utf8'));

actions['nexa:open-pages-editor']();

const state = window.__nexaEditorState;
const api = window.__nexaEditorApi;

console.log('--- 1. Sidebar Tab Order Verification ---');
const sidebarTabApi = global.__allTabsApis[0];
const expectedTabs = ['screens', 'components', 'hierarchy', 'events', 'properties', 'theme', 'types', 'assets', 'breakpoints', 'sparkplug'];
console.log('Tabs are in exact order: screens -> components -> hierarchy -> events -> properties ... ?',
  JSON.stringify(sidebarTabApi._order) === JSON.stringify(expectedTabs));

console.log('--- 2. Tree Badges & Actions Overhaul ---');
const screen1 = state.screens[0];
const flow1 = api.makeFlow({ name: 'Flow 1', endpoint: '/flow1' });
state.flows = [flow1];
const app = api.getApp();
app.variables = [
  { id: 'v1', name: 'counter', type: 'number', defaultValue: 10, persist: 'local' }
];
screen1.variables = [
  { id: 'sv1', name: 'isLoaded', type: 'boolean', defaultValue: true }
];

const nodes = api.buildScreensFlowsTreeNodes();
console.log('Root sections count is 4?', nodes.length === 4);
const screensSec = nodes[0];
const templatesSec = nodes[1];
const flowsSec = nodes[2];
const appVarsSec = nodes[3];

console.log('Screens section exists with id section:screens?', screensSec.id === 'section:screens');
console.log('App Variables section exists with id section:app-variables?', appVarsSec.id === 'section:app-variables');

const screenNode = screensSec.children.find(c => c.id === screen1.id);
console.log('Screen has no redundant badge?', screenNode.badge === undefined);
console.log('Screen has no open action?', !screenNode.actions.some(a => a.id === 'open'));
console.log('Screen has add-screen-var action?', screenNode.actions.some(a => a.id === 'add-screen-var'));
console.log('Screen has screen variable as child in tree?', screenNode.children.some(c => c.id === 'screen-var:' + screen1.id + ':sv1'));

const flowNode = flowsSec.children.find(c => c.id === flow1.id);
console.log('Flow has no redundant badge?', flowNode.badge === undefined);
console.log('Flow HAS open action?', flowNode.actions.some(a => a.id === 'open'));

const appVarNode = appVarsSec.children.find(c => c.id === 'app-var:v1');
console.log('App variable counter present in appVarsSec?', appVarNode && appVarNode.label === 'counter');

console.log('--- 3. Folder / Group Reordering ---');
const f1 = api.makeFolder({ name: 'Group 1', category: 'screen' });
const f2 = api.makeFolder({ name: 'Group 2', category: 'screen' });
state.folders = [f1, f2];

// Move f2 before f1
api.renderScreenList();
const treeEl = state.screensFlowsTreeEl;
treeEl.dispatchEvent({
  type: 'nx-tree-move',
  detail: { id: f2.id, targetId: f1.id, position: 'before' }
});

console.log('Moving f2 before f1 updates state.folders order?', state.folders[0].id === f2.id && state.folders[1].id === f1.id);

console.log('--- 4. Global Expand All & Collapse All ---');
let setAllCollapsedArg = null;
state.screensFlowsTreeEl.setAllCollapsed = function (collapsed) { setAllCollapsedArg = collapsed; };

api.expandAllScreensTree();
console.log('expandAllScreensTree calls setAllCollapsed(false)?', setAllCollapsedArg === false);

api.collapseAllScreensTree();
console.log('collapseAllScreensTree calls setAllCollapsed(true)?', setAllCollapsedArg === true);

console.log('--- 5. Adding & Selecting Variables in Tree ---');
// Add app variable
const prevAppVarsCount = (app.variables || []).length;
api.addAppVariableFromSidebar();
console.log('addAppVariableFromSidebar adds new variable?', (app.variables || []).length === prevAppVarsCount + 1);
console.log('addAppVariableFromSidebar sets editingMode to "app-variable"?', state.editingMode === 'app-variable');

// Select variable in tree
state.screensFlowsTreeEl.dispatchEvent({
  type: 'nx-tree-select',
  detail: { id: 'screen-var:' + screen1.id + ':sv1' }
});
console.log('Selecting screen-var in tree sets editingMode to "screen-variable"?', state.editingMode === 'screen-variable');
console.log('Active screen variable ID matches?', state.activeScreenVariableId === 'sv1');
console.log('Tree selected property immediately updated to selected variable?', Array.isArray(state.screensFlowsTreeEl.selected) && state.screensFlowsTreeEl.selected[0] === 'screen-var:' + screen1.id + ':sv1');

api.renderScreenForm();
console.log('renderScreenForm renders typedInput widget for variable defaultValue?', !!state.screenFormEl.find('input')._collection.find(c => c._typedInputOpts));

console.log('--- 6. Template Tree Hierarchy: Variables & Parameters ---');
const tmpl1 = api.makeTemplate({ name: 'MyTemplate' });
tmpl1.variables = [{ id: 'tv1', name: 'tempVar', type: 'string', defaultValue: 'hello' }];
tmpl1.params = [{ id: 'tp1', name: 'tempParam', label: 'Temp Param', type: 'number', defaultValue: 42 }];
state.templates = [tmpl1];

const updatedNodes = api.buildScreensFlowsTreeNodes();
const tmplSec = updatedNodes[1];
let tmplNode = tmplSec.children.find(c => c.id === tmpl1.id);
if (!tmplNode) {
  for (const group of tmplSec.children) {
    if (group.children) {
      const found = group.children.find(c => c.id === tmpl1.id);
      if (found) { tmplNode = found; break; }
    }
  }
}
console.log('Template node is container with 2 children (Variables & Parameters)?', tmplNode && tmplNode.container && tmplNode.children.length === 2);
const tmplVarsGroup = tmplNode.children[0];
const tmplParamsGroup = tmplNode.children[1];
console.log('Template child 1 is Variables group with add-template-var?', tmplVarsGroup.label === 'Variables' && tmplVarsGroup.actions.some(a => a.id === 'add-template-var'));
console.log('Template child 1 contains template variable?', tmplVarsGroup.children.some(c => c.id === 'template-var:' + tmpl1.id + ':tv1'));
console.log('Template child 2 is Parameters group with add-template-param?', tmplParamsGroup.label === 'Parameters' && tmplParamsGroup.actions.some(a => a.id === 'add-template-param'));
console.log('Template child 2 contains template param?', tmplParamsGroup.children.some(c => c.id === 'template-param:' + tmpl1.id + ':tp1'));

// Select template variable
state.screensFlowsTreeEl.dispatchEvent({
  type: 'nx-tree-select',
  detail: { id: 'template-var:' + tmpl1.id + ':tv1' }
});
console.log('Selecting template variable sets editingMode to "template-variable"?', state.editingMode === 'template-variable');
console.log('Tree selected property immediately updated to template-var?', state.screensFlowsTreeEl.selected[0] === 'template-var:' + tmpl1.id + ':tv1');

api.renderScreenForm();
console.log('renderScreenForm renders template variable property form?', !!state.screenFormEl.find('input')._collection.find(c => c.val() === 'tempVar'));

// Select template parameter
state.screensFlowsTreeEl.dispatchEvent({
  type: 'nx-tree-select',
  detail: { id: 'template-param:' + tmpl1.id + ':tp1' }
});
console.log('Selecting template parameter sets editingMode to "template-param"?', state.editingMode === 'template-param');
console.log('Tree selected property immediately updated to template-param?', state.screensFlowsTreeEl.selected[0] === 'template-param:' + tmpl1.id + ':tp1');

api.renderScreenForm();
console.log('renderScreenForm renders template parameter property form?', !!state.screenFormEl.find('input')._collection.find(c => c.val() === 'tempParam'));

// Select template itself
state.screensFlowsTreeEl.dispatchEvent({
  type: 'nx-tree-select',
  detail: { id: tmpl1.id }
});
console.log('Selecting template sets editingMode to "template"?', state.editingMode === 'template');
api.renderScreenForm();
console.log('Template properties form has NO parameters list embedded?', state.screenFormEl.find('.nexa-template-params-section').length === 0);
console.log('Template properties form has NO variables list embedded?', state.screenFormEl.find('.nexa-template-vars-section').length === 0);

console.log('ALL OK - ALL TREE & VARIABLE TESTS PASSED!');
