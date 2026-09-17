// Verifies lib/nexa-plugin.js's OWN responsibilities around the deployed-
// screen worker (lib/screen-worker.js) — spawning it with the right initial
// data, relaying project/Sparkplug-delta updates to it, and round-tripping
// its {type:"write-request"} messages through the active Sparkplug
// connection's own writeMetrics(). The worker's OWN routing/rendering logic
// is covered separately, without needing any of this, by
// mock-screen-worker.js and mock-screen-worker-integration.js.
// Run standalone: node test/mock-nexa-plugin-screen-worker-relay.js
const { EventEmitter } = require("events");
const assert = require("assert");

// lib/nexa-plugin.js resolves "the active Sparkplug node" via the current
// project's own sparkplugConnection field + RED.nodes.getNode(id) (see
// getActiveSparkplugNode() there) — stub nodes/nexa-project.js's
// getCurrentProject() BEFORE nexa-plugin.js requires it, so this test
// controls the project (screens/templates/sparkplugConnection) directly.
var fakeProject = null;
var projectModulePath = require.resolve("../nodes/nexa-project.js");
require.cache[projectModulePath] = {
  id: projectModulePath, filename: projectModulePath, loaded: true,
  exports: Object.assign(function () {}, { getCurrentProject: function () { return fakeProject; } })
};

// A real worker_threads.Worker can't be driven by faking require(...) in
// this test process (a worker has its own, independent module registry) —
// substitute it via nexa-plugin.js's own _setScreenWorkerFactoryForTests
// seam instead, same spirit as nodes/nexa-sparkplug.js's own worker seam.
class FakeScreenWorker extends EventEmitter {
  constructor(workerData) {
    super();
    this.workerData = workerData;
    this.posted = [];
    this.terminated = false;
  }
  postMessage(msg) { this.posted.push(msg); }
  terminate() { this.terminated = true; return Promise.resolve(); }
}
var lastFakeScreenWorker = null;

function makeFakeRED(opts) {
  opts = opts || {};
  var eventHandlers = {};
  var adminRoutes = {};
  return {
    settings: { uiPort: opts.uiPort || 1880 },
    plugins: {
      registerPlugin: function (type, def) { def.onadd(); this._def = def; },
      getByType: function () { return opts.componentPkgs || []; }
    },
    events: {
      on: function (evt, fn) { (eventHandlers[evt] = eventHandlers[evt] || []).push(fn); },
      fire: function (evt) { (eventHandlers[evt] || []).forEach(function (fn) { fn(); }); }
    },
    log: { info: function () {}, warn: function () {} },
    httpAdmin: {
      get: function (p, h) { adminRoutes[p] = h; },
      post: function (p, h) { adminRoutes[p] = h; }
    },
    nodes: { getNode: function (id) { return (opts.sparkplugNode && id === opts.sparkplugNodeId) ? opts.sparkplugNode : null; } },
    getAdminRoute: function (p) { return adminRoutes[p]; }
  };
}

function loadFreshPlugin() {
  delete require.cache[require.resolve("../lib/nexa-plugin.js")];
  var mod = require("../lib/nexa-plugin.js");
  mod._setScreenWorkerFactoryForTests(function (workerData) {
    lastFakeScreenWorker = new FakeScreenWorker(workerData);
    return lastFakeScreenWorker;
  });
  return mod;
}

console.log("--- spawns the screen worker with the current project's screens/templates, registered component script srcs, and RED.settings.uiPort ---");
(function () {
  fakeProject = { screens: [{ path: "/s1", name: "S1", width: 1, height: 1 }], templates: [{ id: "t1" }], sparkplugConnection: "" };
  var pluginFactory = loadFreshPlugin();
  // A non-default port here proves this genuinely follows RED.settings.uiPort
  // (wherever the user actually configured/started Node-RED) rather than a
  // hardcoded assumption — component scripts served by OTHER plugins (e.g.
  // @kufayeka/nexa-component-basic-shapes) still live on Node-RED's real
  // port, not this worker's dedicated one, so getting this wrong is exactly
  // what caused the reported "unknown component" bug.
  var RED = makeFakeRED({ componentPkgs: [{ runtimeScripts: ["/pkg/a.js"] }], uiPort: 3000 });
  pluginFactory(RED);

  var wd = lastFakeScreenWorker.workerData;
  console.log("initial project screens/templates passed through?", wd.project.screens.length === 1 && wd.project.screens[0].name === "S1" && wd.project.templates[0].id === "t1");
  console.log("initial componentScriptSrcs passed through?", JSON.stringify(wd.componentScriptSrcs) === JSON.stringify(["/pkg/a.js"]));
  console.log("initial nodeRedPort follows RED.settings.uiPort, not a hardcoded default?", wd.nodeRedPort === 3000);
  console.log("initial sparkplugSnapshot defaults to {} when no connection is configured?", JSON.stringify(wd.sparkplugSnapshot) === "{}");
})();

console.log("--- a redeploy (\"flows:started\") pushes the LATEST project/component scripts/nodeRedPort to the worker ---");
(function () {
  fakeProject = { screens: [{ path: "/s1", name: "S1", width: 1, height: 1 }], templates: [], sparkplugConnection: "" };
  var pluginFactory = loadFreshPlugin();
  var RED = makeFakeRED({ uiPort: 8080 });
  pluginFactory(RED);

  fakeProject = { screens: [{ path: "/s2", name: "S2", width: 1, height: 1 }], templates: [], sparkplugConnection: "" };
  RED.events.fire("flows:started");

  var pushes = lastFakeScreenWorker.posted.filter(function (m) { return m.type === "project"; });
  var latest = pushes[pushes.length - 1];
  console.log("a fresh project push reflects the redeployed screens?", latest.project.screens[0].name === "S2");
  console.log("a fresh project push also carries the current RED.settings.uiPort?", latest.nodeRedPort === 8080);
})();

console.log("--- when the project has an active Sparkplug connection, its LIVE deltas are relayed to the screen worker ---");
(function () {
  var deltaListeners = [];
  var fakeSparkplugNode = {
    getSnapshot: function () { return { G1: {} }; },
    subscribeTree: function (fn) { deltaListeners.push(fn); return function () {}; }
  };
  fakeProject = { screens: [], templates: [], sparkplugConnection: "sp1" };
  var pluginFactory = loadFreshPlugin();
  var RED = makeFakeRED({ sparkplugNode: fakeSparkplugNode, sparkplugNodeId: "sp1" });
  pluginFactory(RED);
  RED.events.fire("flows:started"); // wires the sparkplug subscription

  console.log("subscribed to the active Sparkplug node's tree?", deltaListeners.length === 1);
  console.log("pushed an initial resync snapshot to the screen worker on wiring?",
    lastFakeScreenWorker.posted.some(function (m) { return m.type === "sparkplug-snapshot" && m.resync === true && m.snapshot.G1 !== undefined; }));

  deltaListeners[0]({ some: "delta" }, '{"some":"delta"}');
  var deltaPushes = lastFakeScreenWorker.posted.filter(function (m) { return m.type === "sparkplug-delta"; });
  console.log("relayed the delta's pre-serialized string to the screen worker?", deltaPushes.length === 1 && deltaPushes[0].serialized === '{"some":"delta"}');
})();

console.log("--- a {type:\"write-request\"} from the screen worker calls the active connection's writeMetrics() and replies with write-result ---");
(function () {
  var capturedArgs = null;
  var fakeSparkplugNode = {
    getSnapshot: function () { return {}; },
    subscribeTree: function () { return function () {}; },
    writeMetrics: function (g, e, d, m) { capturedArgs = [g, e, d, m]; return true; }
  };
  fakeProject = { screens: [], templates: [], sparkplugConnection: "sp1" };
  var pluginFactory = loadFreshPlugin();
  var RED = makeFakeRED({ sparkplugNode: fakeSparkplugNode, sparkplugNodeId: "sp1" });
  pluginFactory(RED);

  lastFakeScreenWorker.emit("message", { type: "write-request", requestId: "w1", groupId: "G1", edgeNodeId: "E1", deviceId: "Motor1", metrics: [{ name: "Speed", value: 42 }] });

  console.log("writeMetrics called with the right groupId/edgeNodeId/deviceId/metrics?",
    capturedArgs && capturedArgs[0] === "G1" && capturedArgs[1] === "E1" && capturedArgs[2] === "Motor1" && capturedArgs[3][0].name === "Speed");
  var results = lastFakeScreenWorker.posted.filter(function (m) { return m.type === "write-result"; });
  console.log("replied with write-result {requestId, ok:true}?", results.length === 1 && results[0].requestId === "w1" && results[0].ok === true);
})();

console.log("--- a write-request with no active connection configured replies ok:false, not a crash ---");
(function () {
  fakeProject = { screens: [], templates: [], sparkplugConnection: "" };
  var pluginFactory = loadFreshPlugin();
  var RED = makeFakeRED({});
  pluginFactory(RED);

  lastFakeScreenWorker.emit("message", { type: "write-request", requestId: "w2", groupId: "G1", edgeNodeId: "E1", deviceId: null, metrics: [{ name: "X", value: 1 }] });

  var results = lastFakeScreenWorker.posted.filter(function (m) { return m.type === "write-result"; });
  console.log("replied ok:false instead of throwing when no connection is configured?", results.length === 1 && results[0].requestId === "w2" && results[0].ok === false);
})();

console.log("ALL OK");
// Each loadFreshPlugin()+pluginFactory(RED) call above started a real
// setInterval (nexa-plugin.js's throttled snapshot-refresh) that this test
// never stops (no matching onremove() call) — an uncleared interval keeps
// the process alive indefinitely, so force exit now that assertions are done.
process.exit(0);
