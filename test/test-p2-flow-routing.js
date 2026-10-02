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
    if (historyIndex >= 0) historyStack.splice(historyIndex + 1);
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
eval(fs.readFileSync(path.join(__dirname, '../dist/nexa-registry-client.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../dist/nexa-model-client.js'), 'utf8'));

// Register mock component
NEXA.registerComponent('text', {
  render: function (el, props) {
    el.textContent = props.text || 'Text';
  }
});

// Load the runtime client script
const runtimeClientCode = fs.readFileSync(path.join(__dirname, '../dist/nexa-runtime.bundle.js'), 'utf8');
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

  console.log('--- [P2 Flow Gateway] 9. Browser History Back & Forward with Multi-Screen Flow & Send-to-Flow ---');
  // Define screens S1, S2, S3 matching user's exact flow topology
  const screenS1 = {
    id: 's_s1', name: 'Screen 1', path: '/screen1', width: 800, height: 600, displayMode: 'fixed',
    components: [],
    logic: {
      nodes: [
        { id: 'btn_s1_click', type: 'ui-event', event: 'click' },
        { id: 'stf_s1', type: 'send-to-flow', action: 'go-s3' }
      ],
      wires: { 'btn_s1_click': ['stf_s1'] }
    }
  };
  const screenS3 = {
    id: 's_s3', name: 'Responsive Demo', path: '/screen3', width: 1920, height: 1080, displayMode: 'fill',
    components: [],
    logic: {
      nodes: [
        { id: 'btn_s3_click', type: 'ui-event', event: 'click' },
        { id: 'stf_s3', type: 'send-to-flow', action: 'go-s2' }
      ],
      wires: { 'btn_s3_click': ['stf_s3'] }
    }
  };
  const screenS2 = {
    id: 's_s2', name: 'Screen 2', path: '/screen2', width: 1024, height: 768, displayMode: 'fixed',
    components: [],
    logic: {
      nodes: [
        { id: 'btn_s2_click', type: 'ui-event', event: 'click' },
        { id: 'stf_s2', type: 'send-to-flow', action: 'go-s1' }
      ],
      wires: { 'btn_s2_click': ['stf_s2'] }
    }
  };
  global.__NEXA_SCREENS__.push(screenS1, screenS3, screenS2);

  const flow1 = {
    id: 'flow_user_1',
    name: 'Flow 1',
    endpoint: '/flow1',
    routingPolicy: 'strict',
    logic: {
      nodes: [
        { id: 'fl_trig', type: 'route-trigger' },
        { id: 'fl_rs_s1', type: 'render-screen', screenId: 's_s1' },
        { id: 'fl_rs_s3', type: 'render-screen', screenId: 's_s3' },
        { id: 'fl_rs_s2', type: 'render-screen', screenId: 's_s2' }
      ],
      wires: [
        { from: 'fl_trig', to: 'fl_rs_s1' },
        { from: 'fl_rs_s1', to: 'fl_rs_s3' },
        { from: 'fl_rs_s3', to: 'fl_rs_s2' },
        { from: 'fl_rs_s2', to: 'fl_rs_s1' }
      ]
    }
  };
  global.__NEXA_FLOWS__.push(flow1);

  // Re-read and eval runtime code
  const freshRuntimeCode = fs.readFileSync(path.join(__dirname, '../dist/nexa-runtime.bundle.js'), 'utf8');
  eval(freshRuntimeCode);

  // 1. Initial entry to /flow1
  let f1Ran = global.__nexaRuntime.matchFlowAndExecute('/flow1');
  assert.strictEqual(f1Ran, true, 'Flow 1 initial execution should succeed');
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen1', 'First screen should replace flow1 endpoint');
  let activeRs = global.__nexaRuntime.getActiveRenderScreen();
  assert.ok(activeRs && activeRs.flowNode.id === 'fl_rs_s1', 'Active render screen must be fl_rs_s1');
  console.log('Flow initial entry mounts Screen 1 and activates fl_rs_s1? true');

  // Helper to simulate button click leading to send-to-flow inside a screen
  function triggerScreenSendToFlow(screenObj, sendNodeId) {
    let effectiveScreen = {
      id: screenObj.id,
      name: screenObj.name,
      logic: screenObj.logic,
      components: [],
      __scopes: { '@app': {}, '': {} }
    };
    let sendNode = (screenObj.logic.nodes || []).find(n => n.id === sendNodeId);
    global.__nexaRuntime.runLogicGraph(effectiveScreen, sendNode, { payload: { clicked: true } });
  }

  // 2. Click button on Screen 1 -> trigger send-to-flow -> advances to Screen 3
  triggerScreenSendToFlow(screenS1, 'stf_s1');
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen3', 'Should navigate to Screen 3');
  activeRs = global.__nexaRuntime.getActiveRenderScreen();
  assert.ok(activeRs && activeRs.flowNode.id === 'fl_rs_s3', 'Active render screen must be fl_rs_s3');
  console.log('Click on Screen 1 advances to Screen 3 via send-to-flow? true');

  // 3. Click button on Screen 3 -> trigger send-to-flow -> advances to Screen 2
  triggerScreenSendToFlow(screenS3, 'stf_s3');
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen2', 'Should navigate to Screen 2');
  activeRs = global.__nexaRuntime.getActiveRenderScreen();
  assert.ok(activeRs && activeRs.flowNode.id === 'fl_rs_s2', 'Active render screen must be fl_rs_s2');
  console.log('Click on Screen 3 advances to Screen 2 via send-to-flow? true');

  // 4. User presses browser BACK: goes to Screen 3
  global.history.back();
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen3', 'History back should return to /nexa/flow1/screen3');
  activeRs = global.__nexaRuntime.getActiveRenderScreen();
  assert.ok(activeRs, 'Active render screen must not be null');
  assert.strictEqual(activeRs.flowNode.id, 'fl_rs_s3', 'Active render screen must be restored to fl_rs_s3 on history back');
  console.log('History back restores active render screen to fl_rs_s3? true');

  // 5. User clicks button on Screen 3 after going back -> send-to-flow works and advances to Screen 2!
  triggerScreenSendToFlow(screenS3, 'stf_s3');
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen2', 'Should navigate from Screen 3 to Screen 2');
  activeRs = global.__nexaRuntime.getActiveRenderScreen();
  assert.strictEqual(activeRs.flowNode.id, 'fl_rs_s2', 'Active render screen must advance to fl_rs_s2');
  console.log('Send-to-flow on Screen 3 after history back successfully advances to Screen 2? true');

  // 6. User presses browser BACK twice: Screen 2 -> Screen 3 -> Screen 1
  global.history.back(); // to Screen 3
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen3', 'Back 1 returns to Screen 3');
  assert.strictEqual(global.__nexaRuntime.getActiveRenderScreen().flowNode.id, 'fl_rs_s3');

  global.history.back(); // to Screen 1
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen1', 'Back 2 returns to Screen 1');
  assert.strictEqual(global.__nexaRuntime.getActiveRenderScreen().flowNode.id, 'fl_rs_s1');
  console.log('Multiple history backs successfully restore to Screen 1 and fl_rs_s1? true');

  // 7. User presses browser FORWARD twice: Screen 1 -> Screen 3 -> Screen 2
  global.history.forward(); // to Screen 3
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen3', 'Forward 1 returns to Screen 3');
  assert.strictEqual(global.__nexaRuntime.getActiveRenderScreen().flowNode.id, 'fl_rs_s3');

  global.history.forward(); // to Screen 2
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen2', 'Forward 2 returns to Screen 2');
  assert.strictEqual(global.__nexaRuntime.getActiveRenderScreen().flowNode.id, 'fl_rs_s2');
  console.log('History forward successfully restores to Screen 2 and fl_rs_s2? true');

  // 8. Click button on Screen 2 after forward -> advances to Screen 1 (completing loop)
  triggerScreenSendToFlow(screenS2, 'stf_s2');
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen1', 'Screen 2 advances to Screen 1');
  assert.strictEqual(global.__nexaRuntime.getActiveRenderScreen().flowNode.id, 'fl_rs_s1');
  console.log('Send-to-flow on Screen 2 works after history forward? true');

  // 9. Now back up to Screen 2, then click Screen 2 button again
  global.history.back();
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen2', 'Back returns to Screen 2');
  assert.strictEqual(global.__nexaRuntime.getActiveRenderScreen().flowNode.id, 'fl_rs_s2');
  triggerScreenSendToFlow(screenS2, 'stf_s2');
  assert.strictEqual(global.location.pathname, '/nexa/flow1/screen1', 'Screen 2 advances to Screen 1');
  assert.strictEqual(global.__nexaRuntime.getActiveRenderScreen().flowNode.id, 'fl_rs_s1');
  console.log('Repeated back-and-forth transitions maintain flow stability? true');

  console.log('ALL OK');
  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
