// Regression test for a real bug the reverse-index optimization introduced:
// a "{sparkplug:G::E::D::{someParam}/metric}" binding (a per-instance
// template param EMBEDDED inside a Sparkplug binding — used so e.g. one
// shared "power meter card" template can point at a different device per
// instance) indexed the RAW, unsubstituted prop string instead of the
// resolved one. Every clone of the same template shares the identical
// literal text, so they all collided under one bogus key that could never
// match a real incoming metric name — only whichever instance the index
// happened to serve stayed live; every other instance of the same template
// silently froze. Fixed by resolving each component's OWN comp.__paramState
// into its prop BEFORE computing its index key (see
// registerSparkplugBoundComponentsFrom's own comment).
// Run standalone: node test/mock-sparkplug-template-param-regression.js <registry-client> <runtime-client>
const elements = [];
function makeEl(tag) {
  const el = {
    tag: tag, style: {}, children: [], attrs: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    querySelector(sel) { return this.children.find(c => c.tag === sel) || null; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; }
  };
  elements.push(el);
  return el;
}
const artboard = makeEl('div');
artboard.id = 'nexa-runtime-artboard';
global.document = {
  createElement(tag) { return makeEl(tag); },
  getElementById(id) { return id === 'nexa-runtime-artboard' ? artboard : null; },
  querySelector(sel) {
    const m = /\[data-id="([^"]+)"\]/.exec(sel);
    return m ? (elements.find(e => e.attrs['data-id'] === m[1]) || null) : null;
  }
};
global.window = global;
global.console = console;
global.window.addEventListener = function () {};
global.window.XMLHttpRequest = function () {};

function FakeEventSource(url) {
  this.url = url;
  this.listeners = {};
  FakeEventSource.instances.push(this);
}
FakeEventSource.prototype.addEventListener = function (name, fn) { this.listeners[name] = fn; };
FakeEventSource.instances = [];
global.window.EventSource = FakeEventSource;

var rafQueue = [];
global.window.requestAnimationFrame = function (fn) { rafQueue.push(fn); return rafQueue.length; };
function flushRAF() {
  var queued = rafQueue;
  rafQueue = [];
  queued.forEach(function (fn) { fn(); });
}

const fs = require('fs');
eval(fs.readFileSync(process.argv[2], 'utf8')); // nexa-registry-client.js

var renderLog = [];
NEXA.registerComponent('kufayeka-text-label', {
  render: function (el, props) { renderLog.push({ id: el.attrs['data-id'], text: props.text }); }
});

// One shared "power meter card" template, dropped TWICE with a different
// "lantai" param each time -- exactly the reported real-world shape.
window.__NEXA_TEMPLATES__ = [{
  id: 'tplCard', width: 200, height: 100,
  components: [
    { id: 'valueA', type: 'kufayeka-text-label', x: 0, y: 0, w: 100, h: 20, rotation: 0, layerId: 'default', props: { text: '{sparkplug:G1::E1::GP::{lantai}/a}' } }
  ],
  layers: [{ id: 'default', name: 'Default', parentId: null, state: 'show' }],
  logic: { nodes: [], wires: [] },
  params: [{ id: 'p1', name: 'lantai', label: 'lantai', type: 'text', defaultValue: '' }]
}];
window.__NEXA_SCREEN__ = {
  id: 's1', width: 800, height: 600,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    { id: 'card1', type: '@template', templateId: 'tplCard', x: 0, y: 0, w: 200, h: 100, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { lantai: 'Lantai_1' } },
    { id: 'card2', type: '@template', templateId: 'tplCard', x: 0, y: 150, w: 200, h: 100, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { lantai: 'Lantai_2' } }
  ]
};

eval(fs.readFileSync(process.argv[3], 'utf8')); // nexa-runtime-client.js

var source = FakeEventSource.instances[0];
renderLog = []; // clear whatever the initial mount rendered

console.log('--- a live tag change for CARD 1\'s resolved device path ("Lantai_1/a") updates ONLY card1\'s inner component ---');
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'GP', metrics: [{ name: 'Lantai_1/a', value: 111, isNull: false }] }) });
flushRAF();
console.log('exactly one render call?', renderLog.length === 1);
console.log('it was card1\'s inner component (namespaced "card1::valueA")?', renderLog[0] && renderLog[0].id === 'card1::valueA');
console.log('...showing the new value?', renderLog[0] && renderLog[0].text === '111');

renderLog = [];
console.log('--- a live tag change for CARD 2\'s resolved device path ("Lantai_2/a") updates ONLY card2\'s inner component (this is exactly what silently stopped working) ---');
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'GP', metrics: [{ name: 'Lantai_2/a', value: 222, isNull: false }] }) });
flushRAF();
console.log('exactly one render call?', renderLog.length === 1);
console.log('it was card2\'s inner component ("card2::valueA"), NOT card1\'s?', renderLog[0] && renderLog[0].id === 'card2::valueA');
console.log('...showing card2\'s own new value?', renderLog[0] && renderLog[0].text === '222');

console.log('ALL OK');
