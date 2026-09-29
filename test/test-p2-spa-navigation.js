// Test suite for P2 Phase 1: Delay Node & Goto Screen (SPA Navigation)
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Setup DOM Mock for Nexa Runtime
const elements = [];
function makeEl(tag) {
  const el = {
    tag: tag, style: {}, children: [], attrs: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    insertBefore(child, ref) { child.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, child); },
    removeChild(child) {
      child.parentNode = null;
      this.children = this.children.filter(c => c !== child);
      var idx = elements.indexOf(child);
      if (idx !== -1) elements.splice(idx, 1);
    },
    querySelector(sel) {
      const m = /\[data-id="([^"]+)"\]/.exec(sel);
      if (m) return elements.find(e => e.attrs['data-id'] === m[1]) || null;
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

const eventListeners = {};
global.document = {
  createElement(tag) { return makeEl(tag); },
  getElementById(id) { return id === 'nexa-runtime-artboard' ? artboard : null; },
  querySelector(sel) {
    const m = /\[data-id="([^"]+)"\]/.exec(sel);
    return m ? (elements.find(e => e.attrs['data-id'] === m[1]) || null) : null;
  },
  querySelectorAll() { return []; },
  title: 'Initial Title'
};

global.window = global;
global.console = console;

const historyStack = [];
let historyIndex = -1;
global.addEventListener = function (evt, fn) {
  eventListeners[evt] = eventListeners[evt] || [];
  eventListeners[evt].push(fn);
};
global.dispatchEvent = function (evt) {
  (eventListeners[evt.type] || []).forEach(fn => fn(evt));
};
global.location = {
  protocol: 'http:',
  host: 'localhost:1881',
  pathname: '/nexa/overview',
  href: 'http://localhost:1881/nexa/overview',
  reload: function () { throw new Error('SPA should not call location.reload()'); }
};
global.history = {
  state: null,
  pushState(state, title, url) {
    historyStack.push({ state: state, title: title, url: url });
    historyIndex = historyStack.length - 1;
    this.state = state;
    global.location.pathname = url;
    global.location.href = 'http://localhost:1881' + url;
  },
  replaceState(state, title, url) {
    if (historyIndex >= 0) historyStack[historyIndex] = { state: state, title: title, url: url };
    else { historyStack.push({ state: state, title: title, url: url }); historyIndex = 0; }
    this.state = state;
    global.location.pathname = url;
    global.location.href = 'http://localhost:1881' + url;
  },
  back() {
    if (historyIndex > 0) {
      historyIndex--;
      const item = historyStack[historyIndex];
      this.state = item.state;
      global.location.pathname = item.url;
      global.location.href = 'http://localhost:1881' + item.url;
      global.dispatchEvent({ type: 'popstate', state: item.state });
    }
  },
  forward() {
    if (historyIndex < historyStack.length - 1) {
      historyIndex++;
      const item = historyStack[historyIndex];
      this.state = item.state;
      global.location.pathname = item.url;
      global.location.href = 'http://localhost:1881' + item.url;
      global.dispatchEvent({ type: 'popstate', state: item.state });
    }
  }
};

// 2. Load registry client
eval(fs.readFileSync(path.join(__dirname, '../lib/nexa-registry-client.js'), 'utf8'));

// Register mock test components
NEXA.registerComponent('nexa-box', {
  render: function (el, props, ctx) {
    el.style.backgroundColor = props.color || '#333';
    el.__ctx = ctx;
  }
});
NEXA.registerComponent('nexa-label', {
  render: function (el, props) {
    el.textContent = props.text || '';
  }
});

// 3. Define screens in the project (migrated surface / treeVersion: 1)
const { migrateSurface } = require('../lib/nexa-model.js');

const screen1 = {
  id: 'screen1',
  name: 'Overview Screen',
  path: '/overview',
  width: 800,
  height: 600,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    { id: 'box1', type: 'nexa-box', x: 10, y: 10, w: 100, h: 100, rotation: 0, locked: false, layerId: 'default', props: { color: 'blue' } },
    { id: 'btnNav', type: 'nexa-box', x: 200, y: 200, w: 100, h: 50, rotation: 0, locked: false, layerId: 'default', props: { color: 'green' } }
  ],
  logic: {
    nodes: [
      { id: 'onload1', type: 'onload' },
      { id: 'onclose1', type: 'onclose' },
      { id: 'fnCloseTracker', type: 'function', code: 'window.__SCREEN1_CLOSED__ = true; return msg;' },
      { id: 'evtClick', type: 'ui-event', compId: 'btnNav', event: 'click' },
      { id: 'delayNode', type: 'delay', delay: 40, unit: 'ms' },
      { id: 'navToScreen2', type: 'navigate', mode: 'screen', screenId: 'screen2', forwardPayload: true }
    ],
    wires: [
      { from: 'onclose1', to: 'fnCloseTracker' },
      { from: 'evtClick', to: 'delayNode' },
      { from: 'delayNode', to: 'navToScreen2' }
    ]
  }
};

const screen2 = {
  id: 'screen2',
  name: 'Device Detail Screen',
  path: '/device/:id',
  width: 1024,
  height: 768,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    { id: 'lblDetail', type: 'nexa-label', x: 20, y: 20, w: 300, h: 40, rotation: 0, locked: false, layerId: 'default', props: { text: 'Device Detail' } }
  ],
  logic: {
    nodes: [
      { id: 'onload2', type: 'onload' },
      { id: 'fnCapturePayload', type: 'function', code: 'window.__SCREEN2_LOAD_PAYLOAD__ = msg.payload; return msg;' },
      { id: 'fnUpdateLabel', type: 'ui-update', compId: 'lblDetail', config: { text: 'msg.payload.deviceName' } }
    ],
    wires: [
      { from: 'onload2', to: 'fnCapturePayload' }
    ]
  }
};

migrateSurface(screen1);
migrateSurface(screen2);

window.__NEXA_SCREEN__ = screen1;
window.__NEXA_SCREENS__ = [screen1, screen2];
window.__NEXA_TEMPLATES__ = [];
window.__NEXA_APP__ = { variables: [] };

// Mock WebSocket to verify connection persistence across SPA navigation
let wsInstances = [];
let wsSentMessages = [];
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.binaryType = 'arraybuffer';
    wsInstances.push(this);
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 5);
  }
  send(data) {
    wsSentMessages.push(data);
  }
  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
}
global.WebSocket = MockWebSocket;

// Load runtime client
eval(fs.readFileSync(path.join(__dirname, '../lib/nexa-runtime-client.js'), 'utf8'));

async function runTests() {
  console.log('--- [P2 Phase 1] 1. Initial Screen Mount ---');
  assert.strictEqual(artboard.children.length, 2, 'Screen1 should mount 2 components');
  console.log('Screen1 initially mounted on artboard?', true);
  console.log('WebSocket instance created once?', wsInstances.length === 1);
  const initialWs = wsInstances[0];

  console.log('--- [P2 Phase 1] 2. Delay Node Timing & Execution ---');
  const testPayload = { deviceName: 'Pump-101', temp: 85.5 };

  const runtime = window.__nexaRuntime;
  assert.ok(runtime, 'window.__nexaRuntime should be exported');
  assert.ok(typeof runtime.navigateToScreen === 'function', 'runtime.navigateToScreen should exist');

  const btn = document.querySelector('[data-id="btnNav"]');
  assert.ok(btn && btn.__ctx, 'btnNav element should exist with runtime ctx');
  assert.strictEqual(window.__SCREEN1_CLOSED__, undefined, 'Screen1 onclose should not have fired yet');

  // Trigger click on btnNav (wires to delayNode 40ms -> navToScreen2)
  btn.__ctx.emit('click', testPayload);

  // After 10ms, delay is still waiting, so screen1 is not closed yet
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(window.__SCREEN1_CLOSED__, undefined, 'Screen1 should not be closed at 10ms (Delay is 40ms)');
  console.log('Delay node paused execution before navigation?', true);

  // Wait for delay (40ms total) + navigation dispatch
  await new Promise(r => setTimeout(r, 60));
  console.log('--- [P2 Phase 1] 3. SPA Goto Screen Navigation ---');
  assert.strictEqual(window.__SCREEN1_CLOSED__, true, 'Screen1 onclose fired after delay completed');
  console.log('Delay completed and triggered SPA Goto Screen?', true);

  // Verify Screen 1 dismounted and onclose fired
  assert.strictEqual(window.__SCREEN1_CLOSED__, true, 'Screen1 onclose fired upon SPA transition');
  console.log('Screen1 onclose fired on SPA transition?', true);

  // Verify Artboard replaced with Screen 2 without page reload
  assert.strictEqual(artboard.children.length, 1, 'Screen2 should have 1 component mounted on artboard');
  const lblDetail = document.querySelector('[data-id="lblDetail"]');
  assert.ok(lblDetail, 'Screen2 lblDetail element should be mounted on artboard');
  console.log('Screen2 mounted on artboard in SPA mode?', true);

  // Verify forwardPayload delivered to Screen 2 onload
  await new Promise(r => setTimeout(r, 60));
  assert.deepStrictEqual(window.__SCREEN2_LOAD_PAYLOAD__, testPayload, 'Screen2 onload should receive forwarded payload');
  console.log('forwardPayload delivered into Screen2 onload?', true);

  // Verify URL updated in history without reload
  assert.strictEqual(window.location.pathname, '/nexa/device/:id', 'History pathname updated');
  console.log('History URL updated to /nexa/device/:id?', true);

  // Verify Persistent WebSocket Connection
  assert.strictEqual(wsInstances.length, 1, 'No new WebSocket should be created (existing connection preserved)');
  assert.strictEqual(initialWs.readyState, 1, 'Initial WebSocket remains OPEN');
  console.log('WebSocket & Sparkplug connection remained alive & unchanged?', true);

  console.log('--- [P2 Phase 1] 4. Dynamic Route Pattern Parameter Matching ---');
  // Navigate using path with dynamic parameter: /device/42
  const navDynamic = runtime.navigateToScreen('/device/42', { deviceName: 'Motor-42' });
  assert.strictEqual(navDynamic, true, 'Navigation to /device/42 should match screen2 route');
  assert.deepStrictEqual(window.__NEXA_PARAMS__, { id: '42' }, 'window.__NEXA_PARAMS__ should extract :id parameter');
  console.log('Route /device/42 extracted param { id: "42" }?', true);

  console.log('--- [P2 Phase 1] 5. Browser History Back / Forward (Popstate) ---');
  // Currently at /device/42. Let's push navigation to screen1
  runtime.navigateToScreen('screen1');
  assert.strictEqual(artboard.children.length, 2, 'Navigating to screen1 mounts 2 components');

  // Now test window.history.back()
  window.history.back();
  assert.strictEqual(artboard.children.length, 1, 'window.history.back() navigated to screen2 in SPA mode');
  console.log('window.history.back() restores previous screen without reload?', true);

  console.log('ALL OK');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
