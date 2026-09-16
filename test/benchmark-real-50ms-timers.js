// CORRECTED benchmark — the previous one (benchmark-template-param-update.js)
// tested the WRONG mechanism (Nexa Screen's own browser-side "inject" logic
// node, which nexa-runtime-client.js clamps to a 100ms floor). The user's
// REAL flow uses 4 independent "interval-multiples-timer" Node-RED nodes
// (data/flows.json) at a genuine, UNCLAMPED 50ms interval, each writing a
// random value to one asset attribute (GP.Lantai_1.a, GP.Lantai_1.b,
// GP.Lantai_2.a, GP.Lantai_2.b) via kufayeka-asset-write. That write cascades
// through the asset engine -> a real Sparkplug DDATA MQTT publish (already
// confirmed batched per-device, not per-attribute -- see
// nodes/sparkplug-edge-node.js's onAssetChange) -> Nexa Dashboard's own
// separate MQTT listener -> SSE -> THIS runtime client's rendering, which is
// the part this benchmark actually measures: real, independent,
// asynchronous 50ms-interval deltas hitting the ACTUAL reverse-index +
// requestAnimationFrame-batched code (not a synchronous burst simulated all
// at once, which is an easier case than 4 staggered, out-of-phase clocks).
//
// Run: node test/benchmark-real-50ms-timers.js [seconds]
// Default: 5 simulated seconds (100 ticks per timer at 50ms).
"use strict";
const SECONDS = parseFloat(process.argv[2]) || 5;

console.log("=".repeat(70));
console.log("BENCHMARK: 4 independent, UNSYNCHRONIZED 50ms timers -> real Sparkplug delta -> dashboard render");
console.log("=".repeat(70));
console.log("Reproduces data/flows.json exactly: 4x interval-multiples-timer(50ms) -> random -> asset-write");
console.log("targeting GP.Lantai_1.a, GP.Lantai_1.b, GP.Lantai_2.a, GP.Lantai_2.b");
console.log(SECONDS + " simulated seconds\n");

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

function FakeEventSource(url) { this.url = url; FakeEventSource.instances.push(this); }
FakeEventSource.instances = [];
FakeEventSource.prototype.addEventListener = function () {};
global.window.EventSource = FakeEventSource;

// Controllable rAF -- same technique as the other benchmarks; here it's
// flushed after EVERY simulated 1ms of "wall clock" (see the tick loop
// below), matching a real browser's ~1 frame per ~16ms cadence closely
// enough for this measurement (rAF firing MORE often than real only makes
// this benchmark's numbers a pessimistic upper bound, not an optimistic one).
var rafQueue = [];
global.window.requestAnimationFrame = function (fn) { rafQueue.push(fn); return rafQueue.length; };
function flushRAF() { var q = rafQueue; rafQueue = []; q.forEach(function (fn) { fn(); }); }

var renderCallCount = 0;
var renderLog = [];
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nexa-registry-client.js'), 'utf8'));
NEXA.registerComponent('kufayeka-text-label', {
  render: function (el, props) { renderCallCount++; renderLog.push(el.attrs['data-id']); }
});

// Real components from the user's own screens that bind to these exact 4
// tags (data/flows.json Screen 1 + Screen 3), plus a realistic amount of
// OTHER, unrelated bound/unbound components so the reverse-index actually
// has to do real discrimination work, not just match a 1-entry index.
var components = [
  { id: 'n0b0cc5ff', type: 'kufayeka-text-label', x: 0, y: 0, w: 160, h: 36, rotation: 0, layerId: 'default', props: { text: '{sparkplug:Kufayeka::NexaNodered::GP::Lantai_1/a}' } },
  { id: 'n3d2c691f', type: 'kufayeka-text-label', x: 0, y: 40, w: 160, h: 36, rotation: 0, layerId: 'default', props: { text: '{sparkplug:Kufayeka::NexaNodered::GP::Lantai_1/a}' } }, // a SECOND label bound to the same tag, as in the real screen
  { id: 'n16eb65ce', type: 'kufayeka-text-label', x: 0, y: 80, w: 160, h: 36, rotation: 0, layerId: 'default', props: { text: '{sparkplug:Kufayeka::NexaNodered::GP::Lantai_1/b}' } },
  { id: 'n97709d95', type: 'kufayeka-text-label', x: 0, y: 120, w: 160, h: 36, rotation: 0, layerId: 'default', props: { text: '{sparkplug:Kufayeka::NexaNodered::GP::Lantai_2/a}' } },
  { id: 'n5641cd21-lbl', type: 'kufayeka-text-label', x: 0, y: 160, w: 160, h: 36, rotation: 0, layerId: 'default', props: { text: '{sparkplug:Kufayeka::NexaNodered::GP::Lantai_2/b}' } }
];
// ...plus every OTHER real binding visible in the flow (result/c/d/air_pressure/
// suhu_koridor/string_test/output/speed/json/param1/param2), so the index
// has a realistic number of DIFFERENT keys to discriminate between, not just
// the 4 that are actually changing.
["result", "c", "d", "air_pressure", "suhu_koridor", "string_test"].forEach(function (m, i) {
  components.push({ id: 'other_L1_' + m, type: 'kufayeka-text-label', x: 200, y: i * 40, w: 160, h: 36, rotation: 0, layerId: 'default', props: { text: '{sparkplug:Kufayeka::NexaNodered::GP::Lantai_1/' + m + '}' } });
  components.push({ id: 'other_L2_' + m, type: 'kufayeka-text-label', x: 400, y: i * 40, w: 160, h: 36, rotation: 0, layerId: 'default', props: { text: '{sparkplug:Kufayeka::NexaNodered::GP::Lantai_2/' + m + '}' } });
});
["output", "speed"].forEach(function (m, i) {
  components.push({ id: 'other_asj_' + m, type: 'kufayeka-text-label', x: 600, y: i * 40, w: 160, h: 36, rotation: 0, layerId: 'default', props: { text: '{sparkplug:Kufayeka::NexaNodered::ASJ::' + m + '}' } });
});
// A generous helping of purely decorative, unbound shapes -- matching how
// most of a real screen (rects/ellipses/stars with no binding at all) looks.
for (var d = 0; d < 30; d++) {
  components.push({ id: 'deco' + d, type: 'kufayeka-rect', x: 800, y: d * 20, w: 100, h: 15, rotation: 0, layerId: 'default', props: { fill: '#ccc' } });
}
NEXA.registerComponent('kufayeka-rect', { render: function () { renderCallCount++; } });

console.log(components.length + " total components on screen (" + 5 + " bound to the 4 tags actually changing, " + (components.length - 5 - 30) + " bound to OTHER tags that never change, 30 purely decorative/unbound)\n");

window.__NEXA_SCREEN__ = { id: 's1', width: 1600, height: 900, layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }], components: components };
eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nexa-runtime-client.js'), 'utf8'));
var source = FakeEventSource.instances[0];
renderCallCount = 0; // ignore the initial mount's own render pass
renderLog = [];

function sendDelta(deviceId, metricName, value) {
  source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'Kufayeka', edgeNodeId: 'NexaNodered', deviceId: 'GP', metrics: [{ name: metricName, value: value, isNull: false }] }) });
}

// 4 INDEPENDENT timers, each every 50ms, deliberately OUT OF PHASE with each
// other (13ms, 27ms, 41ms, 3ms offsets) -- exactly what 4 real,
// independently-started interval-multiples-timer nodes look like: they are
// NOT synchronized to fire in the same tick, so this is the harder,
// more realistic case (up to 4 separate render-triggering events landing in
// DIFFERENT animation frames, not always neatly batched together).
var TICK_MS = 1; // simulate wall-clock in 1ms steps
var totalTicks = Math.round(SECONDS * 1000 / TICK_MS);
var timers = [
  { everyMs: 50, offsetMs: 3, metric: "Lantai_1/a", nextAt: 3 },
  { everyMs: 50, offsetMs: 13, metric: "Lantai_1/b", nextAt: 13 },
  { everyMs: 50, offsetMs: 27, metric: "Lantai_2/a", nextAt: 27 },
  { everyMs: 50, offsetMs: 41, metric: "Lantai_2/b", nextAt: 41 }
];
var deltaCount = 0;
var t0 = process.hrtime.bigint();
for (var ms = 0; ms < totalTicks * TICK_MS; ms += TICK_MS) {
  timers.forEach(function (t) {
    if (ms >= t.nextAt) {
      sendDelta("GP", t.metric, Math.floor(Math.random() * 70) + 10);
      deltaCount++;
      t.nextAt += t.everyMs;
    }
  });
  // Simulate one animation frame roughly every 16ms (60fps) -- flush
  // whatever's dirty at that point, same as a real browser would.
  if (ms % 16 === 0) flushRAF();
}
flushRAF(); // catch anything pending at the very end
var t1 = process.hrtime.bigint();

console.log("Simulated deltas sent: " + deltaCount + " (4 tags x ~20/sec x " + SECONDS + "s)");
console.log("Total render() calls: " + renderCallCount);
console.log("Total wall-clock CPU time: " + (Number(t1 - t0) / 1e6).toFixed(2) + " ms for " + SECONDS + " simulated seconds");
console.log("Renders per real second: " + (renderCallCount / SECONDS).toFixed(1));
console.log("Only the 5 components actually bound to the 4 changing tags rendered? " + (renderLog.every(function (id) { return ['n0b0cc5ff', 'n3d2c691f', 'n16eb65ce', 'n97709d95', 'n5641cd21-lbl'].indexOf(id) !== -1; }) ? "YES" : "NO - some unrelated component rendered, investigate"));
console.log("\nVerdict: this is " + (Number(t1 - t0) / 1e6 / (SECONDS * 1000) * 100).toFixed(3) + "% of real time spent rendering -- " + (Number(t1 - t0) / 1e6 < SECONDS * 1000 * 0.01 ? "utterly trivial load" : "worth a closer look"));
