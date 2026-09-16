// Verifies Reusable Screen Templates from the EDITOR side, driven through
// real UI interactions (same jQuery-shim harness style as mock-logic.js) —
// the deep nested-param RESOLUTION logic is already thoroughly covered by
// mock-templates-runtime.js against the data model directly; this file
// proves the WIRING actually works when a user drives it: the Templates
// tab's create/edit flow, dropping a plain component and a nested template
// instance while editing a template, the palette's cycle guard rejecting a
// template that would close a loop, and the Properties panel correctly
// labeling a selected instance.

const docListeners = {};
// documentElement.style stub: @codemirror/view's browser-environment
// detection (bundled into the editor script now) runs at module-load time
// and reads doc.documentElement.style unconditionally whenever `document`
// is defined at all (its own SSR fallback only kicks in if `document` is
// fully undefined).
global.document = {
  documentElement: { style: {} },
  addEventListener(evt, fn) { (docListeners[evt] = docListeners[evt] || []).push(fn); },
  removeEventListener(evt, fn) { if (docListeners[evt]) docListeners[evt] = docListeners[evt].filter(f => f !== fn); },
  createElementNS(ns, tag) { return fakeJQ('<' + tag + '>'); }
};
function fireDoc(evt, payload) { (docListeners[evt] || []).slice().forEach(fn => fn(payload)); }

function fakeDomNode() {
  const listeners = {};
  return {
    tagName: 'DIV',
    // renderTemplateInstance() (component-renderer.js) does
    // window.$("<div>").appendTo(el.get(0)) — real jQuery's .appendTo()
    // happily accepts a plain DOM node as its target, so this needs to be
    // a valid append target too, not just an event-listener holder.
    _children: [],
    addEventListener(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    removeEventListener(evt, fn) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn); },
    _fire(evt, payload) { (listeners[evt] || []).slice().forEach(fn => fn(payload)); }
  };
}

const draggables = [];
const componentsById = {};
let documentJQ = null;
let titledEls = [];

function fakeJQ(selOrHtml, attrs) {
  const domNode = fakeDomNode();
  const el = {
    _isFakeJQ: true, _tag: selOrHtml,
    _css: {}, _text: '', _attrs: attrs || {}, _children: [], _handlers: {}, _domNode: domNode,
    css(o, v) { if (typeof o === 'string') { if (v === undefined) return this._css[o]; this._css[o] = v; return this; } Object.assign(this._css, o); return this; },
    attr(k, v) { if (typeof k === 'object') { Object.assign(this._attrs, k); return this; } if (v === undefined) return this._attrs[k]; this._attrs[k] = v; return this; },
    data(k, v) { this._data = this._data || {}; if (v === undefined) return this._data[k]; this._data[k] = v; return this; },
    droppable(opts) { this._droppableOpts = opts; return this; },
    text(t) {
      if (t === undefined) return this._text;
      this._text = t;
      if (t === '+ Add Screen') global.__addScreenBtn = this;
      if (t === '+ Add Template') global.__addTemplateBtn = this;
      if (t === '← Back to Screens') global.__backToScreensLink = this;
      if (typeof t === 'string' && t.indexOf('Template instance:') === 0) global.__lastTemplateInstanceLabel = t;
      if (t === 'Lit Component') global.__lastLitComponentHeader = this;
      if (t === '+ Add Bindable Property') global.__addLitBindableBtn = this;
      if (t === '+ Add Event') global.__addLitEventBtn = this;
      if (t === 'Edit Code...') global.__editLitCodeBtn = this;
      if (t === 'JavaScript') global.__litJsTabBtn = this;
      if (t === 'CSS') global.__litCssTabBtn = this;
      return this;
    },
    html(h) {
      if (h === undefined) return this._html;
      this._html = h;
      return this;
    },
    append(c) { this._children.push(c); return this; },
    appendTo(p) {
      p._children.push(this); this._parent = p;
      // A real <select> reports its FIRST <option>'s value once one exists,
      // even with no explicit .val()/user interaction — mirror that here or
      // reading a freshly-built <select>'s .val() (e.g. the params editor's
      // type dropdown) would return undefined instead of the real default.
      if (this._tag === '<option>' && p._tag === '<select>' && p._val === undefined) {
        p._val = this._attrs && this._attrs.value;
      }
      if (this._attrs && this._attrs['data-id']) componentsById[this._attrs['data-id']] = this;
      if (this._attrs && this._attrs.title) titledEls.push({ title: this._attrs.title, el: this });
      if (this._attrs && this._attrs['class'] === 'nexa-screen-list') global.__screenListEl = this;
      if (this._attrs && this._attrs['class'] === 'nexa-template-list') global.__templateListEl = this;
      if (this._attrs && this._attrs['class'] === 'nexa-template-form') global.__templateFormEl = this;
      if (this._attrs && this._attrs['class'] === 'nexa-template-row') (global.__templateRows = global.__templateRows || []).push(this);
      // Landmark for the UI canvas (real code gives it id="nexa-artboard")
      // — needed so tests can reach its .droppable() drop handler, which is
      // where drag-drop placement now actually happens (moved out of the
      // palette chip's own draggable "stop").
      if (this._attrs && this._attrs.id === 'nexa-artboard') global.__artboardEl = this;
      if (this._attrs && this._attrs.id === 'nexa-lit-js-editor') global.__litJsEditorMount = this;
      if (this._attrs && this._attrs.id === 'nexa-lit-css-editor') global.__litCssEditorMount = this;
      if (this._attrs && this._attrs.id === 'nexa-logic-function-editor-mount') global.__functionEditorMount = this;
      if (this._attrs && this._attrs['class'] === 'red-ui-editableList-addButton' && global.__lastLitComponentHeader) {
        if (!global.__addLitBindableBtn) global.__addLitBindableBtn = this;
        else if (!global.__addLitEventBtn) global.__addLitEventBtn = this;
      }
      if (this._attrs && (this._attrs.placeholder === 'name' || this._attrs.placeholder === 'propName') && this._attrs.type === 'text') {
        (global.__litBindableRows = global.__litBindableRows || []).push(p);
      }
      // properties-panel.js's per-param field rows are the only fields
      // labeled "<Label> {name}" — generic enough to grab the input by that
      // exact label text without needing a dedicated class hook.
      if (this._attrs && this._attrs.type && p._children.length >= 1) {
        var firstSibling = p._children[0];
        var isParamLabel = function (el) { return el && typeof el._text === 'string' && /\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(el._text); };
        // Some param-field layouts wrap the actual value widget in an extra
        // container div, so the input's immediate parent's own first child
        // is no longer the label — walk up one more level (the wrapper's
        // parent, i.e. the field row) when that's the case.
        if (!isParamLabel(firstSibling) && p._parent && p._parent._children && p._parent._children.length) {
          firstSibling = p._parent._children[0];
        }
        if (isParamLabel(firstSibling)) {
          (global.__paramFieldsByLabel = global.__paramFieldsByLabel || {})[firstSibling._text] = this;
        }
      }
      return this;
    },
    prependTo(p) {
      p._children.unshift(this); this._parent = p;
      return this;
    },
    parent() { return { length: this._parent ? 1 : 0 }; },
    empty() { this._children = []; return this; },
    remove() { if (this._parent) this._parent._children = this._parent._children.filter(c => c !== this); return this; },
    val(v) { if (v === undefined) return this._val; this._val = v; return this; },
    prop(name, v) { if (v === undefined) return this._props && this._props[name]; this._props = this._props || {}; this._props[name] = v; return this; },
    is(sel) {
      if (sel === ':checked') return !!(this._props && this._props.checked);
      if (sel === ':visible') {
        var node = this;
        while (node) { if (node._css.display === 'none') return false; node = node._parent; }
        return true;
      }
      return false;
    },
    toggle(show) { this._css.display = (show === undefined ? this._css.display === 'none' : show) ? '' : 'none'; return this; },
    hide() { this._css.display = 'none'; return this; },
    show() { this._css.display = ''; return this; },
    find(sel) {
      if (sel && sel[0] === '.' && sel.indexOf('[') === -1) {
        var cls = sel.slice(1);
        var m = (this._children || []).filter(c => c._attrs && c._attrs['class'] === cls);
        var coll = fakeJQ(); coll._collection = m;
        coll.css = function (o, v) { m.forEach(x => { if (typeof o === 'string') { x._css[o] = v; } else { Object.assign(x._css, o); } }); return this; };
        coll.remove = function () { m.forEach(x => { if (x._parent) x._parent._children = x._parent._children.filter(c => c !== x); }); return this; };
        return coll;
      }
      if (sel && sel.indexOf('data-id') !== -1) { const id = sel.match(/"([^"]+)"/)[1]; return componentsById[id] || fakeJQ(); }
      return fakeJQ();
    },
    closest() { return fakeJQ(); },
    on(evt, fn) {
      (evt || '').split(/\s+/).filter(Boolean).forEach(e => {
        (this._handlers[e] = this._handlers[e] || []).push(fn);
      });
      return this;
    },
    off() { return this; },
    get() { return this._domNode; },
    offset() { return { left: 0, top: 0 }; },
    position() { return { left: 0, top: 0 }; },
    width() { return 800; }, height() { return 600; },
    get clientWidth() { return 800; }, get clientHeight() { return 600; },
    draggable(opts) { this._draggableOpts = opts; draggables.push({ el: this, opts }); return this; },
    typedInput(optOrMethod, arg) {
      if (typeof optOrMethod === 'string') {
        if (optOrMethod === 'type') {
          if (arg === undefined) return this._typedInputType || (this._typedInputOpts && this._typedInputOpts.default) || (this._typedInputTypes && this._typedInputTypes[0]) || 'str';
          this._typedInputType = arg;
          return this;
        }
        if (optOrMethod === 'value') {
          if (arg === undefined) return this._typedInputValue !== undefined ? this._typedInputValue : (this._val !== undefined ? this._val : '');
          this._typedInputValue = arg;
          this._val = arg;
          return this;
        }
        if (optOrMethod === 'types') {
          this._typedInputTypes = arg;
          return this;
        }
      } else if (typeof optOrMethod === 'object') {
        this._typedInputOpts = optOrMethod;
        this._typedInputTypes = optOrMethod.types;
        if (optOrMethod.default) this._typedInputType = optOrMethod.default;
        else if (Array.isArray(optOrMethod.types) && optOrMethod.types.length) {
          var first = optOrMethod.types[0];
          this._typedInputType = typeof first === 'string' ? first : (first && first.value);
        }
        return this;
      }
      return this;
    },
    get length() { return 1; }

  };
  domNode.clientWidth = 800; domNode.clientHeight = 600;
  domNode.scrollLeft = 0; domNode.scrollTop = 0;
  return el;
}
global.$ = function (sel, attrs) {
  if (sel === global.document) { if (!documentJQ) documentJQ = fakeJQ(); return documentJQ; }
  if (sel && sel._isFakeJQ) return sel;
  return fakeJQ(sel, attrs);
};
$.fn = {};
$.ajax = function () { return { done(fn) { fn({ value: 1 }); return this; }, fail(fn) { return this; } }; };

function mousedownOn(id, opts) {
  var el = componentsById[id];
  var handlers = el._handlers['mousedown'] || [];
  var evt = Object.assign({ stopPropagation() {}, shiftKey: false }, opts);
  handlers.forEach(fn => fn(evt));
}

let actions = {}, configNodes = [], idCounter = 0, notifications = [], traySpec = null;
global.RED = {
  plugins: { registerPlugin(id, def) { if (def.onadd) def.onadd(); } },
  actions: { add(id, fn) { actions[id] = fn; }, invoke(id) { actions[id](); } },
  menu: { addItem() {} },
  comms: { subscribe() {} },
  notify(msg, opts) { notifications.push(msg); },
  events: { on() {}, emit() {} },
  log: { info() {}, warn() {} },
  nodes: {
    dirty() {},
    eachConfig(fn) { configNodes.forEach(fn); },
    getType(type) { return type === 'kufayeka-nexa-project' ? { defaults: { name: { value: 'Nexa Project' }, screens: { value: [] }, templates: { value: [] } } } : null; },
    id() { return 'cfg' + (++idCounter); },
    add(node) { configNodes.push(node); }
  },
  sidebar: { addTab() {} },
  tray: {
    show(opts) { traySpec = opts; const tr = fakeJQ(); opts.open(tr); if (opts.show) opts.show(); },
    close() { if (traySpec && traySpec.close) traySpec.close(); }
  },
  // A minimal stand-in for RED.editor.createEditor (real ace/monaco) —
  // just enough to test that a dialog (lit-code-dialog.js) reads back
  // whatever "was typed" via .getValue() when Done is clicked. Every
  // created instance is pushed to global.__createdEditors so a test can
  // reach in and simulate typing via .setTestValue(...) before clicking
  // the tray's Done button.
  editor: {
    createEditor(opts) {
      var val = opts.value || '';
      var instance = {
        getValue() { return val; },
        setTestValue(v) { val = v; },
        destroyed: false,
        // Real bug this is here to catch: lit-code-dialog.js used to keep
        // TWO of these (JS + CSS) alive simultaneously, which is a
        // documented class of real ace/monaco bug (unscoped keybindings
        // cross-talking between live instances, and a focus-steal between
        // an editor and a sibling element recursing forever inside the
        // editor's own event dispatcher) that could hang the whole browser
        // tab on a keyboard paste. `destroyed` lets a test assert "at most
        // one alive at any moment" directly, not just "eventually cleaned up".
        destroy() { this.destroyed = true; }
      };
      (global.__createdEditors = global.__createdEditors || []).push(instance);
      return instance;
    }
  },
  tabs: {
    create(opts) {
      const tabs = {}; let active = null;
      const api = {
        addTab(t) { tabs[t.id] = t; if (!active) { active = t.id; if (opts.onchange) opts.onchange(t); } },
        activateTab(id) { active = id; if (opts.onchange) opts.onchange(tabs[id]); },
        renameTab(id, l) { if (tabs[id]) tabs[id].label = l; },
        _tabs: tabs
      };
      (global.__allTabsApis = global.__allTabsApis || []).push(api);
      return api;
    }
  }
};

global.window = global;

// A minimal stand-in for the real CM6 wrapper (src/editor/cm6-code-editor.js)
// — CM6 needs a real DOM (layout, ResizeObserver, selection APIs) and can't
// run against this hand-rolled fake-jQuery harness, so cm6-code-editor.js
// exposes exactly this override seam for tests. Every created instance is
// pushed to global.__createdEditors so a test can reach in and simulate
// typing via .setTestValue(...) before clicking the tray's Done button —
// same shape/spirit as the old real-Monaco-mock this replaces.
window.__kufayekaCreateCM6EditorOverride = function (opts) {
  var val = opts.value || '';
  var instance = {
    getValue() { return val; },
    setValue(v) { val = v; },
    setTestValue(v) { val = v; },
    focus() { },
    resize() { },
    destroyed: false,
    destroy() { this.destroyed = true; }
  };
  (global.__createdEditors = global.__createdEditors || []).push(instance);
  return instance;
};

window.NEXA = window.NEXA || { _q: [], registerComponent: function (id, def) { this._q.push([id, def]); } };
NEXA.registerComponent('mock-rect', {
  category: 'Basic', label: 'Rectangle', defaultSize: { w: 120, h: 80 },
  capabilities: { resizable: true, rotatable: true, flippable: true, lockable: true },
  defaults: { fill: { value: '#abc', type: 'color' } },
  bindable: ['props.fill'],
  events: [{ name: 'click', label: 'Clicked' }],
  render: function () {}
});

const fs = require('fs');
eval(fs.readFileSync(process.argv[2], 'utf8'));

// Palette chips no longer set their own _text (the label lives on a nested
// .red-ui-palette-label child, avoiding the duplicate-text overlap bug real
// jQuery's .text() as a GETTER would mask by concatenating descendant text
// nodes) — so label lookups must walk _children the same way, instead of
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

function dropChipByLabel(label, x, y) {
  const list = draggables.filter(d => chipText(d.el) === label && d.el._attrs['class'] === 'nexa-palette-item');
  const chip = list[list.length - 1];
  if (!chip) throw new Error('no palette chip found for label: ' + label);
  // Placement now happens in the artboard's own .droppable() "drop" handler
  // (editor-tray.js), not the palette chip's draggable "stop" — simulate a
  // real drop by calling that handler directly with the chip as ui.draggable.
  chip.opts.stop(null, { offset: { left: x, top: y } });
  global.__artboardEl._droppableOpts.drop({ pageX: x, pageY: y }, { draggable: chip.el });
}
// `draggables` accumulates EVERY chip ever created across every buildPalette()
// call in this whole test (nothing is ever cleared from it) — checking
// EXISTENCE anywhere in that history would make a template look "still
// offered" forever after its first appearance, even once a later rebuild
// correctly excludes it (the cycle guard only affects what gets pushed by
// the NEXT rebuild, not what's already in the array from a previous one).
// Force a fresh rebuild and only look at what THAT rebuild actually added.
function paletteLabelsAfterFreshBuild() {
  const before = draggables.length;
  // Navigate away via "properties" (not "screens" — that tab now
  // deliberately EXITS template-editing mode when activated, since its form
  // is screen-shaped, which would defeat the point of checking the palette
  // WHILE a specific template is still being edited) so the next line is a
  // genuine rebuild, not a no-op.
  sidebarTabsApi.activateTab('properties');
  sidebarTabsApi.activateTab('components');
  return draggables.slice(before).map(d => chipText(d.el));
}
// renderTemplateForm()'s row() helper builds <div>[<label>text, <input>] —
// the input is always the row's LAST child (only 2 children ever appended).
function findFormInput(containerEl, labelText) {
  var row = (containerEl._children || []).find(r => (r._children || []).some(c => c._text === labelText));
  if (!row) throw new Error('form row not found for label: ' + labelText);
  return row._children[row._children.length - 1];
}
function changeInput(input, value) {
  if (input && (input._typedInputOpts || input._typedInputType)) {
    input.typedInput('value', value);
  } else if (input) {
    input.val(value);
  }
  if (input) (input._handlers.change || []).forEach(fn => fn());
}
function clickTemplateRowLink(templateName, title) {
  // renderTemplateList() rebuilds every row from scratch on each call and
  // never removes stale ones from global.__templateRows (the harness's
  // appendTo hook only ever pushes) — always take the LAST matching row,
  // same "most recent wins" pattern used throughout this suite for chips.
  var rows = (global.__templateRows || []).filter(r => (r._children || []).some(c => c._text === templateName));
  var row = rows[rows.length - 1];
  if (!row) throw new Error('template row not found: ' + templateName);
  var link = row._children.find(c => c._attrs && c._attrs.title === title);
  if (!link) throw new Error('link "' + title + '" not found on template row: ' + templateName);
  link._handlers.click[0]({ preventDefault() {}, stopPropagation() {} });
}

actions['nexa:open-pages-editor']();
const screen1 = configNodes[0].screens[0];
const sidebarTabsApi = global.__allTabsApis.filter(api => 'templates' in api._tabs).pop();
const canvasTabsApi = global.__allTabsApis.filter(api => 'logic' in api._tabs).pop();

console.log('--- create Template "Card": settings form mirrors Screens\' (Identifier instead of URL path, Width/Height editable) ---');
sidebarTabsApi.activateTab('templates');
global.__addTemplateBtn._handlers.click[0]();
console.log('one template created?', configNodes[0].templates.length === 1);
const cardTemplate = configNodes[0].templates[0];
console.log('editing the new template opened the tray onto it (UI tab active)?', canvasTabsApi._tabs.ui !== undefined);

changeInput(findFormInput(global.__templateFormEl, 'Name'), 'Monitor Card');
console.log('Name field writes template.name?', cardTemplate.name === 'Monitor Card');
changeInput(findFormInput(global.__templateFormEl, 'Identifier'), 'monitor-card');
console.log('Identifier field (replacing URL path) writes template.identifier?', cardTemplate.identifier === 'monitor-card');
changeInput(findFormInput(global.__templateFormEl, 'Width (px)'), '300');
changeInput(findFormInput(global.__templateFormEl, 'Height (px)'), '150');
console.log('Width/Height are actually editable (the "aku perlu resize" ask)?', cardTemplate.width === 300 && cardTemplate.height === 150);

console.log('--- Parameters editor: boxed editableList with TypedInput (auto-determined type) ---');
const paramsSection = global.__templateFormEl.find('.nexa-template-params-section')._collection[0];
const addParamBtn = paramsSection._children.find(c => c._attrs && c._attrs['class'] === 'red-ui-editableList-addButton');
addParamBtn._handlers.click[0]({ preventDefault() {} });

const paramOl = paramsSection._children.find(c => c._tag === '<ol>');
const firstItem = paramOl._children[0];
const rowDiv = firstItem._children[0]._children[0];
const nameRow = rowDiv._children[0], labelRow = rowDiv._children[1], valRow = rowDiv._children[2];
const nameInput = nameRow._children[1], labelInput = labelRow._children[1];
changeInput(nameInput, 'value');
changeInput(labelInput, 'Value');
console.log('one param declared with the right name/label/default type ("string")?', cardTemplate.params.length === 1 && cardTemplate.params[0].name === 'value' && cardTemplate.params[0].label === 'Value' && cardTemplate.params[0].type === 'string');

console.log('--- typed params: typedInput auto-determines type and parses value (e.g. json -> object) ---');
addParamBtn._handlers.click[0]({ preventDefault() {} });
const secondItem = paramOl._children[1];
const rowDiv2 = secondItem._children[0]._children[0];
const nameRow2 = rowDiv2._children[0], valRow2 = rowDiv2._children[2];
const nameInput2 = nameRow2._children[1];
const objectWidget = valRow2._children[1]._children[0];
console.log('default input is configured with typedInput?', !!objectWidget && typeof objectWidget.typedInput === 'function');
objectWidget.typedInput('type', 'json');
objectWidget.typedInput('value', '{"rpm": 1500}');
if (objectWidget._handlers.change) objectWidget._handlers.change.forEach(fn => fn());
changeInput(nameInput2, 'info');

const infoParam = cardTemplate.params.find(p => p.name === 'info');
console.log('an "object"-typed param stores the REAL parsed object as defaultValue, not a JSON string?', !!infoParam && typeof infoParam.defaultValue === 'object' && infoParam.defaultValue.rpm === 1500 && infoParam.type === 'object');

canvasTabsApi.activateTab('ui');
dropChipByLabel('Rectangle', 50, 50);
console.log('the rectangle landed on the TEMPLATE, not a screen?', cardTemplate.components.length === 1 && screen1.components.length === 0);

console.log('--- back to Screens (via the tray\'s own bar, not a sidebar tab), drop a "Card" instance onto screen1 ---');
console.log('the "Back to Screens" bar link exists while editing a template?', !!global.__backToScreensLink);
global.__backToScreensLink._handlers.click[0]({ preventDefault() {} });
sidebarTabsApi.activateTab('components');
dropChipByLabel(cardTemplate.name, 100, 100);
console.log('a "@template" instance landed on screen1, sized to the template?', screen1.components.length === 1 && screen1.components[0].type === '@template' && screen1.components[0].w === cardTemplate.width);
const instanceId = screen1.components[0].id;

console.log('--- Properties panel labels a selected instance by its template name, not "Unknown component" ---');
// addComponentAt() already selectOnly()'d the new instance, so switching TO
// the properties tab (which unconditionally re-renders it) is enough on its
// own — reset the capture first so this check can't accidentally pass on a
// stale value from something rendered earlier.
global.__lastTemplateInstanceLabel = null;
sidebarTabsApi.activateTab('properties');
console.log('properties panel shows "Template instance: Card" for the selected instance?', global.__lastTemplateInstanceLabel === 'Template instance: ' + cardTemplate.name);

console.log('--- Properties panel exposes one field per declared param (Subflow instance env-var dialog analogue) ---');
const valueParamField = global.__paramFieldsByLabel['Value {value}'];
console.log('a "Value {value}" field is shown for the selected instance?', !!valueParamField);
changeInput(valueParamField, 'Line 1 Temp');
console.log('editing it writes comp.paramValues.value (the static "<template value=...>" part)?', screen1.components[0].paramValues.value === 'Line 1 Temp');

console.log('--- Events tab: "On Params Change" node only while editing a Template, and one "Set <Param>" chip per instance param ---');
function eventsChipLabelsAfterFreshBuild() {
  sidebarTabsApi.activateTab('properties');
  const before = draggables.length;
  sidebarTabsApi.activateTab('events');
  return draggables.slice(before).map(d => chipText(d.el));
}
const eventLabelsOnScreen = eventsChipLabelsAfterFreshBuild();
console.log('"On Params Change" is NOT offered while editing a Screen?', eventLabelsOnScreen.indexOf('On Params Change') === -1);
console.log('"Instance #.... -> Set Value" chip IS offered for the dropped instance?', eventLabelsOnScreen.some(l => l.indexOf('Set Value') !== -1));

sidebarTabsApi.activateTab('templates');
clickTemplateRowLink(cardTemplate.name, 'Edit');
const eventLabelsOnTemplate = eventsChipLabelsAfterFreshBuild();
console.log('"On Params Change" IS offered while editing the Template itself (the Subflow-Input analogue)?', eventLabelsOnTemplate.indexOf('On Params Change') !== -1);
global.__backToScreensLink._handlers.click[0]({ preventDefault() {} });

console.log('--- create Template "Group", nest a "Card" instance inside it ---');
sidebarTabsApi.activateTab('templates');
global.__addTemplateBtn._handlers.click[0]();
console.log('two templates now exist?', configNodes[0].templates.length === 2);
const groupTemplate = configNodes[0].templates[1];
canvasTabsApi.activateTab('ui');
const labelsWhileEditingGroup = paletteLabelsAfterFreshBuild();
console.log('"Card" is offered in the palette while editing "Group" (no cycle yet)?', labelsWhileEditingGroup.indexOf(cardTemplate.name) !== -1);
dropChipByLabel(cardTemplate.name, 10, 10);
console.log('"Group" now contains one "Card" instance?', groupTemplate.components.length === 1 && groupTemplate.components[0].templateId === cardTemplate.id);

console.log('--- cycle guard: editing "Card" must no longer offer "Group" in the palette ---');
sidebarTabsApi.activateTab('templates');
clickTemplateRowLink(cardTemplate.name, 'Edit');
canvasTabsApi.activateTab('ui');
const labelsWhileEditingCard = paletteLabelsAfterFreshBuild();
console.log('"Group" is EXCLUDED from the palette while editing "Card" (would close a cycle)?', labelsWhileEditingCard.indexOf(groupTemplate.name) === -1);

console.log('--- "@lit-component": generic node, code lives per-instance, structured props via onBind/ui-update ---');
global.__backToScreensLink._handlers.click[0]({ preventDefault() {} });
sidebarTabsApi.activateTab('components');
console.log('a "Lit Component" chip is offered (fixed, not tied to any registered package)?', paletteLabelsAfterFreshBuild().indexOf('Lit Component') !== -1);
dropChipByLabel('Lit Component', 60, 60);
const litComp = screen1.components[screen1.components.length - 1];
console.log('a "@lit-component" instance landed on the screen with default code/size?', litComp.type === '@lit-component' && litComp.litCode.indexOf('render()') !== -1 && litComp.w === 220 && litComp.h === 120);
console.log('litBindable/litEvents start empty?', litComp.litBindable.length === 0 && litComp.litEvents.length === 0);

global.__lastLitComponentHeader = null;
global.__addLitBindableBtn = null;
global.__addLitEventBtn = null;
sidebarTabsApi.activateTab('properties');
console.log('Properties panel renders the "Lit Component" header without throwing?', !!global.__lastLitComponentHeader);

console.log('--- Bindable Properties + Events list editors write back onto the instance ---');
global.__addLitBindableBtn._handlers.click[0]();
console.log('"+ Add Bindable Property" appended one entry to litBindable?', litComp.litBindable.length === 1 && litComp.litBindable[0].name === 'prop1');

console.log('--- switching a Bindable Property\'s TypedInput type correctly parses and sets typed defaultValue ---');
const bindableRow = (global.__litBindableRows || []).slice(-1)[0];
const rowContainer = bindableRow._parent || bindableRow;
const bindableValRow = rowContainer._children[1];
const valInputEl = bindableValRow._children[1]._children[0];
valInputEl.typedInput('type', 'bool');
valInputEl.typedInput('value', 'false');
if (valInputEl._handlers.change) valInputEl._handlers.change.forEach(fn => fn());
console.log('switching typedInput to "bool" false sets a REAL boolean false (not string "false") and type "boolean"?', litComp.litBindable[0].defaultValue === false && litComp.litBindable[0].type === 'boolean');
global.__addLitEventBtn._handlers.click[0]();

console.log('"+ Add Event" appended one entry to litEvents?', litComp.litEvents.length === 1 && litComp.litEvents[0].name === 'myEvent1');

console.log('--- Code editing moved to a modal dialog (like the Function node) instead of inline sidebar editors ---');
// This whole section exists BECAUSE of a real, reported bug: an earlier
// inline-in-sidebar editor design silently discarded anything typed but not
// yet "Applied" the moment the Properties panel re-rendered for ANY other
// reason (e.g. adding a Bindable Property, which the section above just
// did). A modal dialog sidesteps that entirely — it owns the fields
// exclusively while open, immune to the sidebar's own re-renders.
//
// CodeMirror 6 (src/editor/cm6-code-editor.js) — this is the FOURTH revision
// of this dialog: two targeted Monaco fixes, then a plain-<textarea>
// guaranteed-safe fallback (confirmed working live), all preceded this. CM6
// brings syntax highlighting and custom autocomplete back without Monaco's
// architecture (no shared global mutable compiler-options state, no
// language-service worker). Unlike the old Monaco version, BOTH the JS and
// CSS editors are now created together, up front, and stay alive
// simultaneously for as long as the dialog is open (switching tabs only
// toggles CSS visibility) — deliberately different from the old "at most
// one alive at a time" Monaco-era rule, since that rule existed to dodge a
// documented ace/monaco-specific multi-instance bug (unscoped keybinding
// cross-talk, focus-steal recursion) that CM6 doesn't share.
const originalLitCode = litComp.litCode;
const editorsBeforeOpen = (global.__createdEditors || []).length;
console.log('an "Edit Code..." button is offered (not inline editors)?', !!global.__editLitCodeBtn);
global.__editLitCodeBtn._handlers.click[0]();
console.log('opening it creates BOTH the JS and CSS CM6 editors up front (not lazily per tab)?', global.__createdEditors.length === editorsBeforeOpen + 2);
const jsEd = global.__createdEditors[editorsBeforeOpen];
const cssEd = global.__createdEditors[editorsBeforeOpen + 1];
console.log('the JS editor was seeded with the CURRENT litCode (not blank/default)?', jsEd.getValue() === originalLitCode);
console.log('a "JavaScript"/"CSS" tab switcher is offered?', !!global.__litJsTabBtn && !!global.__litCssTabBtn);

console.log('--- switching tabs keeps both editors alive (CM6 is not subject to the old Monaco multi-instance bug) ---');
global.__litCssTabBtn._handlers.click[0]();
console.log('the JS editor is still alive after switching tabs (not destroyed)?', jsEd.destroyed === false);
console.log('the CSS editor is a genuinely different instance than the JS one?', cssEd !== jsEd);

console.log('--- Cancel discards without touching comp.litCode/litStyles, even after switching tabs, and destroys both editors ---');
cssEd.setTestValue('SHOULD NOT BE SAVED { color: red; }');
const cancelBtn = traySpec.buttons.find(b => b.text === 'Cancel');
cancelBtn.click();
console.log('Cancel left litCode/litStyles completely unchanged?', litComp.litCode === originalLitCode && litComp.litStyles !== 'SHOULD NOT BE SAVED { color: red; }');
console.log('Cancel destroyed both editors (tray close hook)?', jsEd.destroyed === true && cssEd.destroyed === true);

console.log('--- Done commits both class body and CSS at once, switching tabs between edits ---');
global.__editLitCodeBtn._handlers.click[0]();
const jsEd2 = global.__createdEditors[global.__createdEditors.length - 2];
const cssEd2 = global.__createdEditors[global.__createdEditors.length - 1];
jsEd2.setTestValue('render(){ return html`<div>${this.prop1}</div>`; }');
global.__litCssTabBtn._handlers.click[0]();
cssEd2.setTestValue(':host { color: red; }');
const doneBtn = traySpec.buttons.find(b => b.text === 'Done');
doneBtn.click();
console.log('Done wrote the new class body onto comp.litCode?', litComp.litCode.indexOf('SHOULD NOT BE SAVED') === -1 && litComp.litCode.indexOf('this.prop1') !== -1);
console.log('Done wrote the new CSS onto comp.litStyles?', litComp.litStyles === ':host { color: red; }');
console.log('Done also destroyed both editors (tray close hook)?', jsEd2.destroyed === true && cssEd2.destroyed === true);

console.log('--- re-rendering Properties afterward shows the COMMITTED code in the read-only preview, not stale/default text ---');
sidebarTabsApi.activateTab('properties');
console.log('(implicit — renderPropertiesPanel() ran again above without throwing, reading the now-updated comp.litCode/litStyles)');

console.log('--- Events tab: one "on <event>" chip + one generic "Update" chip per @lit-component instance ---');
const litEventLabels = eventsChipLabelsAfterFreshBuild();
console.log('an "on myEvent1" chip is offered?', litEventLabels.some(l => l.indexOf('on myEvent1') !== -1));
console.log('an "Update" chip is offered (reuses the existing ui-update node/dialog)?', litEventLabels.some(l => l.indexOf('Lit Component #') === 0 && l.indexOf('Update') !== -1));

console.log('ALL OK');
