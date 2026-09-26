// Minimal DOM mock just for nexa-registry-client.js + nexa-runtime-client.js
// (much simpler than the editor mocks — no jQuery, no dragging, just plain
// DOM element creation/appendChild, which is all the runtime client uses).
const elements = [];
function makeEl(tag) {
  const el = {
    tag: tag, style: {}, children: [], attrs: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    // Real DOM's removeChild — needed by the Layer Control node's "remove"
    // state (reconcileTopLevelLayerRender in nexa-runtime-client.js actually
    // tears a component's DOM node out, not just css-hides it).
    removeChild(child) {
      child.parentNode = null;
      this.children = this.children.filter(c => c !== child);
      elements.splice(elements.indexOf(child), 1);
    },
    querySelector(sel) {
      // very small subset: only supports tag-name selectors, which is all
      // the components here use (e.g. "nexa-text-label")
      return this.children.find(c => c.tag === sel) || null;
    },
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
  // The logic engine's applyUiUpdateProp/refreshComponentRender look
  // components up via document.querySelector('[data-id="..."]') against
  // the real DOM — this tiny regex-based stand-in is enough for that one
  // pattern, the only one the runtime client actually uses.
  querySelector(sel) {
    const m = /\[data-id="([^"]+)"\]/.exec(sel);
    return m ? (elements.find(e => e.attrs['data-id'] === m[1]) || null) : null;
  }
};
global.window = global;
global.console = console;
// fireLifecycle("onclose") is wired to window.addEventListener("beforeunload", ...)
// — not exercised by this test (nothing here ever "unloads"), just needs
// to exist so mountScreen() doesn't throw registering the listener.
global.window.addEventListener = function () {};

const fs = require('fs');
eval(fs.readFileSync(process.argv[2], 'utf8')); // nexa-registry-client.js

// Register the same two component types the real example package does, but
// with a lightweight fake render() (no real Lit needed here — this test is
// about the MOUNT ENGINE's own logic: positioning, rotation, layer
// visibility, error handling — not about a specific component's internals,
// already covered by the browser-side files directly).
NEXA.registerComponent('kufayeka-rect', {
  render: function (el, props) { el.style.background = props.fill; }
});
NEXA.registerComponent('kufayeka-broken', {
  render: function () { throw new Error('boom'); }
});

window.__NEXA_SCREEN__ = {
  id: 's1', width: 800, height: 600,
  layers: [
    { id: 'default', name: 'Default', parentId: null, visible: true },
    { id: 'hidden-child', name: 'Hidden', parentId: 'default', visible: true }
  ],
  components: [
    { id: 'c1', type: 'kufayeka-rect', x: 10, y: 20, w: 100, h: 50, rotation: 0, layerId: 'default', props: { fill: '#f00' } },
    { id: 'c2', type: 'kufayeka-rect', x: 200, y: 20, w: 100, h: 50, rotation: 45, layerId: 'hidden-child', props: { fill: '#0f0' } },
    { id: 'c3', type: 'unknown-type', x: 300, y: 20, w: 60, h: 60, rotation: 0, layerId: 'default', props: {} },
    { id: 'c4', type: 'kufayeka-broken', x: 400, y: 20, w: 60, h: 60, rotation: 0, layerId: 'default', props: {} }
  ]
};

eval(fs.readFileSync(process.argv[3], 'utf8')); // nexa-runtime-client.js

console.log('mounted element count:', artboard.children.length, '(expect 4)');
const c1 = artboard.children.find(e => e.attrs['data-id'] === 'c1');
console.log('c1 positioned correctly?', c1.style.left === '10px' && c1.style.top === '20px' && c1.style.width === '100px');
console.log('c1 visible (display not none)?', c1.style.display === '');

const c2 = artboard.children.find(e => e.attrs['data-id'] === 'c2');
console.log('c2 rotation applied?', c2.style.transform === 'rotate(45deg)');
console.log('c2 in "hidden-child" layer (parent still visible) is VISIBLE?', c2.style.display === '');

// Now hide the PARENT layer directly and re-mount a fresh component to
// prove the cascading check itself (same isLayerVisible logic, exercised a
// second time rather than needing a full re-render pipeline).
window.__NEXA_SCREEN__.layers[0].visible = false;
const artboard2 = makeEl('div');
global.document.getElementById = (id) => id === 'nexa-runtime-artboard' ? artboard2 : null;
eval(fs.readFileSync(process.argv[3], 'utf8'));
const c2b = artboard2.children.find(e => e.attrs['data-id'] === 'c2');
console.log('after hiding the PARENT layer, c2 (nested child layer) becomes hidden?', c2b.style.display === 'none');

const c3 = artboard.children.find(e => e.attrs['data-id'] === 'c3');
console.log('unknown component type shows a placeholder message, no throw?', /unknown component/.test(c3.textContent));

const c4 = artboard.children.find(e => e.attrs['data-id'] === 'c4');
console.log('a render() that throws is caught, shows error text, no crash?', /render error/.test(c4.textContent));

// --- Logic execution on a DEPLOYED page — this is the actual bug report
// this test was added for: the whole screen.logic graph (onload/ui-event/
// function/ui-update/debug) was only ever wired up in the EDITOR
// (lib/nexa-plugin.html); a deployed page's console showed the component's
// own "[nexa] component event" log line (proving ctx.emit fired) but
// NOTHING downstream ever ran, because nexa-runtime-client.js never called
// fireUiEvent/fireLifecycle at all. This section proves the ported engine
// here actually executes end-to-end, the same way mock-logic.js already
// proves it does in the editor.
console.log('--- deployed-page logic execution ---');
let lastCtx = null;
NEXA.registerComponent('mock-button', {
  render: function (el, props, ctx) { lastCtx = ctx; }
});
NEXA.registerComponent('mock-sink', {
  render: function () {} // no onBind on purpose - exercises the props+refreshComponentRender fallback path
});

const artboard3 = makeEl('div');
global.document.getElementById = (id) => id === 'nexa-runtime-artboard' ? artboard3 : null;
window.__NEXA_SCREEN__ = {
  id: 's2', width: 800, height: 600, layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    { id: 'btn', type: 'mock-button', x: 0, y: 0, w: 100, h: 40, layerId: 'default', props: {} },
    { id: 'sink', type: 'mock-sink', x: 200, y: 0, w: 100, h: 40, layerId: 'default', props: {} }
  ],
  logic: {
    nodes: [
      { id: 'onload1', type: 'onload' },
      { id: 'fn1', type: 'function', code: 'return {properties: {text: "LOADED"}};' },
      { id: 'upd1', type: 'ui-update', compId: 'sink', config: {} },
      { id: 'evt1', type: 'ui-event', compId: 'btn', event: 'click' },
      { id: 'fn2', type: 'function', code: 'return {properties: {text: msg.payload + "!"}};' },
      { id: 'upd2', type: 'ui-update', compId: 'sink', config: {} },
      { id: 'cycleA', type: 'function', code: 'return {payload: (msg.payload||0)+1};' },
      { id: 'cycleB', type: 'function', code: 'return {payload: msg.payload};' },
      { id: 'evtCycle', type: 'ui-event', compId: 'btn', event: 'spin' }
    ],
    wires: [
      { id: 'w1', from: 'onload1', to: 'fn1' },
      { id: 'w2', from: 'fn1', to: 'upd1' },
      { id: 'w3', from: 'evt1', to: 'fn2' },
      { id: 'w4', from: 'fn2', to: 'upd2' },
      { id: 'w5', from: 'evtCycle', to: 'cycleA' },
      { id: 'w6', from: 'cycleA', to: 'cycleB' },
      { id: 'w7', from: 'cycleB', to: 'cycleA' }
    ]
  }
};
eval(fs.readFileSync(process.argv[3], 'utf8'));
const sinkComp = window.__NEXA_SCREEN__.components.find(c => c.id === 'sink');

// Every "function" node is now wrapped to support `await` (see below), so
// its result is ALWAYS a promise, even for plain code with no await at
// all — propagation one step downstream now always happens a microtask
// later than the trigger, never synchronously in the same tick. A short
// setTimeout is enough to let any pending microtasks drain before checking.
const tick = () => new Promise(r => setTimeout(r, 20));

(async function () {
  await tick();
  console.log('onload -> function -> ui-update fires on mount (no editor, no tray)?', sinkComp.props.text === 'LOADED', '(actual: ' + JSON.stringify(sinkComp.props.text) + ')');

  console.log('SDK components get mode "runtime" and a generic writeTag on their ctx?', lastCtx.mode === 'runtime' && typeof lastCtx.writeTag === 'function');
  const notATag = await lastCtx.writeTag('nope', 1).then(() => 'resolved', (e) => e.message);
  console.log('writeTag on a prop that holds no tag rejects?', /is not a tag/.test(notATag), '(actual: ' + notATag + ')');

  lastCtx.emit('click', 'clicked');
  await tick();
  console.log('a real component ctx.emit fires its wired ui-event -> function -> ui-update chain?', sinkComp.props.text === 'clicked!', '(actual: ' + JSON.stringify(sinkComp.props.text) + ')');

  const realConsoleError = console.error;
  let sawStopMessage = false;
  console.error = function (...args) { if (/stopped after \d+ steps/.test(args[0] || '')) sawStopMessage = true; realConsoleError.apply(console, args); };
  lastCtx.emit('spin', 0);
  // The cycle is now a chain of MICROTASKS (every function node is async),
  // not a single synchronous burst — give it enough real time to actually
  // run out its budget (see the big comment on LOGIC_MAX_STEPS/budget in
  // nexa-runtime-client.js for why a shared budget object, not a fresh
  // per-call counter, is what makes this terminate at all).
  await new Promise(r => setTimeout(r, 300));
  console.error = realConsoleError;
  console.log('a wire cycle through async nodes still terminates (hit the shared step cap) instead of looping forever?', sawStopMessage);

  await runNewNodeTypeTests();
  process.exit(0);
})();

// --- New node types + async Function support (this session's other asks:
// "mampukan runtime executor... untuk handle await async" for fetch-like
// calls, plus Reload/Open URL/Inject nodes) — all runtime-only, since the
// editor never executes screen.logic at all anymore.
async function runNewNodeTypeTests() {
  console.log('--- async Function nodes (await, e.g. fetch) ---');
  let reloadCalled = false;
  let openedUrl = null, openedTarget = null;
  global.window.location = { href: '', reload() { reloadCalled = true; } };
  global.window.open = function (url, target) { openedUrl = url; openedTarget = target; };

  NEXA.registerComponent('mock-button2', { render: function (el, props, ctx) { lastCtx = ctx; } });
  NEXA.registerComponent('mock-sink2', { render: function () {} });

  const artboard4 = makeEl('div');
  global.document.getElementById = (id) => id === 'nexa-runtime-artboard' ? artboard4 : null;
  window.__NEXA_SCREEN__ = {
    id: 's3', width: 800, height: 600, layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [
      { id: 'btn2', type: 'mock-button2', x: 0, y: 0, w: 100, h: 40, layerId: 'default', props: {} },
      { id: 'sink2', type: 'mock-sink2', x: 200, y: 0, w: 100, h: 40, layerId: 'default', props: {} }
    ],
    logic: {
      nodes: [
        { id: 'evtAsync', type: 'ui-event', compId: 'btn2', event: 'go' },
        // `await` a resolved promise, like `await fetch(...)` would —
        // proves the function body runs inside an async wrapper, not just
        // that plain synchronous "return msg;" code still works.
        { id: 'fnAsync', type: 'function', code: 'const v = await Promise.resolve("FETCHED"); return {properties: {text: v}};' },
        { id: 'updAsync', type: 'ui-update', compId: 'sink2', config: {} },

        { id: 'evtReload', type: 'ui-event', compId: 'btn2', event: 'doReload' },
        { id: 'reloadNode', type: 'reload' },

        { id: 'evtUrlStatic', type: 'ui-event', compId: 'btn2', event: 'goStatic' },
        { id: 'urlNodeStatic', type: 'open-url', url: 'https://example.com/static', newTab: false },

        { id: 'evtUrlDynamic', type: 'ui-event', compId: 'btn2', event: 'goDynamic' },
        { id: 'urlNodeDynamic', type: 'open-url', url: '', newTab: true },

        { id: 'injectNode', type: 'inject', intervalMs: 100 },
        { id: 'injectSink', type: 'ui-update', compId: 'sink2', config: {} }
      ],
      wires: [
        { id: 'w1', from: 'evtAsync', to: 'fnAsync' },
        { id: 'w2', from: 'fnAsync', to: 'updAsync' },
        { id: 'w3', from: 'evtReload', to: 'reloadNode' },
        { id: 'w4', from: 'evtUrlStatic', to: 'urlNodeStatic' },
        { id: 'w5', from: 'evtUrlDynamic', to: 'urlNodeDynamic' }
        // injectNode/injectSink deliberately NOT wired together here — it's
        // tested standalone below via its own screen, to keep its
        // 100ms-interval side effects from racing the rest of this test.
      ]
    }
  };
  eval(fs.readFileSync(process.argv[3], 'utf8'));
  const sink2 = window.__NEXA_SCREEN__.components.find(c => c.id === 'sink2');

  lastCtx.emit('go', null);
  // The function node's body is `async` and awaits a promise — propagation
  // to the Update node only happens after that promise resolves, i.e. on a
  // LATER microtask/macrotask, not synchronously within emit() itself.
  await new Promise(resolve => setTimeout(resolve, 20));
  console.log('async Function (await Promise.resolve) eventually updates the sink?', sink2.props.text === 'FETCHED', '(actual: ' + JSON.stringify(sink2.props.text) + ')');

  lastCtx.emit('doReload', null);
  console.log('"Reload Page" node calls window.location.reload()?', reloadCalled === true);

  lastCtx.emit('goStatic', null);
  console.log('"Open URL" node navigates via window.location.href using its static url?', global.window.location.href === 'https://example.com/static');

  lastCtx.emit('goDynamic', 'https://example.com/from-payload');
  console.log('"Open URL" node with newTab:true + a string msg.payload opens that URL in a new tab via window.open?', openedUrl === 'https://example.com/from-payload' && openedTarget === '_blank');

  console.log('--- Inject node (fires on its own on an interval once mounted) ---');
  const artboard5 = makeEl('div');
  global.document.getElementById = (id) => id === 'nexa-runtime-artboard' ? artboard5 : null;
  window.__NEXA_SCREEN__ = {
    id: 's4', width: 800, height: 600, layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [{ id: 'sink3', type: 'mock-sink2', x: 0, y: 0, w: 100, h: 40, layerId: 'default', props: {} }],
    logic: {
      nodes: [
        { id: 'injectNode2', type: 'inject', intervalMs: 30 }, // mountScreen enforces a 100ms floor regardless — see the wait below
        { id: 'injectFn', type: 'function', code: 'return {properties: {text: "TICK-" + msg.payload}};' },
        { id: 'injectUpd', type: 'ui-update', compId: 'sink3', config: {} }
      ],
      wires: [
        { id: 'w1', from: 'injectNode2', to: 'injectFn' },
        { id: 'w2', from: 'injectFn', to: 'injectUpd' }
      ]
    }
  };
  eval(fs.readFileSync(process.argv[3], 'utf8'));
  const sink3 = window.__NEXA_SCREEN__.components.find(c => c.id === 'sink3');
  await new Promise(resolve => setTimeout(resolve, 250)); // >= 2 ticks at the enforced 100ms floor
  console.log('Inject node fired on its own interval, without any ctx.emit/lifecycle trigger?', /^TICK-\d+$/.test(sink3.props.text), '(actual: ' + JSON.stringify(sink3.props.text) + ')');

  console.log('--- Layer Control node: 3-state layers reconciled live on a deployed page (no re-mount pass to rely on, unlike the editor) ---');
  const artboard6 = makeEl('div');
  global.document.getElementById = (id) => id === 'nexa-runtime-artboard' ? artboard6 : null;
  window.__NEXA_SCREEN__ = {
    id: 's5', width: 400, height: 300,
    layers: [
      { id: 'default', name: 'Default', parentId: null, state: 'show' },
      { id: 'panel', name: 'Panel', parentId: null, state: 'show' }
    ],
    components: [
      { id: 'trigger', type: 'mock-button2', x: 0, y: 0, w: 50, h: 50, layerId: 'default', props: {} },
      { id: 'panelComp', type: 'mock-sink2', x: 100, y: 0, w: 50, h: 50, layerId: 'panel', props: {} }
    ],
    logic: {
      nodes: [
        { id: 'evtHide', type: 'ui-event', compId: 'trigger', event: 'hidePanel' },
        { id: 'lcHide', type: 'layer-control', states: [{ name: 'Panel', state: 'hide' }] },
        { id: 'evtRemove', type: 'ui-event', compId: 'trigger', event: 'removePanel' },
        { id: 'lcRemove', type: 'layer-control', states: [{ name: 'Panel', state: 'remove' }] },
        { id: 'evtShow', type: 'ui-event', compId: 'trigger', event: 'showPanel' },
        { id: 'lcShow', type: 'layer-control', states: [{ name: 'Panel', state: 'show' }] }
      ],
      wires: [
        { id: 'w1', from: 'evtHide', to: 'lcHide' },
        { id: 'w2', from: 'evtRemove', to: 'lcRemove' },
        { id: 'w3', from: 'evtShow', to: 'lcShow' }
      ]
    }
  };
  eval(fs.readFileSync(process.argv[3], 'utf8'));

  function panelEl() { return artboard6.children.find(e => e.attrs['data-id'] === 'panelComp'); }
  console.log('initially mounted (state "show")?', !!panelEl() && panelEl().style.display === '');

  lastCtx.emit('hidePanel', null);
  console.log('"hide": still mounted (not torn down)?', !!panelEl());
  console.log('"hide": display is "none"?', panelEl() && panelEl().style.display === 'none');

  lastCtx.emit('removePanel', null);
  console.log('"remove": DOM node actually torn out?', !panelEl());

  lastCtx.emit('showPanel', null);
  console.log('back to "show": freshly re-mounted?', !!panelEl() && panelEl().style.display === '');

  console.log('ALL OK');
  // The Inject nodes started above are real setInterval timers that are
  // never cleared (same as a real deployed page — they're meant to run for
  // the page's whole lifetime); the caller (the outer async IIFE above)
  // calls process.exit(0) right after this resolves, or the process would
  // hang forever instead of exiting once the test itself is done.
}
