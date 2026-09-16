// REAL benchmark for the exact usage pattern being asked about: an "inject"
// node firing every ~100ms (Node-RED/Node-RED-style "intervalMs" — note
// nexa-runtime-client.js's own setUpInjectNodes CLAMPS this to a 100ms
// floor regardless of what's configured, see the "clamp" check below) wired
// to several "set-template-param" nodes, with the SAME template dropped
// many times on one screen (this project's own Screen 4 uses one template
// 24 times).
//
// This specifically measures the cost of the fix from the sparkplug
// template-param regression: updateInstanceParam now calls
// registerSparkplugBoundComponentsFrom(screen) (a FULL re-scan of every
// component on the screen) on every single param change, to keep the
// sparkplug reverse-index correct. Fired 4x per inject tick (one per
// changed param) x possibly many template instances, this is exactly the
// kind of frequent, small-granularity work that a bad architectural
// decision could quietly turn into a bottleneck -- so this is measured for
// real, not assumed safe.
//
// Run: node test/benchmark-template-param-update.js [templateInstances] [paramsPerTick] [ticks]
// Defaults: 24 instances (matches this project's own Screen 4), 4 params
// changed per tick, 200 ticks (~20 real seconds at the clamped 100ms rate).
"use strict";
const TEMPLATE_INSTANCES = parseInt(process.argv[2], 10) || 24;
const PARAMS_PER_TICK = parseInt(process.argv[3], 10) || 4;
const TICKS = parseInt(process.argv[4], 10) || 200;

console.log("=".repeat(70));
console.log("BENCHMARK: set-template-param update cost (the registerSparkplugBoundComponentsFrom fix)");
console.log("=".repeat(70));
console.log(TEMPLATE_INSTANCES + " instances of the SAME template on one screen (matches this project's own Screen 4: 24 instances)");
console.log("Each tick changes " + PARAMS_PER_TICK + " params (a full index rebuild fires once PER param changed)");
console.log(TICKS + " ticks simulated\n");

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
function FakeEventSource(url) { this.url = url; }
FakeEventSource.prototype.addEventListener = function () {};
global.window.EventSource = FakeEventSource;
global.window.requestAnimationFrame = function (fn) { return setTimeout(fn, 0); };

// Capture every real setInterval the runtime registers (one per "inject"
// node) instead of letting it actually run on a wall-clock timer -- this
// benchmark ticks them manually so it doesn't have to wait 100ms x 200
// ticks = 20 real seconds just to collect timing data, AND so the
// CLAMP itself (Math.max(100, intervalMs)) is visible in what gets
// captured.
var capturedIntervals = [];
global.setInterval = function (fn, ms) { capturedIntervals.push({ fn: fn, ms: ms }); return capturedIntervals.length; };
global.clearInterval = function () {};
global.setTimeout = function (fn) { /* swallow the "once" scheduling + rAF shim above -- not needed for this benchmark */ return 0; };

const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nexa-registry-client.js'), 'utf8'));

var renderCallCount = 0;
NEXA.registerComponent('kufayeka-text-label', { render: function () { renderCallCount++; } });

// One template: 1 sparkplug-bound label per param (a/b/c), matching the
// real "power meter card" shape (lib/nexa-runtime-client.js resolves
// "{lantai}" from this instance's OWN paramValues before matching a real
// tag -- see registerSparkplugBoundComponentsFrom).
var templateComponents = ["a", "b", "c"].map(function (p, i) {
  return { id: 'val' + p, type: 'kufayeka-text-label', x: 0, y: i * 20, w: 100, h: 20, rotation: 0, layerId: 'default', props: { text: '{sparkplug:G1::E1::D1::{lantai}/' + p + '}' } };
});

var screenComponents = [];
for (var i = 0; i < TEMPLATE_INSTANCES; i++) {
  screenComponents.push({
    id: 'inst' + i, type: '@template', templateId: 'tplCard', x: (i % 6) * 210, y: Math.floor(i / 6) * 210, w: 200, h: 200,
    rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { lantai: 'Lantai_' + (i % 4) }
  });
}
// One inject node wired (via node ids matching set-template-param's own
// "instanceId"/"paramName") to PARAMS_PER_TICK "set-template-param" nodes,
// targeting the FIRST template instance -- exactly the pattern in the
// user's own flow (one inject -> several set-template-param nodes).
var paramNames = ["a", "b", "c", "d", "e", "f", "g", "h"].slice(0, PARAMS_PER_TICK);
var injectNode = { id: 'inj1', type: 'inject', intervalMs: 50, payloadType: 'num', payload: '1', once: false }; // 50ms requested -- see the clamp this hits
var wires = paramNames.map(function (p, i) { return { id: 'w' + i, from: 'inj1', to: 'setp' + p }; });
var logicNodes = [injectNode].concat(paramNames.map(function (p) {
  return { id: 'setp' + p, type: 'set-template-param', instanceId: 'inst0', paramName: p };
}));

window.__NEXA_TEMPLATES__ = [{
  id: 'tplCard', width: 200, height: 200, components: templateComponents,
  layers: [{ id: 'default', name: 'Default', parentId: null, state: 'show' }],
  logic: { nodes: [], wires: [] },
  params: paramNames.map(function (p) { return { id: 'p_' + p, name: p, label: p, type: 'text', defaultValue: '' }; }).concat([{ id: 'p_lantai', name: 'lantai', label: 'lantai', type: 'text', defaultValue: '' }])
}];
window.__NEXA_SCREEN__ = {
  id: 's1', width: 1400, height: 900,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: screenComponents,
  logic: { nodes: logicNodes, wires: wires }
};

eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nexa-runtime-client.js'), 'utf8'));

console.log("Requested inject interval: " + injectNode.intervalMs + "ms  ->  actual clamped interval: " + (capturedIntervals[0] ? capturedIntervals[0].ms : "(none captured)") + "ms");
console.log("(nexa-runtime-client.js's own setUpInjectNodes floors every repeating inject to Math.max(100, intervalMs) -- a configured 50ms literally cannot run faster than 100ms in the deployed page)\n");

if (!capturedIntervals.length) {
  console.log("No interval captured -- inject node wiring didn't match. Aborting benchmark.");
  process.exit(1);
}
var triggerInject = capturedIntervals[0].fn;

renderCallCount = 0;
var maxTickMs = 0;
var totalMs = 0;
var t0 = process.hrtime.bigint();
for (var tick = 0; tick < TICKS; tick++) {
  var tickStart = process.hrtime.bigint();
  triggerInject(); // fires ALL `paramNames.length` set-template-param nodes wired to this inject, synchronously, in one call -- exactly one real "clamped interval" tick
  var tickMs = Number(process.hrtime.bigint() - tickStart) / 1e6;
  if (tickMs > maxTickMs) maxTickMs = tickMs;
  totalMs += tickMs;
}
var t1 = process.hrtime.bigint();

console.log("Total wall-clock for " + TICKS + " ticks: " + (Number(t1 - t0) / 1e6).toFixed(2) + " ms");
console.log("Average per tick (" + PARAMS_PER_TICK + " param changes + " + PARAMS_PER_TICK + " full index rebuilds each): " + (totalMs / TICKS).toFixed(3) + " ms");
console.log("WORST single tick: " + maxTickMs.toFixed(3) + " ms");
console.log("Budget per tick at the clamped rate: " + (capturedIntervals[0].ms) + " ms");
console.log("Headroom: " + ((capturedIntervals[0].ms - (totalMs / TICKS)) / capturedIntervals[0].ms * 100).toFixed(1) + "% of the interval budget still free, on average");
var budgetMs = capturedIntervals[0].ms;
var verdict;
if (maxTickMs < budgetMs * 0.1) {
  verdict = "SAFE - worst tick is under 10% of the available time budget, huge margin even if this scales up further.";
} else if (maxTickMs < budgetMs) {
  verdict = "OK - comfortably under budget, but re-check if this scales up much more.";
} else {
  verdict = "AT RISK - a single tick can exceed the interval itself; ticks would start backing up.";
}
console.log("\nVerdict: " + verdict);
