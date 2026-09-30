// Test suite for Route Guards, Default Flow Root Redirect & Route Not Found Handler
const { EventEmitter } = require("events");
const http = require("http");
const assert = require("assert");

class FakeParentPort extends EventEmitter {
  constructor() { super(); this.posted = []; }
  postMessage(msg) { this.posted.push(msg); this.emit("message", msg); }
}

function loadWorker(workerData) {
  delete require.cache[require.resolve("../lib/screen-worker.js")];
  var parentPort = new FakeParentPort();
  var workerThreadsPath = require.resolve("worker_threads");
  var real = require.cache[workerThreadsPath];
  require.cache[workerThreadsPath] = {
    id: workerThreadsPath, filename: workerThreadsPath, loaded: true,
    exports: Object.assign({}, real ? real.exports : {}, { parentPort: parentPort, workerData: workerData })
  };
  require("../lib/screen-worker.js");
  if (real) require.cache[workerThreadsPath] = real;
  else delete require.cache[workerThreadsPath];
  return parentPort;
}

function waitForListening(parentPort) {
  return new Promise(function (resolve) {
    var existing = parentPort.posted.find(function (m) { return m.type === "listening"; });
    if (existing) { resolve(existing.port); return; }
    parentPort.on("message", function onMsg(msg) {
      if (msg.type === "listening") { parentPort.off("message", onMsg); resolve(msg.port); }
    });
  });
}

function request(port, method, urlPath, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      host: "127.0.0.1", port: port, path: urlPath, method: method,
      headers: headers || {}
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function runTests() {
  console.log("--- 1. Default Flow Root Redirects ---");
  var project = {
    screens: [
      { id: "s_main", name: "Main Screen", path: "/main", width: 800, height: 600, root: { id: "root", type: "@frame", children: [] } },
      { id: "s_404", name: "Custom 404 Screen", path: "/404", width: 800, height: 600, root: { id: "root", type: "@frame", children: [] } }
    ],
    flows: [
      {
        id: "flow_app", name: "FirstApp", endpoint: "/app", isDefault: true,
        logic: {
          nodes: [
            { id: "trig", type: "route-trigger" },
            { id: "rs_main", type: "render-screen", screenId: "s_main" },
            { id: "not_found", type: "route-not-found" },
            { id: "rs_404", type: "render-screen", screenId: "s_404" }
          ],
          wires: [
            { id: "w1", from: "trig", to: "rs_main" },
            { id: "w2", from: "not_found", to: "rs_404" }
          ]
        }
      }
    ]
  };

  var parentPort = loadWorker({ port: 0, project: project });
  var port = await waitForListening(parentPort);

  // GET / -> 302 redirect to /nexa/app
  var rRoot = await request(port, "GET", "/");
  console.log("GET / redirects 302 to /nexa/app?", rRoot.status === 302 && rRoot.headers.location === "/nexa/app");
  assert.strictEqual(rRoot.status, 302);
  assert.strictEqual(rRoot.headers.location, "/nexa/app");

  // GET /nexa -> 302 redirect to /nexa/app
  var rNexa = await request(port, "GET", "/nexa");
  console.log("GET /nexa redirects 302 to /nexa/app?", rNexa.status === 302 && rNexa.headers.location === "/nexa/app");
  assert.strictEqual(rNexa.status, 302);
  assert.strictEqual(rNexa.headers.location, "/nexa/app");

  // GET /nexa/ -> 302 redirect to /nexa/app
  var rNexaSlash = await request(port, "GET", "/nexa/");
  console.log("GET /nexa/ redirects 302 to /nexa/app?", rNexaSlash.status === 302 && rNexaSlash.headers.location === "/nexa/app");
  assert.strictEqual(rNexaSlash.status, 302);
  assert.strictEqual(rNexaSlash.headers.location, "/nexa/app");

  console.log("--- 2. Route Not Found Handling ---");
  // GET /nexa/app/s (which does not exist) -> renders Custom 404 Screen because flow has route-not-found wired to s_404
  var rUnmatchedWithHandler = await request(port, "GET", "/nexa/app/s");
  console.log("Unmatched /s with route-not-found node serves 404 Screen HTML?", rUnmatchedWithHandler.status === 200 && rUnmatchedWithHandler.body.includes("Custom 404 Screen"));
  assert.strictEqual(rUnmatchedWithHandler.status, 200);
  assert.ok(rUnmatchedWithHandler.body.includes("Custom 404 Screen"));

  // Flow WITHOUT route-not-found node
  var projectNoHandler = {
    screens: [
      { id: "s_main", name: "Main Screen", path: "/main", width: 800, height: 600, root: { id: "root", type: "@frame", children: [] } }
    ],
    flows: [
      {
        id: "flow_raw", name: "FirstApp", endpoint: "/app", isDefault: true,
        logic: {
          nodes: [
            { id: "trig", type: "route-trigger" },
            { id: "rs_main", type: "render-screen", screenId: "s_main" }
          ],
          wires: [
            { id: "w1", from: "trig", to: "rs_main" }
          ]
        }
      }
    ]
  };

  parentPort.postMessage({ type: "project", project: projectNoHandler });
  await new Promise(r => setTimeout(r, 50));

  var rUnmatchedNoHandler = await request(port, "GET", "/nexa/app/s");
  console.log("Unmatched /s without route-not-found returns default 404 message?", rUnmatchedNoHandler.status === 404 && rUnmatchedNoHandler.body === "Screen '/s' not found in Flow: FirstApp");
  assert.strictEqual(rUnmatchedNoHandler.status, 404);
  assert.strictEqual(rUnmatchedNoHandler.body, "Screen '/s' not found in Flow: FirstApp");

  console.log("--- 3. Flow Endpoint Uniqueness Logic ---");
  const { makeFlow, duplicateFlow, state } = require("../src/state.js");
  state.flows = [];
  state.flowCounter = 0;

  var fl1 = makeFlow({ name: "Flow 1", endpoint: "/app" });
  state.flows.push(fl1);
  console.log("First flow created is default by default?", fl1.isDefault === true);
  assert.strictEqual(fl1.isDefault, true);

  // Create another flow with duplicate endpoint -> makeFlow auto-resolves unique
  var fl2 = makeFlow({ name: "Flow 2", endpoint: "/app" });
  state.flows.push(fl2);
  console.log("makeFlow avoids duplicate endpoint and creates unique endpoint?", fl2.endpoint !== "/app");
  assert.notStrictEqual(fl2.endpoint, "/app");

  // Duplicate flow
  var fl1Copy = duplicateFlow(fl1.id);
  console.log("duplicateFlow sets isDefault: false and unique endpoint?", fl1Copy.isDefault === false && fl1Copy.endpoint.startsWith("/app-copy"));
  assert.strictEqual(fl1Copy.isDefault, false);
  assert.ok(fl1Copy.endpoint.startsWith("/app-copy"));

  console.log("--- 4. Fan-Out Guard on Route Trigger ---");
  const { getReachableRenderScreens } = require("../src/logic/logic-wires.js");
  var sampleNodes = [
    { id: "rt1", type: "route-trigger" },
    { id: "fn1", type: "function" },
    { id: "rs1", type: "render-screen" },
    { id: "rs2", type: "render-screen" }
  ];
  // Normal 1-to-1
  var wiresNormal = [
    { from: "rt1", to: "fn1" },
    { from: "fn1", to: "rs1" }
  ];
  var reachable1 = getReachableRenderScreens("rt1", sampleNodes, wiresNormal);
  console.log("Route trigger with 1 render screen reachable count is 1?", reachable1.length === 1 && reachable1[0] === "rs1");
  assert.strictEqual(reachable1.length, 1);

  // Fan-out to 2 render screens
  var wiresFanOut = [
    { from: "rt1", to: "fn1" },
    { from: "fn1", to: "rs1" },
    { from: "fn1", to: "rs2" }
  ];
  var reachable2 = getReachableRenderScreens("rt1", sampleNodes, wiresFanOut);
  console.log("Fan-out detected: route trigger reaches 2 render screens?", reachable2.length === 2);
  assert.strictEqual(reachable2.length, 2);

  console.log("ALL OK");
  process.exit(0);
}

runTests().catch(function (err) {
  console.error("Test failed:", err);
  process.exit(1);
});
