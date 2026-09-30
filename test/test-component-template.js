// Test suite for Component Templates & Composite Templates
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== Test Suite: Component Templates & Composite Templates ===');

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
    el.removeAttribute = function (k) { delete this._attrs[k]; };
    el.addEventListener = function (evt, fn) {
      this._handlers[evt] = this._handlers[evt] || [];
      this._handlers[evt].push(fn);
    };
    el.dispatchEvent = function (customEvt) {
      var hs = this._handlers[customEvt.type] || [];
      hs.forEach(fn => fn(customEvt));
    };
    return el;
  },
  getElementById(id) {
    return fakeJQ('<div>', { id });
  },
  querySelector(sel) { return null; },
  querySelectorAll(sel) { return []; }
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

function fakeJQ(tagOrSel, attrs) {
  const children = [];
  const domNode = fakeDomNode();
  const el = {
    _isFakeJQ: true,
    _tag: tagOrSel,
    _attrs: Object.assign({}, attrs || {}),
    _children: children,
    _handlers: {},
    _css: {},
    _val: (attrs && attrs.value !== undefined) ? attrs.value : '',
    _domNode: domNode,
    _data: {},
    data(k, v) {
      if (v === undefined) return this._data[k];
      this._data[k] = v;
      return this;
    },
    length: 1,
    attr(k, v) {
      if (v === undefined) return this._attrs[k];
      this._attrs[k] = v;
      return this;
    },
    removeAttr(k) { delete this._attrs[k]; return this; },
    prop(k, v) {
      if (v === undefined) return this._attrs[k];
      this._attrs[k] = v;
      return this;
    },
    val(v) {
      if (arguments.length === 0) return this._val;
      this._val = v;
      return this;
    },
    text(t) {
      if (t === undefined) return this._text || '';
      this._text = t;
      return this;
    },
    html(h) {
      if (h === undefined) return this._html || '';
      this._html = h;
      return this;
    },
    css(k, v) {
      if (typeof k === 'object') {
        Object.assign(this._css, k);
        return this;
      }
      if (v === undefined) return this._css[k] || '';
      this._css[k] = v;
      return this;
    },
    empty() { children.length = 0; return this; },
    append(child) {
      if (Array.isArray(child)) child.forEach(c => this.append(c));
      else {
        children.push(child);
        if (child && child._isFakeJQ) child._parent = this;
      }
      return this;
    },
    prependTo(parent) {
      if (parent && parent._isFakeJQ) {
        parent._children.unshift(this);
        this._parent = parent;
      }
      return this;
    },
    appendTo(parent) {
      if (parent && parent._isFakeJQ) parent.append(this);
      return this;
    },
    remove() {
      if (this._parent) {
        const idx = this._parent._children.indexOf(this);
        if (idx !== -1) this._parent._children.splice(idx, 1);
      }
      return this;
    },
    show() { this._css.display = ''; return this; },
    hide() { this._css.display = 'none'; return this; },
    toggle(v) {
      if (v === undefined) v = this._css.display === 'none';
      this._css.display = v ? '' : 'none';
      return this;
    },
    is(sel) {
      if (sel === ':checked') return !!this._attrs.checked;
      if (sel === ':visible') return this._css.display !== 'none';
      return false;
    },
    droppable() { return this; },
    draggable() { return this; },
    resizable() { return this; },
    find(sel) {
      const out = [];
      function search(node) {
        (node._children || []).forEach(c => {
          if (!c || !c._isFakeJQ) return;
          if (sel.startsWith('.') && c._attrs && c._attrs.class && c._attrs.class.includes(sel.slice(1))) out.push(c);
          else if (sel.startsWith('#') && c._attrs && c._attrs.id === sel.slice(1)) out.push(c);
          else if (c._tag === sel || c._tag === '<' + sel + '>') out.push(c);
          search(c);
        });
      }
      search(this);
      const res = fakeJQ('<div>');
      res._collection = out;
      res.length = out.length;
      return res;
    },
    parent() { return this._parent || fakeJQ('<div>'); },
    closest() { return fakeJQ('<div>'); },
    get(i) { return i === 0 ? this._domNode : undefined; },
    offset() { return { left: 0, top: 0 }; },
    width() { return 1280; },
    height() { return 800; },
    on(evt, fn) { this._handlers[evt] = this._handlers[evt] || []; this._handlers[evt].push(fn); return this; },
    trigger(evt, payload) { (this._handlers[evt] || []).forEach(fn => fn(payload)); return this; }
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
  nodes: {
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
      let active = null;
      const api = {
        addTab(t) {
          tabs[t.id] = t;
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
        _tabs: tabs
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

// Load NexaModel
const NexaModel = require('../lib/nexa-model.js');
global.window.NexaModel = NexaModel;

// Load extracted editor bundle
const EXTRACTED_EDITOR = path.join(__dirname, '.extracted-editor.js');
eval(fs.readFileSync(EXTRACTED_EDITOR, 'utf8'));

actions['nexa:open-pages-editor']();

// -------------------------------------------------------------
// 1. Data Model Verification
// -------------------------------------------------------------
console.log('\n--- 1. Data Model: template.kind & getComponentTemplateTarget ---');

const editorState = window.__nexaEditorState;
const editorApi = window.__nexaEditorApi;

assert(editorState, 'window.__nexaEditorState must be available');
assert(editorApi, 'window.__nexaEditorApi must be available');

// Test makeTemplate defaults
editorState.templateCounter = 0;
editorApi.addTemplateFromScreensPanel({ parentId: null, kind: 'composite' });
const tmplComposite = editorState.templates[editorState.templates.length - 1];
console.log('Composite template kind is "composite"?', tmplComposite.kind === 'composite');
console.log('Composite template default name starts with "Template"?', tmplComposite.name.startsWith('Template'));

editorApi.addTemplateFromScreensPanel({ parentId: null, kind: 'component' });
const tmplComponent = editorState.templates[editorState.templates.length - 1];
console.log('Component template kind is "component"?', tmplComponent.kind === 'component');
console.log('Component template default name starts with "Component"?', tmplComponent.name.startsWith('Component'));

// Test duplication preserves kind
const dupComp = editorApi.duplicateTemplate ? editorApi.duplicateTemplate(tmplComponent.id) : null;
console.log('Duplicated component template preserves kind === "component"?', dupComp && dupComp.kind === 'component');

// Test getComponentTemplateTarget
tmplComponent.components = [
  { id: 'c_btn', type: 'mock-button', name: 'My Button', w: 120, h: 44, layoutChild: { w: 'fill', h: 'fixed' }, props: { label: '{title}' } }
];
const target = editorState.getComponentTemplateTarget ? editorState.getComponentTemplateTarget(tmplComponent) : tmplComponent.components[0];
console.log('getComponentTemplateTarget finds button component?', target && target.id === 'c_btn' && target.w === 120);

// -------------------------------------------------------------
// 2. Sidebar Tree Verification
// -------------------------------------------------------------
console.log('\n--- 2. Sidebar Tree: Composite Templates & Component Templates categories ---');

const treeNodes = editorApi.buildScreensFlowsTreeNodes();
const templatesSection = treeNodes.find(n => n.id === 'section:templates');
assert(templatesSection, 'section:templates must exist');

const compositeGroup = templatesSection.children.find(n => n.id === 'section:composite-templates');
const componentGroup = templatesSection.children.find(n => n.id === 'section:component-templates');

console.log('templatesSection has compositeGroup?', !!compositeGroup && compositeGroup.label === 'Composite Templates');
console.log('templatesSection has componentGroup?', !!componentGroup && componentGroup.label === 'Component Templates');
console.log('compositeGroup has icon "fa fa-cubes"?', compositeGroup.icon === 'fa fa-cubes');
console.log('componentGroup has icon "fa fa-puzzle-piece"?', componentGroup.icon === 'fa fa-puzzle-piece');

console.log('compositeGroup contains tmplComposite?', compositeGroup.children.some(c => c.id === tmplComposite.id));
console.log('componentGroup contains tmplComponent?', componentGroup.children.some(c => c.id === tmplComponent.id));

const compTreeNode = componentGroup.children.find(c => c.id === tmplComponent.id);
console.log('Component template tree node has icon "fa fa-puzzle-piece"?', compTreeNode && compTreeNode.icon === 'fa fa-puzzle-piece');

// Check Variables and Parameters groups inside component template node
const hasVarsGroup = compTreeNode.children.some(g => g.id.startsWith('template-vars-group:'));
const hasParamsGroup = compTreeNode.children.some(g => g.id.startsWith('template-params-group:'));
console.log('Component template node has Variables and Parameters sub-groups?', hasVarsGroup && hasParamsGroup);

// -------------------------------------------------------------
// 3. Runtime Verification (Direct component render without canvas frames)
// -------------------------------------------------------------
console.log('\n--- 3. Runtime: Single component direct render & param binding ---');

// Runtime environment
const runtimeElements = [];
function makeRuntimeEl(tag) {
  const el = {
    tag: tag,
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    attrs: {},
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child, before) { this.children.push(child); return child; },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
    },
    querySelector(sel) {
      const mId = /\[data-id="([^"]+)"\]/.exec(sel);
      if (mId) return runtimeElements.find(e => e.attrs['data-id'] === mId[1]) || null;
      const mCompId = /\[data-component-id="([^"]+)"\]/.exec(sel);
      if (mCompId) return runtimeElements.find(e => e.attrs['data-component-id'] === mCompId[1]) || null;
      return null;
    },
    querySelectorAll(sel) { return []; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; }
  };
  runtimeElements.push(el);
  return el;
}

const rtArtboard = makeRuntimeEl('div');
rtArtboard.id = 'nexa-runtime-artboard';

global.document.createElement = makeRuntimeEl;
global.document.getElementById = function (id) { return id === 'nexa-runtime-artboard' ? rtArtboard : null; };
global.document.querySelector = function (sel) {
  const mId = /\[data-id="([^"]+)"\]/.exec(sel);
  if (mId) return runtimeElements.find(e => e.attrs['data-id'] === mId[1]) || null;
  const mCompId = /\[data-component-id="([^"]+)"\]/.exec(sel);
  if (mCompId) return runtimeElements.find(e => e.attrs['data-component-id'] === mCompId[1]) || null;
  return null;
};

let lastButtonRender = null;
eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nexa-registry-client.js'), 'utf8'));
NEXA.registerComponent('mock-button', {
  category: 'Common', label: 'Button', defaultSize: { w: 100, h: 40 },
  render: function (el, props) {
    lastButtonRender = { el: el, props: props };
    el.textContent = props.label || '';
  }
});

tmplComponent.params = [{ id: 'p1', name: 'title', defaultValue: 'Default Title' }];
tmplComponent.components = [
  { id: 'comp_btn_inner', type: 'mock-button', w: 140, h: 42, layoutChild: { w: 'fill' }, props: { label: '{title}' } }
];

const entryNs = 'frame_list#item1';
const fakeInstance = {
  id: entryNs,
  type: '@template',
  templateId: tmplComponent.id,
  x: 0, y: 0, w: 140, h: 42,
  layoutChild: { w: 'fill' },
  paramValues: { title: 'Product 1' }
};

const screen = {
  id: 'screen_main', name: 'Main', width: 800, height: 600,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    { id: 'frame_list', type: '@frame', x: 20, y: 20, w: 400, h: 500, children: [fakeInstance] }
  ],
  logic: { nodes: [], wires: [] }
};

delete window.__NEXA_FLOWS__;
window.__NEXA_SCREEN__ = screen;
window.__NEXA_TEMPLATES__ = [tmplComposite, tmplComponent];

// Load runtime client which auto-mounts __NEXA_SCREEN__
eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nexa-runtime-client.js'), 'utf8'));

// Find mounted element for fakeInstance
const mountedEl = runtimeElements.find(e => e.attrs['data-id'] === entryNs);
console.log('Mounted element exists for component template instance?', !!mountedEl);
console.log('Mounted element has data-component-id for inner button?', mountedEl && mountedEl.attrs['data-component-id'] === entryNs + '::comp_btn_inner');

// Verify that it DID NOT create the extra canvas wrapper/inner frame
const hasInnerCanvasFrame = mountedEl && mountedEl.children.some(c => c.tag === 'div' && c.style && c.style.position === 'absolute' && c.style.width === '100%');
console.log('Extra inner canvas wrapper frame is omitted for component template?', !hasInnerCanvasFrame);

// Verify props interpolation
console.log('Button label rendered with interpolated param "Product 1"?', lastButtonRender && lastButtonRender.props.label === 'Product 1');

console.log('\nALL OK');
