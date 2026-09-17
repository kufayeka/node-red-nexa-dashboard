// Integration-ish test for nodes/nexa-sparkplug.js's actual wiring (not just
// the pure lib/sparkplug/sparkplugTree.js and sparkplugRebirth.js modules it
// calls into) — specifically the auto-rebirth-on-missing-birth behavior that
// was the whole point of adding a publish path to what used to be a purely
// passive listener. Run standalone: `node test/mock-nexa-sparkplug-node.js`.
//
// The actual mqtt.connect()/Protobuf codec now lives in a worker_thread
// (lib/sparkplug-worker.js), which a real worker_threads.Worker runs in its
// own isolated module registry — faking require("mqtt") in THIS test process
// (the old technique, still used by lib/sparkplug-worker.js's own tests)
// can't reach into it. So this test instead substitutes the worker itself,
// via nodes/nexa-sparkplug.js's _setWorkerFactoryForTests seam — the same
// spirit as the CM6 editor's window.__kufayekaCreateCM6EditorOverride. A
// FakeWorker below stands in for the real worker_threads.Worker: it records
// every {type:"publish",...} message posted to it (what used to be a real
// mqtt client's .publish() call, one layer further out now), and lets the
// test simulate the worker's own postMessage("message", ...) events
// (connected/status changes, already-decoded incoming Sparkplug payloads)
// without ever touching a real MQTT broker or a real OS thread.
const { EventEmitter } = require("events");
const assert = require("assert");

class FakeWorker extends EventEmitter {
  constructor(workerData) {
    super();
    this.workerData = workerData;
    this.posted = []; // [{type:"publish", groupId, edgeNodeId, deviceId, metrics}, ...]
  }
  postMessage(msg) {
    if (msg.type === "publish") this.posted.push(msg);
    if (msg.type === "close") this.emit("message", { type: "closed" });
  }
  terminate() { return Promise.resolve(); }
  simulateConnect() { this.emit("message", { type: "status", status: "connected" }); }
  simulateMessage(topic, payload) { this.emit("message", { type: "message", topic: topic, payload: payload }); }
}

var lastFakeWorker = null;

// Minimal fake RED — just enough of the surface nodes/nexa-sparkplug.js
// actually touches: RED.nodes.createNode/registerType, and on the node
// instance itself: .credentials, .warn/.log/.status, .on("close", ...).
function makeFakeRED() {
  var registered = null;
  return {
    nodes: {
      createNode: function (node, config) {
        Object.assign(node, config);
        node.credentials = {};
        node.warn = function (m) { node._warnings.push(m); };
        node.log = function () {};
        node.status = function () {};
        node.on = function (evt, fn) { node._onHandlers[evt] = fn; };
        node._warnings = [];
        node._onHandlers = {};
      },
      registerType: function (type, ctor) { registered = ctor; }
    },
    getRegisteredCtor: function () { return registered; }
  };
}

function loadFreshNode() {
  delete require.cache[require.resolve("../nodes/nexa-sparkplug.js")];
  var mod = require("../nodes/nexa-sparkplug.js");
  mod._setWorkerFactoryForTests(function (workerData) {
    lastFakeWorker = new FakeWorker(workerData);
    return lastFakeWorker;
  });
  return mod;
}

function publishedTo(worker, groupId, edgeNodeId, deviceId) {
  return worker.posted.filter(function (p) {
    return p.groupId === groupId && p.edgeNodeId === edgeNodeId && (p.deviceId || null) === (deviceId || null);
  });
}

console.log("--- a CONCRETE group+edge node filter requests a Rebirth immediately on connect (no need to wait for its first message) ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n1", brokerUrl: "mqtt://fake", groupFilter: "G1", edgeNodeFilter: "Edge1" });
  lastFakeWorker.simulateConnect();

  var rebirths = publishedTo(lastFakeWorker, "G1", "Edge1", null);
  assert.strictEqual(rebirths.length, 1, "expected exactly one immediate Rebirth request on connect");
  assert.strictEqual(rebirths[0].metrics[0].name, "Node Control/Rebirth");
  assert.strictEqual(rebirths[0].metrics[0].value, true);
  console.log("immediate Rebirth request sent on connect for a concrete filter?", true);
})();

console.log("--- a WILDCARD filter sends NO rebirth request on connect (there's no single concrete Edge Node to ask yet) ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n2", brokerUrl: "mqtt://fake" }); // groupFilter/edgeNodeFilter default to "+"
  lastFakeWorker.simulateConnect();
  console.log("no rebirth published yet?", lastFakeWorker.posted.length === 0);
})();

console.log("--- receiving DDATA for an Edge Node whose NBIRTH was never seen triggers an automatic Rebirth request ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n3", brokerUrl: "mqtt://fake" }); // wildcard -- no rebirth on connect
  lastFakeWorker.simulateConnect();

  lastFakeWorker.simulateMessage("spBv1.0/G2/DDATA/Edge2/Motor1", { timestamp: 1, metrics: [{ name: "Speed", value: 10 }] });

  var rebirths = publishedTo(lastFakeWorker, "G2", "Edge2", null);
  console.log("auto-rebirth requested after a DDATA arrived with no prior NBIRTH?", rebirths.length === 1);

  console.log("--- ...but once that Edge Node's real NBIRTH arrives, no further rebirth requests are sent for more DDATA ---");
  lastFakeWorker.simulateMessage("spBv1.0/G2/NBIRTH/Edge2", { timestamp: 2, metrics: [{ name: "bdSeq", value: 0 }] });
  lastFakeWorker.posted = []; // reset -- only care about what happens AFTER the birth
  lastFakeWorker.simulateMessage("spBv1.0/G2/DDATA/Edge2/Motor1", { timestamp: 3, metrics: [{ name: "Speed", value: 11 }] });
  var rebirths2 = publishedTo(lastFakeWorker, "G2", "Edge2", null);
  console.log("no further auto-rebirth once the Edge Node's NBIRTH has actually been seen?", rebirths2.length === 0);
})();

console.log("--- requestRebirthAll() (the manual \"Refresh\" trigger) asks every Edge Node currently known, ignoring the cooldown ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n4", brokerUrl: "mqtt://fake" });
  lastFakeWorker.simulateConnect();

  lastFakeWorker.simulateMessage("spBv1.0/G3/NBIRTH/Edge3", { timestamp: 1, metrics: [{ name: "bdSeq", value: 0 }] });
  lastFakeWorker.simulateMessage("spBv1.0/G4/NBIRTH/Edge4", { timestamp: 1, metrics: [{ name: "bdSeq", value: 0 }] });
  lastFakeWorker.posted = [];

  var count = node.requestRebirthAll();
  console.log("reports 2 requests sent (one per known Edge Node)?", count === 2);
  var pairs = lastFakeWorker.posted.map(function (p) { return p.groupId + "/" + p.edgeNodeId; }).sort();
  console.log("actually published to both known Edge Nodes?", JSON.stringify(pairs) === JSON.stringify(["G3/Edge3", "G4/Edge4"]));
})();

console.log("--- writeMetrics() publishes a DCMD (device given) with the right topic/metrics, backing the \"Sparkplug Write\" Logic node ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n5", brokerUrl: "mqtt://fake" });
  lastFakeWorker.simulateConnect();
  lastFakeWorker.posted = [];

  var ok = node.writeMetrics("G1", "Edge1", "Motor1", [{ name: "Speed", value: 42 }]);
  assert.strictEqual(ok, true, "writeMetrics should report success when connected");
  var writes = publishedTo(lastFakeWorker, "G1", "Edge1", "Motor1");
  assert.strictEqual(writes.length, 1, "expected exactly one DCMD publish");
  console.log("published with deviceId set and the right metric/value?", writes[0].metrics[0].name === "Speed" && writes[0].metrics[0].value === 42);
})();

console.log("--- writeMetrics() with NO deviceId publishes a node-scoped NCMD instead ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n6", brokerUrl: "mqtt://fake" });
  lastFakeWorker.simulateConnect();
  lastFakeWorker.posted = [];

  node.writeMetrics("G1", "Edge1", null, [{ name: "SomeNodeAttr", value: "hello" }]);
  var writes = publishedTo(lastFakeWorker, "G1", "Edge1", null);
  console.log("published with no deviceId (node-scoped)?", writes.length === 1 && writes[0].metrics[0].value === "hello");
})();

console.log("--- writeMetrics() batches MULTIPLE metrics for the same device into ONE publish, backing \"Sparkplug Write Multi\" ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n7", brokerUrl: "mqtt://fake" });
  lastFakeWorker.simulateConnect();
  lastFakeWorker.posted = [];

  node.writeMetrics("G1", "Edge1", "Motor1", [{ name: "Speed", value: 10 }, { name: "Torque", value: 5 }]);
  var writes = publishedTo(lastFakeWorker, "G1", "Edge1", "Motor1");
  console.log("exactly one publish carrying BOTH metrics?", writes.length === 1 && writes[0].metrics.length === 2);
})();

console.log("--- writeMetrics() refuses to publish when not connected (returns false, no throw) ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n8", brokerUrl: "mqtt://fake" });
  // deliberately NOT calling simulateConnect() -- worker exists but isn't "connected" yet
  var ok = node.writeMetrics("G1", "Edge1", "Motor1", [{ name: "Speed", value: 1 }]);
  console.log("returns false instead of throwing/publishing while disconnected?", ok === false);
})();

console.log("--- the connection config (keepAlive/protocolVersion/reconnectPeriod/connectTimeout/clientId) reaches the worker via workerData ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({
    id: "n9", brokerUrl: "mqtt://fake",
    keepAlive: 45, protocolVersion: 5, reconnectPeriod: 2000, connectTimeout: 10000,
    clientIdOverride: "my-custom-id"
  });
  var wd = lastFakeWorker.workerData;
  console.log("keepAlive/protocolVersion/reconnectPeriod/connectTimeout/clientId all passed through?",
    wd.keepAlive === 45 && wd.protocolVersion === 5 && wd.reconnectPeriod === 2000 &&
    wd.connectTimeout === 10000 && wd.clientId === "my-custom-id");
})();

console.log("--- node close() posts a graceful close message and terminates the worker only after it acknowledges ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n10", brokerUrl: "mqtt://fake" });
  lastFakeWorker.simulateConnect();
  var terminated = false;
  lastFakeWorker.terminate = function () { terminated = true; return Promise.resolve(); };

  var doneCalled = false;
  node._onHandlers.close(function () { doneCalled = true; });
  console.log("close message posted to the worker?", lastFakeWorker.posted.length === 0 && doneCalled === true && terminated === true);
})();

console.log("ALL OK");
