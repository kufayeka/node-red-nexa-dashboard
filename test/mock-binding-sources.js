// A prop's binding source on a deployed page (src/runtime/):
// Variable, Tag, Message ({msg.*}, filled by an "Update Component" node) and
// an Expression mixing all three in one text — including a Sparkplug tag
// INSIDE a text, which must also update live. Same DOM shim / fake SSE as
// mock-sparkplug-template-param-regression.js.
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
global.WebSocket = undefined;
global.console = console;
global.window.addEventListener = function () {};
global.window.XMLHttpRequest = function () {};
function FakeEventSource(url) { this.url = url; this.listeners = {}; FakeEventSource.instances.push(this); }
FakeEventSource.prototype.addEventListener = function (name, fn) { this.listeners[name] = fn; };
FakeEventSource.instances = [];
global.window.EventSource = FakeEventSource;
var rafQueue = [];
global.window.requestAnimationFrame = function (fn) { rafQueue.push(fn); return rafQueue.length; };
function flushRAF() { var q = rafQueue; rafQueue = []; q.forEach(function (fn) { fn(); }); }

const fs = require('fs');
eval(fs.readFileSync(process.argv[2], 'utf8')); // nexa-registry-client.js

var shown = {};
NEXA.registerComponent('label', { render: function (el, props) { shown[el.attrs['data-id']] = props.text; } });
NEXA.registerComponent('gauge', { render: function (el, props) { shown[el.attrs['data-id']] = props.value; } });
var btnCtx = null;
NEXA.registerComponent('btn', { render: function (el, props, ctx) { btnCtx = ctx; } });

const TAG = '{sparkplug:G1::E1::D1::Speed}';
window.__NEXA_TEMPLATES__ = [];
window.__NEXA_SCREEN__ = {
  id: 's1', width: 800, height: 600, treeVersion: 1, orphans: [],
  variables: [{ id: 'v1', name: 'line', type: 'string', defaultValue: 'L1' }],
  components: [
    { id: 'byVar', type: 'label', x: 0, y: 0, w: 100, h: 20, props: { text: '{line}' } },
    { id: 'byTag', type: 'label', x: 0, y: 20, w: 100, h: 20, props: { text: TAG } },
    { id: 'byMsg', type: 'gauge', x: 0, y: 40, w: 100, h: 20, props: { value: '{msg.payload.speed}' } },
    { id: 'byExpr', type: 'label', x: 0, y: 60, w: 300, h: 20, props: { text: 'Line {line}: ' + TAG + ' rpm, order {msg.payload.id}' } },
    { id: 'plain', type: 'label', x: 0, y: 80, w: 100, h: 20, props: { text: 'static' } },
    { id: 'btn', type: 'btn', x: 0, y: 100, w: 50, h: 20, props: {} }
  ],
  logic: { nodes: [
    { id: 'e1', type: 'ui-event', compId: 'btn', event: 'send1' }, { id: 'send1', type: 'ui-update', compId: 'byMsg', config: {} },
    { id: 'e2', type: 'ui-event', compId: 'btn', event: 'send2' }, { id: 'send2', type: 'ui-update', compId: 'byExpr', config: {} },
    { id: 'e3', type: 'ui-event', compId: 'btn', event: 'send3' }, { id: 'send3', type: 'ui-update', compId: 'plain', config: {} }
  ], wires: [{ id: 'w1', from: 'e1', to: 'send1' }, { id: 'w2', from: 'e2', to: 'send2' }, { id: 'w3', from: 'e3', to: 'send3' }] }
};

eval(fs.readFileSync(process.argv[3], 'utf8')); // nexa-runtime-client.js
var source = FakeEventSource.instances[0];

console.log('--- on mount ---');
console.log('Variable: {line} -> "L1"?', shown.byVar === 'L1');
console.log('Message before any message: empty (not the binding text)?', shown.byMsg === '');
console.log('Expression before any message: the message part empty, the rest resolved?', /^Line L1: .* rpm, order $/.test(shown.byExpr), JSON.stringify(shown.byExpr));

console.log('--- a live tag value ---');
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'D1', metrics: [{ name: 'Speed', value: 1450, isNull: false }] }) });
flushRAF();
console.log('Tag: the whole value -> 1450?', String(shown.byTag) === '1450');
console.log('Expression: the tag INSIDE the text updates live too?', shown.byExpr === 'Line L1: 1450 rpm, order ', JSON.stringify(shown.byExpr));

console.log('--- an Update Component node sends a message ---');
// a button event -> ui-event node -> the Update node (msg.payload = what the button emitted)
function run(id, msg) { btnCtx.emit(id, msg.payload); }
run('send1', { payload: { speed: 77 } });
console.log('Message: {msg.payload.speed} -> 77 (typed, a number)?', shown.byMsg === 77);
run('send2', { payload: { id: 'JOB-9' } });
console.log('Expression: variable + live tag + message together?', shown.byExpr === 'Line L1: 1450 rpm, order JOB-9', JSON.stringify(shown.byExpr));
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'D1', metrics: [{ name: 'Speed', value: 1500, isNull: false }] }) });
flushRAF();
console.log('a later tag change keeps the message part?', shown.byExpr === 'Line L1: 1500 rpm, order JOB-9', JSON.stringify(shown.byExpr));
run('send1', { payload: 'not an object' });
console.log('a message without that path: empty, and the binding is NOT overwritten by the old payload guess?', shown.byMsg === '');
run('send1', { payload: { speed: 5 } });
console.log('...so the next message still maps (the binding survived)?', shown.byMsg === 5);
run('send3', { payload: 'hello' });
console.log('a component with no {msg} binding keeps the old behaviour (payload -> text)?', shown.plain === 'hello');

console.log('ALL OK');
