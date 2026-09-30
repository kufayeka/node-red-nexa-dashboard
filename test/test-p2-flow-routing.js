// Test suite for P2 Phase 2: Frontend Routing Pipeline & Screen Flows as Public Gateway
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
  title: 'Initial Title',
  cookie: 'auth_token=jwt_xyz123; user_role=operator; tracking_id=track_999; other=skip_me'
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
  pathname: '/nexa/',
  href: 'http://localhost:1881/nexa/',
  search: '?view=compact&sort=asc',
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
  }
};

global.navigator = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
  language: 'en-US',
  platform: 'Win32',
  onLine: true
};

global.innerWidth = 1280;
global.innerHeight = 800;

// Setup Nexa Global State
const screenTarget = {
  id: 'screen_target',
  name: 'Target Screen View',
  width: 1024,
  height: 768,
  path: '/target-view',
  components: [
    { id: 'c_title', type: 'text', name: 'Title', x: 20, y: 20, w: 200, h: 40, props: { text: 'Welcome' } }
  ],
  logic: {
    nodes: [
      { id: 'n_target_onload', type: 'onload', x: 50, y: 50 }
    ],
    wires: []
  }
};

const screenFallback = {
  id: 'screen_fallback',
  name: 'Fallback Screen',
  width: 1024,
  height: 768,
  path: '/direct-screen',
  components: [],
  logic: { nodes: [], wires: [] }
};

let middlewareExecuted = false;
let capturedMsg = null;

const flowRoute = {
  id: 'flow_device_route',
  name: 'Device Router Flow',
  logic: {
    nodes: [
      { id: 'n_route', type: 'route-trigger', path: '/device/:id', cookies: 'auth_token, user_role', includeDevice: true, x: 20, y: 20 },
      {
        id: 'n_middleware', type: 'function',
        code: 'msg.middlewarePassed = true; msg.authOk = msg.cookies.auth_token === "jwt_xyz123"; return msg;',
        x: 150, y: 20
      },
      { id: 'n_delay', type: 'delay', delay: 30, unit: 'ms', x: 280, y: 20 },
      { id: 'n_goto', type: 'navigate', mode: 'screen', screenId: 'screen_target', forwardPayload: true, x: 420, y: 20 }
    ],
    wires: [
      { from: 'n_route', to: 'n_middleware' },
      { from: 'n_middleware', to: 'n_delay' },
      { from: 'n_delay', to: 'n_goto' }
    ]
  }
};

global.__NEXA_SCREEN__ = screenFallback;
global.__NEXA_SCREENS__ = [screenFallback, screenTarget];
global.__NEXA_FLOWS__ = [flowRoute];
global.__NEXA_TEMPLATES__ = [];
global.__NEXA_APP__ = { variables: [], breakpoints: [], theme: null };
global.__NEXA_ASSETS__ = [];
global.__NEXA_PARAMS__ = {};
global.__NEXA_QUERY__ = { view: 'compact', sort: 'asc' };
global.__NEXA_RUNTIME_PREFIX__ = '/nexa';
global.__NEXA_CLIENT_IP__ = '192.168.1.100';

// Load registry and model clients
eval(fs.readFileSync(path.join(__dirname, '../lib/nexa-registry-client.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../lib/nexa-model-client.js'), 'utf8'));

// Register mock component
NEXA.registerComponent('text', {
  render: function (el, props) {
    el.textContent = props.text || 'Text';
  }
});

// Load the runtime client script
const runtimeClientCode = fs.readFileSync(path.join(__dirname, '../lib/nexa-runtime-client.js'), 'utf8');
eval(runtimeClientCode);

async function runTests() {
  console.log('--- [P2 Phase 2] 1. Device Context Extraction ---');
  // Desktop test (w = 1280)
  global.innerWidth = 1280;
  global.innerHeight = 800;
  let devDesktop = global.__nexaRuntime.extractDeviceContext();
  assert.strictEqual(devDesktop.type, 'desktop');
  assert.strictEqual(devDesktop.screen.width, 1280);
  assert.strictEqual(devDesktop.screen.height, 800);
  assert.strictEqual(devDesktop.screen.orientation, 'landscape');
  assert.strictEqual(devDesktop.ip, '192.168.1.100');
  console.log('Desktop device context verified? true');

  // Tablet test (w = 800)
  global.innerWidth = 800;
  global.innerHeight = 1000;
  let devTablet = global.__nexaRuntime.extractDeviceContext();
  assert.strictEqual(devTablet.type, 'tablet');
  assert.strictEqual(devTablet.screen.orientation, 'portrait');
  console.log('Tablet device context verified? true');

  // Mobile test (w = 375)
  global.innerWidth = 375;
  global.innerHeight = 667;
  let devMobile = global.__nexaRuntime.extractDeviceContext();
  assert.strictEqual(devMobile.type, 'mobile');
  assert.strictEqual(devMobile.screen.orientation, 'portrait');
  console.log('Mobile device context verified? true');

  console.log('--- [P2 Phase 2] 2. Selective Cookie Extraction ---');
  // Only requested keys
  let cookiesSelected = global.__nexaRuntime.extractCookies('auth_token, user_role');
  assert.strictEqual(cookiesSelected.auth_token, 'jwt_xyz123');
  assert.strictEqual(cookiesSelected.user_role, 'operator');
  assert.strictEqual(cookiesSelected.tracking_id, undefined);
  assert.strictEqual(cookiesSelected.other, undefined);
  console.log('Selective cookies extracted correctly? true');

  // All keys with wildcard *
  let cookiesAll = global.__nexaRuntime.extractCookies('*');
  assert.strictEqual(cookiesAll.auth_token, 'jwt_xyz123');
  assert.strictEqual(cookiesAll.tracking_id, 'track_999');
  assert.strictEqual(cookiesAll.other, 'skip_me');
  console.log('Wildcard cookies extracted correctly? true');

  // Empty string returns {}
  let cookiesNone = global.__nexaRuntime.extractCookies('');
  assert.deepStrictEqual(cookiesNone, {});
  console.log('Empty selective list returns empty object? true');

  console.log('--- [P2 Phase 2] 3. Flow Route Trigger Matching & Scratch Middleware ---');
  // Match route /device/42
  let match = global.__nexaRuntime.findFlowForRoute('/device/42');
  assert.ok(match, 'Flow should be found for route /device/42');
  assert.strictEqual(match.flow.id, 'flow_device_route');
  assert.strictEqual(match.params.id, '42');
  console.log('findFlowForRoute matched /device/42 with params.id = 42? true');

  // Execute the flow via matchFlowAndExecute
  global.innerWidth = 1280;
  global.innerHeight = 800;
  let executed = global.__nexaRuntime.matchFlowAndExecute('/device/42');
  assert.strictEqual(executed, true, 'Flow should be executed');

  // Wait for the Delay node (30ms) in the middleware to finish and trigger Goto Screen
  await new Promise(r => setTimeout(r, 60));

  // Verify that Screen Target is now mounted in artboard
  assert.strictEqual(document.title, 'Target Screen View', 'Target screen title should be set');
  assert.ok(artboard.children.length > 0, 'Target screen components should be mounted');
  console.log('Flow scratch middleware (Function -> Delay -> Goto Screen) mounted target screen? true');
  console.log('Target screen mounted in artboard? true');

  console.log('--- [P2 Phase 2] 4. Navigation Through Flow Gateway ---');
  // Navigate via URL targeting flow route
  let navResult = global.__nexaRuntime.navigateToScreen('/device/99');
  assert.strictEqual(navResult, true);
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(global.__NEXA_PARAMS__.id, '99');
  console.log('navigateToScreen("/device/99") intercepted by Flow Gateway? true');

  console.log('--- [P2 Phase 2] 5. Direct Screen Fallback ---');
  // Navigate to screen path that has no flow
  let directResult = global.__nexaRuntime.navigateToScreen('/direct-screen');
  assert.strictEqual(directResult, true);
  assert.strictEqual(document.title, 'Fallback Screen');
  console.log('Direct screen navigation fallback works when no flow matches? true');

  console.log('--- [P2 Phase 2] 6. Combined Flow Endpoint & Route Trigger Matching ---');
  const flowWithEndpoint = {
    id: 'flow_user_custom',
    name: 'Flow 1',
    endpoint: '/flow1',
    logic: {
      nodes: [
        { id: 'n_trig', type: 'route-trigger', path: '/test1', x: 20, y: 20 }
      ],
      wires: []
    }
  };
  global.__NEXA_FLOWS__.push(flowWithEndpoint);

  // Should match combined path /flow1/test1
  let matchCombined = global.__nexaRuntime.findFlowForRoute('/flow1/test1');
  assert.ok(matchCombined, 'Flow should match combined path /flow1/test1');
  assert.strictEqual(matchCombined.flow.id, 'flow_user_custom');

  // Should match node path /test1
  let matchNodePath = global.__nexaRuntime.findFlowForRoute('/test1');
  assert.ok(matchNodePath, 'Flow should match trigger path /test1');

  // Should match flow endpoint /flow1
  let matchEndpoint = global.__nexaRuntime.findFlowForRoute('/flow1');
  assert.ok(matchEndpoint, 'Flow should match flow endpoint /flow1');
  console.log('Combined flow endpoint (/flow1/test1, /flow1, /test1) matches correctly? true');

  console.log('ALL OK');
  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
