// Verifies nexa-runtime-client.js's targeted + batched Sparkplug re-render
// path (the reverse index + requestAnimationFrame batching added to fix a
// real reported scaling problem: every incoming delta used to synchronously
// re-render EVERY bound component on the page, regardless of which single
// tag it actually carried). Run standalone:
//   node test/mock-sparkplug-render-perf.js <registry-client> <runtime-client>
// Same "eval the real files into a hand-rolled DOM shim" technique as
// test/mock-runtime-client.js — this file specifically exercises the
// Sparkplug SSE path that harness's own shim deliberately doesn't wire up
// (no window.XMLHttpRequest/EventSource there), by providing fake versions
// of both here.
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
// This test exercises the SSE live-binding path: Node >= 22 has a global
// WebSocket, which would otherwise make the runtime pick Nexa IO instead.
global.WebSocket = undefined;
global.console = console;
global.window.addEventListener = function () {};

// Fake XMLHttpRequest — never actually used (source.onopen, the only thing
// that would construct one via fetchSnapshotAndRefresh, is never invoked by
// this test), just needs to exist so setUpSparkplugLiveBinding's own
// `typeof window.XMLHttpRequest !== "function"` guard doesn't bail out
// before even reaching the EventSource setup below.
global.window.XMLHttpRequest = function () {};

// Fake EventSource — captures the instance nexa-runtime-client.js creates so
// this test can manually invoke .onmessage(...) exactly like a real SSE
// "message" event would, without a real HTTP connection.
function FakeEventSource(url) {
  this.url = url;
  this.listeners = {};
  FakeEventSource.instances.push(this);
}
FakeEventSource.prototype.addEventListener = function (name, fn) {
  this.listeners[name] = fn;
};
FakeEventSource.instances = [];
global.window.EventSource = FakeEventSource;

// Fake requestAnimationFrame — queues callbacks instead of running them on
// the next real frame, so this test controls exactly when a batched flush
// actually happens (flushRAF()) rather than racing a real 16ms timer.
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

window.__NEXA_SCREEN__ = {
  id: 's1', width: 800, height: 600,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    { id: 'compA', type: 'kufayeka-text-label', x: 0, y: 0, w: 100, h: 20, rotation: 0, layerId: 'default', props: { text: '{sparkplug:G1::E1::D1::MetricA}' } },
    { id: 'compB', type: 'kufayeka-text-label', x: 0, y: 30, w: 100, h: 20, rotation: 0, layerId: 'default', props: { text: '{sparkplug:G1::E1::D1::MetricB}' } },
    { id: 'compC', type: 'kufayeka-text-label', x: 0, y: 60, w: 100, h: 20, rotation: 0, layerId: 'default', props: { text: 'not bound at all' } }
  ]
};

eval(fs.readFileSync(process.argv[3], 'utf8')); // nexa-runtime-client.js

console.log('--- setup sanity: EventSource was actually constructed (Sparkplug SSE wiring engaged) ---');
console.log('exactly one EventSource instance created?', FakeEventSource.instances.length === 1);
var source = FakeEventSource.instances[0];
console.log('onmessage handler wired?', typeof source.onmessage === 'function');

// Initial mount already rendered every component once -- clear that out so
// the assertions below are only about what happens AFTER a live delta.
renderLog = [];

console.log('--- a delta does NOT synchronously re-render anything (batched to the next animation frame) ---');
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'D1', metrics: [{ name: 'MetricA', value: 42, isNull: false }] }) });
console.log('render log still empty right after onmessage, before any rAF flush?', renderLog.length === 0);

console.log('--- once flushed, ONLY the component bound to the changed tag re-renders (not compB, not the unbound compC) ---');
flushRAF();
console.log('exactly one render call?', renderLog.length === 1);
console.log('it was compA?', renderLog[0] && renderLog[0].id === 'compA');
console.log('...with the new live value resolved into its text prop?', renderLog[0] && renderLog[0].text === '42');

renderLog = [];
console.log('--- several deltas for the SAME tag arriving before the next flush collapse into exactly ONE render, with the latest value ---');
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'D1', metrics: [{ name: 'MetricA', value: 1, isNull: false }] }) });
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'D1', metrics: [{ name: 'MetricA', value: 2, isNull: false }] }) });
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'D1', metrics: [{ name: 'MetricA', value: 3, isNull: false }] }) });
flushRAF();
console.log('exactly one render call despite three deltas?', renderLog.length === 1);
console.log('reflects the LAST value, not the first?', renderLog[0] && renderLog[0].text === '3');

renderLog = [];
console.log('--- deltas for TWO different tags in the same tick each get their own targeted re-render, once flushed ---');
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'D1', metrics: [{ name: 'MetricA', value: 10, isNull: false }] }) });
source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'D1', metrics: [{ name: 'MetricB', value: 20, isNull: false }] }) });
flushRAF();
var ids = renderLog.map(function (r) { return r.id; }).sort();
console.log('both compA and compB rendered (and nothing else)?', JSON.stringify(ids) === JSON.stringify(['compA', 'compB']));

renderLog = [];
console.log('--- a "death" delta re-renders every previously-online bound component under it (falls back to "???"), not the unbound one ---');
source.onmessage({ data: JSON.stringify({ type: 'death', groupId: 'G1', edgeNodeId: 'E1', deviceId: 'D1' }) });
flushRAF();
var deathIds = renderLog.map(function (r) { return r.id; }).sort();
console.log('both compA and compB re-rendered on death (both had been online)?', JSON.stringify(deathIds) === JSON.stringify(['compA', 'compB']));
var compAEntry = renderLog.filter(function (r) { return r.id === 'compA'; })[0];
console.log('compA now shows "???" (offline)?', compAEntry && compAEntry.text === '???');

console.log('ALL OK');
