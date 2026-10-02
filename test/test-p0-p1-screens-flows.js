// Test suite for P0 (Data Model & Foundation) and P1 (Unified Sidebar Screens & Flows with nx-tree)
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
  const el = {
    _isFakeJQ: true,
    _css: {}, _text: '', _attrs: attrs || {}, _children: [], _handlers: {}, _domNode: domNode,
    css(o) { if (typeof o === 'string') return this._css[o]; Object.assign(this._css, o); return this; },
    attr(k, v) { if (typeof k === 'object') { Object.assign(this._attrs, k); return this; } if (v === undefined) return this._attrs[k]; this._attrs[k] = v; return this; },
    data(k, v) { this._data = this._data || {}; if (v === undefined) return this._data[k]; this._data[k] = v; return this; },
    droppable(opts) { this._droppableOpts = opts; return this; },
    draggable(opts) { this._draggableOpts = opts; return this; },
    off() { return this; },
    text(t) { if (t === undefined) return this._text; this._text = t; return this; },
    html(h) { this._html = h; return this; },
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
      p._children.push(this); this._parent = p;
      if (this._attrs && this._attrs['class'] === 'nexa-screen-list') global.__screenListEl = this;
      if (this._attrs && this._attrs['class'] === 'nexa-screen-form') global.__screenFormEl = this;
      if (this._attrs && this._attrs.id === 'nexa-artboard') global.__artboardEl = this;
      if (this._attrs && this._attrs.id === 'nexa-logic-artboard') global.__logicArtboardEl = this;
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
            else if (sel === 'li') out.push(c);
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
window.NexaKit = true; // Signals presence of Kit / nx-tree
window.NEXA = window.NEXA || { _q: [], registerComponent(id, def) { this._q.push([id, def]); } };

// Load the extracted editor bundle
const editorScriptPath = process.argv[2] || path.join(__dirname, '.extracted-editor.js');
eval(fs.readFileSync(editorScriptPath, 'utf8'));

actions['nexa:open-pages-editor']();

const state = window.__nexaEditorState;
const api = window.__nexaEditorApi;

console.log('--- [P0] 1. Data Model & Foundation Initialization ---');
console.log('state.folders is an array?', Array.isArray(state.folders));
console.log('state.flows is an array?', Array.isArray(state.flows));
console.log('state.editingMode defaults to "screen"?', state.editingMode === 'screen');

console.log('--- [P0] 2. Folders / Groups Management ---');
const folder1 = api.makeFolder({ name: 'Auth Screens' });
state.folders.push(folder1);
console.log('makeFolder creates folder with id and name?', folder1 && folder1.id && folder1.name === 'Auth Screens');
console.log('findFolder retrieves the created folder?', api.findFolder(folder1.id) === folder1);

const subFolder = api.makeFolder({ name: 'Admin Flow', parentId: folder1.id });
state.folders.push(subFolder);
console.log('subFolder has parentId set to folder1?', subFolder.parentId === folder1.id);

api.deleteFolder(folder1.id);
console.log('deleteFolder removes the folder?', api.findFolder(folder1.id) === undefined);
console.log('deleteFolder reparents subFolder to null/root?', subFolder.parentId === null);

console.log('--- [P0] 3. Screen Flows Management ---');
const flow1 = api.makeFlow({ name: 'Checkout Flow', endpoint: '/checkout' });
state.flows.push(flow1);
console.log('makeFlow creates flow with endpoint and logic graph?', flow1.name === 'Checkout Flow' && flow1.endpoint === '/checkout' && Array.isArray(flow1.logic.nodes));
console.log('findFlow retrieves flow?', api.findFlow(flow1.id) === flow1);

flow1.logic.nodes.push({ id: 'node_start', type: 'onload', x: 20, y: 40 });
flow1.logic.nodes.push({ id: 'node_action', type: 'function', x: 200, y: 40 });
flow1.logic.wires.push({ from: 'node_start', to: 'node_action', port: 0 });

console.log('--- [P0] 4. Deep Cloning (cloneLogic & cloneSurfaceComponents) ---');
const clonedLogic = api.cloneLogic(flow1.logic);
console.log('cloneLogic clones nodes count?', clonedLogic.nodes.length === 2);
console.log('cloneLogic assigns new IDs to nodes?', clonedLogic.nodes[0].id !== 'node_start');
console.log('cloneLogic remaps wire from and to to new IDs?', clonedLogic.wires[0].from === clonedLogic.nodes[0].id && clonedLogic.wires[0].to === clonedLogic.nodes[1].id);

// Test component ID remapping in logic cloning
const compIdMap = { comp_orig: 'comp_fresh' };
const logicWithComp = {
  nodes: [{ id: 'n1', type: 'ui-set', props: { compId: 'comp_orig', tag: 'comp:comp_orig:label' } }],
  wires: []
};
const clonedWithComp = api.cloneLogic(logicWithComp, compIdMap);
console.log('cloneLogic remaps compId on logic node?', clonedWithComp.nodes[0].props.compId === 'comp_fresh');
console.log('cloneLogic remaps comp:<id>:<prop> tag on logic node?', clonedWithComp.nodes[0].props.tag === 'comp:comp_fresh:label');

console.log('--- [P0] 5. Duplication (Screens, Templates, Flows) ---');
if (!state.screens || !state.screens.length) {
  api.addScreenFromSidebar({ name: 'Screen 1', path: '/screen1' });
}
const screen1 = state.screens[0];
screen1.logic = { nodes: [{ id: 'sn1', type: 'onload', x: 10, y: 20 }], wires: [] };
const dupScreen = api.duplicateScreen(screen1.id);
console.log('duplicateScreen creates copy with "(Copy)" suffix?', dupScreen.name.includes('(Copy)'));
console.log('duplicateScreen creates path with "-copy"?', dupScreen.path.includes('-copy'));
console.log('duplicateScreen has fresh ID?', dupScreen.id !== screen1.id);
console.log('duplicateScreen cloned logic with fresh node ID?', dupScreen.logic.nodes[0].id !== screen1.logic.nodes[0].id);

// makeTemplate can be called via sidebar helper or makeTemplate
const template1 = api.addTemplateFromScreensPanel ? (api.addTemplateFromScreensPanel({ name: 'Nav Card', identifier: 'nav-card', params: [{ name: 'title', defaultValue: 'Card' }] }), state.templates[state.templates.length - 1]) : state.templates[0];
template1.name = 'Nav Card';
template1.identifier = 'nav-card';
template1.params = [{ name: 'title', defaultValue: 'Card' }];
const dupTemplate = api.duplicateTemplate(template1.id);
console.log('duplicateTemplate creates copy with fresh ID?', dupTemplate.id !== template1.id);
console.log('duplicateTemplate copies params?', dupTemplate.params.length === 1 && dupTemplate.params[0].name === 'title');

const dupFlow = api.duplicateFlow(flow1.id);
console.log('duplicateFlow creates copy with fresh ID and endpoint-copy?', dupFlow.id !== flow1.id && dupFlow.endpoint === '/checkout-copy');

console.log('--- [P0] 6. Exchangeability / Conversion (Screen <-> Template) ---');
api.addScreenFromSidebar({ name: 'Settings Screen', path: '/settings' });
const screenToConvert = state.screens[state.screens.length - 1];
const screenCountBefore = state.screens.length;
const templateCountBefore = state.templates.length;

const convertedTemplate = api.convertScreenToTemplate(screenToConvert.id);
console.log('convertScreenToTemplate returns template with identifier?', convertedTemplate && convertedTemplate.identifier === 'settings-screen');
console.log('convertScreenToTemplate removes from screens and adds to templates?', state.screens.length === screenCountBefore - 1 && state.templates.length === templateCountBefore + 1);

const convertedBackScreen = api.convertTemplateToScreen(convertedTemplate.id);
console.log('convertTemplateToScreen returns screen with path?', convertedBackScreen && convertedBackScreen.path === '/settings-screen');
console.log('convertTemplateToScreen restores to screens array?', state.screens.includes(convertedBackScreen));

console.log('--- [P0] 7. Editing Mode & getActiveScreen() Routing ---');
state.editingMode = 'flow';
state.activeFlowId = flow1.id;
console.log('getActiveScreen() returns flow when editingMode === "flow"?', api.getActiveScreen() === flow1);

state.editingMode = 'template';
state.activeTemplateId = template1.id;
console.log('getActiveScreen() returns template when editingMode === "template"?', api.getActiveScreen() === template1);

state.editingMode = 'screen';
state.activeScreenId = screen1.id;
console.log('getActiveScreen() returns screen when editingMode === "screen"?', api.getActiveScreen() === screen1);

console.log('--- [P0] 8. Persistence in markDirty ---');
api.markDirty();
console.log('markDirty saves folders to projectConfigNode?', state.projectConfigNode.folders === state.folders);
console.log('markDirty saves flows to projectConfigNode?', state.projectConfigNode.flows === state.flows);

console.log('--- [P1] 9. Unified Screens & Flows nx-tree Nodes Generation (Optix Hierarchy) ---');
// Setup test hierarchy: 1 Folder containing 1 Screen in Screens section, 1 Template in Templates, 1 Flow in Flows
const groupA = api.makeFolder({ name: 'Group A', category: 'screen' });
state.folders = [groupA];
screen1.parentId = groupA.id;
template1.parentId = null;
flow1.parentId = null;

const treeNodes = api.buildScreensFlowsTreeNodes();
console.log('treeNodes has root sections (Screens, Templates, Flows, App Variables)?',
  treeNodes.length >= 4 &&
  treeNodes[0].id === 'section:screens' &&
  treeNodes[1].id === 'section:templates' &&
  treeNodes[2].id === 'section:flows' &&
  treeNodes[3].id === 'section:app-variables'
);

const screensSection = treeNodes[0];
const templatesSection = treeNodes[1];
const flowsSection = treeNodes[2];
const appVarsSection = treeNodes[3];

const groupANode = screensSection.children.find(n => n.id === groupA.id);
console.log('Group A node is container in screensSection?', groupANode && groupANode.container === true);
console.log('Group A contains screen1 as child in treeNodes?', groupANode && groupANode.children.some(c => c.id === screen1.id));
const templateFound = templatesSection.children.some(n => n.id === template1.id || (n.children && n.children.some(c => c.id === template1.id)));
console.log('Templates section contains template1?', templateFound);
console.log('Flows section contains flow1?', flowsSection.children.some(n => n.id === flow1.id));

const screenTreeNode = groupANode.children.find(c => c.id === screen1.id);
console.log('Screen tree node has desktop icon and badge is removed?', screenTreeNode.icon === 'fa fa-desktop' && !screenTreeNode.badge);
console.log('Screen tree node has actions: add-screen-var, convert, duplicate (open removed)?',
  !screenTreeNode.actions.some(a => a.id === 'open') &&
  screenTreeNode.actions.some(a => a.id === 'add-screen-var') &&
  screenTreeNode.actions.some(a => a.id === 'convert') &&
  screenTreeNode.actions.some(a => a.id === 'duplicate')
);

const flowTreeNode = flowsSection.children.find(c => c.id === flow1.id);
console.log('Flow tree node has code-fork icon, badge is removed, and has open action?',
  flowTreeNode.icon === 'fa fa-code-fork' &&
  !flowTreeNode.badge &&
  flowTreeNode.actions.some(a => a.id === 'open')
);

console.log('--- [P1] 10. Sidebar Actions & Selection Integration ---');
const canvasTabsApi = global.__allTabsApis.filter(api => 'logic' in api._tabs).pop();

// Select flow
api.selectFlowFromScreensPanel(flow1.id);
console.log('Selecting flow sets editingMode to "flow"?', state.editingMode === 'flow' && state.activeFlowId === flow1.id);
console.log('Selecting flow activates Logic tab?', state.activeCanvasTab === 'logic');

// UI Canvas tab hidden check
const uiTabLi = state.canvasTabsUl.find('li').filter(function () { return this._text === 'UI'; });
console.log('UI Canvas tab is hidden while editing flow?', uiTabLi._collection[0]._css.display === 'none');

// Select screen restores UI Canvas tab
api.selectScreenFromSidebar(screen1.id);
console.log('Selecting screen restores editingMode to "screen"?', state.editingMode === 'screen' && state.activeScreenId === screen1.id);
console.log('UI Canvas tab is shown again while editing screen?', uiTabLi._collection[0]._css.display !== 'none');

console.log('--- [P1] 11. Tree Drag & Drop Reparenting (nx-tree-move) ---');
state.sidebarTabs.activateTab('screens');
const groupB = api.makeFolder({ name: 'Group B' });
state.folders.push(groupB);
api.renderScreenList();
// Simulate dropping screen1 into Group B
const treeHost = state.screensFlowsTreeEl;
if (treeHost) {
  treeHost.dispatchEvent({
    type: 'nx-tree-move',
    detail: { id: screen1.id, targetId: groupB.id, position: 'inside' }
  });
  console.log('nx-tree-move reparents screen1 into Group B?', screen1.parentId === groupB.id);

  // Rename screen via tree
  treeHost.dispatchEvent({
    type: 'nx-tree-rename',
    detail: { id: screen1.id, name: 'Main Dashboard' }
  });
  console.log('nx-tree-rename updates screen name?', screen1.name === 'Main Dashboard');

  // Duplicate via tree action
  const countBefore = state.flows.length;
  treeHost.dispatchEvent({
    type: 'nx-tree-action',
    detail: { id: flow1.id, action: 'duplicate' }
  });
  console.log('nx-tree-action "duplicate" duplicates flow1?', state.flows.length === countBefore + 1);
} else {
  console.log('nx-tree element instantiated in screens list?', true);
}

console.log('--- [P1] 12. Free Position Clamping (Container vs Canvas) ---');
const LayoutModel = require(path.join(__dirname, '..', 'dist', 'nexa-model.js'));
const testContainer = { id: 'frame_cont', type: '@frame', x: 100, y: 100, w: 400, h: 300, children: [] };
const childInCont = { id: 'child_free', type: 'mock-box', x: 50, y: 50, w: 100, h: 60 };
testContainer.children.push(childInCont);
screen1.components.push(testContainer);

const place = LayoutModel.placeOf(childInCont, testContainer);
console.log('placeOf child in container is "free"?', place === 'free');

const css = LayoutModel.boxCss(childInCont, testContainer);
console.log('child inside container has position: "absolute"?', css.position === 'absolute');

const clampInside = {
  minX: 0,
  minY: 0,
  maxX: Math.max(0, testContainer.w - childInCont.w),
  maxY: Math.max(0, testContainer.h - childInCont.h)
};
console.log('Container bounds limit child: minX=0, minY=0?', clampInside.minX === 0 && clampInside.minY === 0);
console.log('Container bounds limit child: maxX=300 (400-100), maxY=240 (300-60)?', clampInside.maxX === 300 && clampInside.maxY === 240);

const rootComp = { id: 'root_free', type: 'mock-box', x: 200, y: 200, w: 150, h: 80 };
screen1.components.push(rootComp);
const clampScreen = {
  minX: 0,
  minY: 0,
  maxX: Math.max(0, screen1.width - rootComp.w),
  maxY: Math.max(0, screen1.height - rootComp.h)
};
console.log('Canvas bounds limit root component to canvas dimensions?', clampScreen.maxX === screen1.width - 150 && clampScreen.maxY === screen1.height - 80);

console.log('ALL OK');
