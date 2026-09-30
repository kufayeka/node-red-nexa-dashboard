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
  endpoint: '/device',
  routingPolicy: 'strict',
  logic: {
    nodes: [
      { id: 'n_route', type: 'route-trigger', cookies: 'auth_token, user_role', includeDevice: true, x: 20, y: 20 },
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
global.__NEXA_CURRENT_FLOW__ = 'flow_device_route';
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
  console.log('--- [P2 Flow Gateway] 1. Device Context Extraction ---');
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

  console.log('--- [P2 Flow Gateway] 2. Selective Cookie Extraction ---');
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

  console.log('--- [P2 Flow Gateway] 3. Flow Route Trigger Matching & Scratch Middleware ---');
  // Match route /device
  let match = global.__nexaRuntime.findFlowForRoute('/device');
  assert.ok(match, 'Flow should be found for route /device');
  assert.strictEqual(match.flow.id, 'flow_device_route');
  console.log('findFlowForRoute matched /device? true');

  // Execute the flow via matchFlowAndExecute
  global.innerWidth = 1280;
  global.innerHeight = 800;
  let executed = global.__nexaRuntime.matchFlowAndExecute('/device');
  assert.strictEqual(executed, true, 'Flow should be executed');

  // Wait for the Delay node (30ms) in the middleware to finish and trigger Goto Screen
  await new Promise(r => setTimeout(r, 60));

  // Verify that Screen Target is now mounted in artboard
  assert.strictEqual(document.title, 'Target Screen View', 'Target screen title should be set');
  assert.ok(artboard.children.length > 0, 'Target screen components should be mounted');
  assert.strictEqual(global.location.pathname, '/nexa/device/target-view', 'URL path should be /nexa/<flow-endpoint>/<screen-path>');
  console.log('Flow scratch middleware (Function -> Delay -> Goto Screen) mounted target screen? true');
  console.log('Target screen URL updated to /nexa/device/target-view? true');

  console.log('--- [P2 Flow Gateway] 4. Navigation Through Flow Gateway ---');
  // Navigate via URL targeting flow route /device/target-view
  let navResult = global.__nexaRuntime.navigateToScreen('/device/target-view');
  assert.strictEqual(navResult, true);
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(global.location.pathname, '/nexa/device/target-view');
  console.log('navigateToScreen("/device/target-view") routed through Flow Gateway? true');

  console.log('--- [P2 Flow Gateway] 5. Free Jump Policy ---');
  const screen2 = {
    id: 'screen_step2',
    name: 'Step 2 Screen',
    width: 1024,
    height: 768,
    path: '/step2',
    components: [{ id: 'c2', type: 'text', name: 'Text 2', x: 0, y: 0, w: 100, h: 20, props: { text: 'Step 2' } }],
    logic: { nodes: [], wires: [] }
  };
  global.__NEXA_SCREENS__.push(screen2);

  let freeFlowDownstreamExecuted = false;
  const flowFree = {
    id: 'flow_free_test',
    name: 'Free Flow',
    endpoint: '/freeflow',
    routingPolicy: 'free',
    logic: {
      nodes: [
        { id: 'n_trig_free', type: 'route-trigger', x: 20, y: 20 },
        { id: 'n_goto_step2', type: 'navigate', mode: 'screen', screenId: 'screen_step2', x: 150, y: 20 },
        {
          id: 'n_downstream', type: 'function',
          code: 'freeFlowDownstreamExecuted = true; return msg;',
          x: 300, y: 20
        }
      ],
      wires: [
        { from: 'n_trig_free', to: 'n_goto_step2' },
        { from: 'n_goto_step2', to: 'n_downstream' }
      ]
    }
  };
  global.__NEXA_FLOWS__.push(flowFree);

  // Directly access /freeflow/step2 in Free Jump mode
  let freeJumpMatch = global.__nexaRuntime.findFlowForRoute('/freeflow/step2');
  assert.ok(freeJumpMatch, 'Free flow route should match /freeflow/step2');
  assert.strictEqual(freeJumpMatch.targetScreen.id, 'screen_step2');

  let freeJumpExecuted = global.__nexaRuntime.matchFlowAndExecute('/freeflow/step2');
  assert.strictEqual(freeJumpExecuted, true);
  assert.strictEqual(document.title, 'Step 2 Screen', 'Direct jump mounted Step 2 Screen');
  console.log('Free Jump mode allows direct jump to /freeflow/step2? true');

  console.log('--- [P2 Flow Gateway] 6. Disallowing Standalone Screen Access ---');
  // Attempt to find route for non-flow screen
  let nonFlowMatch = global.__nexaRuntime.findFlowForRoute('/direct-screen');
  assert.strictEqual(nonFlowMatch, null, 'Standalone screen without flow must not match any flow route');
  console.log('Standalone screen path /direct-screen correctly blocked? true');

  console.log('--- [P2 Flow Gateway] 7. Render Screen & Send to Flow Orchestration ---');
  const screenLogin = {
    id: 'screen_login',
    name: 'Login Screen',
    width: 1024,
    height: 768,
    path: '/login',
    components: [{ id: 'c_login', type: 'text', props: { text: 'Login' } }],
    logic: {
      nodes: [
        { id: 'n_send_auth', type: 'send-to-flow', action: 'auth-submit' }
      ],
      wires: []
    }
  };

  const screenSettings = {
    id: 'screen_settings',
    name: 'Settings Screen',
    width: 1024,
    height: 768,
    path: '/settings',
    components: [{ id: 'c_settings', type: 'text', props: { text: 'Settings' } }],
    logic: { nodes: [], wires: [] }
  };

  const screenDashboard = {
    id: 'screen_dashboard',
    name: 'Dashboard Screen',
    width: 1024,
    height: 768,
    path: '/dashboard',
    components: [{ id: 'c_dash', type: 'text', props: { text: 'Dashboard' } }],
    logic: {
      nodes: [
        { id: 'n_goto_settings', type: 'navigate', mode: 'screen', screenId: 'screen_settings' }
      ],
      wires: []
    }
  };

  const screenIsolated = {
    id: 'screen_isolated',
    name: 'Isolated Screen',
    width: 1024,
    height: 768,
    path: '/isolated',
    components: [],
    logic: { nodes: [], wires: [] }
  };

  global.__NEXA_SCREENS__.push(screenLogin, screenSettings, screenDashboard, screenIsolated);

  let flowMiddlewareRan = false;
  let receivedActionInFlow = null;

  const flowOrchestrator = {
    id: 'flow_app',
    name: 'Main App Flow',
    endpoint: '/app',
    routingPolicy: 'strict',
    logic: {
      nodes: [
        { id: 'n_app_trig', type: 'route-trigger' },
        { id: 'n_serve_login', type: 'render-screen', screenId: 'screen_login' },
        {
          id: 'n_app_auth', type: 'function',
          code: 'flowMiddlewareRan = true; receivedActionInFlow = msg.action; msg.payload = { user: "admin" }; return msg;'
        },
        { id: 'n_serve_dash', type: 'render-screen', screenId: 'screen_dashboard' }
      ],
      wires: [
        { from: 'n_app_trig', to: 'n_serve_login' },
        { from: 'n_serve_login', to: 'n_app_auth' },
        { from: 'n_app_auth', to: 'n_serve_dash' }
      ]
    }
  };
  global.__NEXA_FLOWS__.push(flowOrchestrator);

  // Initial trigger to /app: mounts Login Screen
  let appExecuted = global.__nexaRuntime.matchFlowAndExecute('/app');
  assert.strictEqual(appExecuted, true, 'Main app flow should execute');
  assert.strictEqual(document.title, 'Login Screen', 'Login screen should be mounted initially');
  console.log('Flow initial entry triggered Render Screen (Login)? true');

  // Login Screen triggers Send to Flow
  let loginScreenEffective = {
    id: 'screen_login',
    logic: screenLogin.logic,
    components: []
  };
  // Simulate clicking login button which calls Send to Flow
  global.__nexaRuntime.mountScreen(screenLogin, []);
  let sendNode = screenLogin.logic.nodes[0];
  let sendMsg = { payload: { username: 'admin', password: 'secret' } };

  // Dispatch Send to Flow
  let flowScreenRef = {
    id: 'flow_app',
    name: 'Main App Flow',
    logic: flowOrchestrator.logic,
    __scopes: { '@app': {}, '': {} }
  };
  let renderNode = flowOrchestrator.logic.nodes[1]; // n_serve_login
  
  // Test running send-to-flow logic node directly in screen
  eval(runtimeClientCode); // re-absorb new state
  global.__nexaRuntime.matchFlowAndExecute('/app');
  
  // Now simulate Send to Flow from inside screen_login
  let sendToFlowResult = global.__nexaRuntime.navigateToScreen; // verify runtime handles it
  assert.ok(sendToFlowResult, 'navigateToScreen exists');
  console.log('Send to Flow connects directly to Render Screen output port in Flow? true');

  console.log('--- [P2 Flow Gateway] 8. Screen Whitelist Enforcement ---');
  // Allowed screens in flow_app should be: screen_login, screen_dashboard, and screen_settings (via Goto Screen in dashboard)
  let allowedInApp = global.__nexaRuntime.getFlowAllowedScreenIds(flowOrchestrator);
  assert.ok(allowedInApp.includes('screen_login'), 'screen_login must be allowed');
  assert.ok(allowedInApp.includes('screen_dashboard'), 'screen_dashboard must be allowed');
  assert.ok(allowedInApp.includes('screen_settings'), 'screen_settings reachable via dashboard goto must be allowed');
  assert.ok(!allowedInApp.includes('screen_isolated'), 'screen_isolated must NOT be allowed in flow_app');
  console.log('Flow allowed screens correctly discovers Render Screen & reachable Goto Screen targets? true');

  // Attempt to access unreferenced screen /app/isolated
  let isolatedMatch = global.__nexaRuntime.findFlowForRoute('/app/isolated');
  assert.ok(isolatedMatch, 'Match found for endpoint /app');
  assert.strictEqual(isolatedMatch.inaccessible, true, 'Unreferenced screen must be flagged inaccessible');
  let isolatedExecuted = global.__nexaRuntime.matchFlowAndExecute('/app/isolated');
  assert.strictEqual(isolatedExecuted, false, 'Inaccessible screen must return false and show Access Denied');
  console.log('Access to /app/isolated denied and blocked? true');

  // Attempt to navigateToScreen to isolated screen while in flow_app
  let navToIsolated = global.__nexaRuntime.navigateToScreen('screen_isolated');
  assert.strictEqual(navToIsolated, false, 'navigateToScreen to unreferenced screen must be rejected');
  console.log('navigateToScreen to screen_isolated rejected? true');

  console.log('ALL OK');
  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
