// Integration-ish test for nodes/nexa-sparkplug.js's actual wiring (not just
// the pure lib/sparkplug/sparkplugTree.js and sparkplugRebirth.js modules it
// calls into) — specifically the auto-rebirth-on-missing-birth behavior that
// was the whole point of adding a publish path to what used to be a purely
// passive listener. Run standalone: `node test/mock-nexa-sparkplug-node.js`.
//
// No node-red-node-test-helper here (this package doesn't depend on it) —
// a hand-rolled minimal fake `RED`/`mqtt` is enough, same spirit as this
// package's other mock-*.js tests and as @kufayeka/node-red-asset-engine's
// test/helpers/fakeMqtt.js (this file's fake mqtt client is a smaller,
// single-purpose copy of that same technique: replace require.cache's
// "mqtt" entry BEFORE nodes/nexa-sparkplug.js's own top-level `require`
// evaluates it).
const { EventEmitter } = require("events");
const assert = require("assert");
const sparkplug = require("../lib/sparkplug/sparkplugCodec.js");

class FakeMqttClient extends EventEmitter {
  constructor(url, opts) {
    super();
    this.url = url;
    this.options = opts;
    this.connected = false;
    this.published = []; // [{topic, payload (Buffer), opts}]
  }
  publish(topic, payload, opts, cb) {
    this.published.push({ topic: topic, payload: payload, opts: opts });
    if (typeof cb === "function") cb();
  }
  subscribe(topics, opts, cb) { if (typeof cb === "function") cb(null); }
  end(force, opts, cb) { if (typeof cb === "function") cb(); }
  simulateConnect() { this.connected = true; this.emit("connect"); }
  simulateMessage(topic, buffer) { this.emit("message", topic, buffer); }
}

var lastFakeClient = null;
const mqttModulePath = require.resolve("mqtt");
require.cache[mqttModulePath] = {
  id: mqttModulePath, filename: mqttModulePath, loaded: true,
  exports: { connect: function (url, opts) { lastFakeClient = new FakeMqttClient(url, opts); return lastFakeClient; } }
};

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
  return require("../nodes/nexa-sparkplug.js");
}

function decodedPublishesOf(client) {
  return client.published.map(function (p) { return { topic: p.topic, payload: sparkplug.decodePayload(p.payload) }; });
}

console.log("--- a CONCRETE group+edge node filter requests a Rebirth immediately on connect (no need to wait for its first message) ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n1", brokerUrl: "mqtt://fake", groupFilter: "G1", edgeNodeFilter: "Edge1" });
  lastFakeClient.simulateConnect();

  var rebirths = decodedPublishesOf(lastFakeClient).filter(function (p) { return p.topic === "spBv1.0/G1/NCMD/Edge1"; });
  assert.strictEqual(rebirths.length, 1, "expected exactly one immediate Rebirth request on connect");
  assert.strictEqual(rebirths[0].payload.metrics[0].name, "Node Control/Rebirth");
  assert.strictEqual(rebirths[0].payload.metrics[0].value, true);
  console.log("immediate Rebirth request sent on connect for a concrete filter?", true);
})();

console.log("--- a WILDCARD filter sends NO rebirth request on connect (there's no single concrete Edge Node to ask yet) ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n2", brokerUrl: "mqtt://fake" }); // groupFilter/edgeNodeFilter default to "+"
  lastFakeClient.simulateConnect();
  console.log("no rebirth published yet?", lastFakeClient.published.length === 0);
})();

console.log("--- receiving DDATA for an Edge Node whose NBIRTH was never seen triggers an automatic Rebirth request ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n3", brokerUrl: "mqtt://fake" }); // wildcard -- no rebirth on connect
  lastFakeClient.simulateConnect();

  var ddata = sparkplug.encodePayload({ timestamp: 1, metrics: [{ name: "Speed", type: "Double", value: 10 }] });
  lastFakeClient.simulateMessage("spBv1.0/G2/DDATA/Edge2/Motor1", ddata);

  var rebirths = decodedPublishesOf(lastFakeClient).filter(function (p) { return p.topic === "spBv1.0/G2/NCMD/Edge2"; });
  console.log("auto-rebirth requested after a DDATA arrived with no prior NBIRTH?", rebirths.length === 1);

  console.log("--- ...but once that Edge Node's real NBIRTH arrives, no further rebirth requests are sent for more DDATA ---");
  var nbirth = sparkplug.encodePayload({ timestamp: 2, metrics: [{ name: "bdSeq", type: "Int64", value: 0 }] });
  lastFakeClient.simulateMessage("spBv1.0/G2/NBIRTH/Edge2", nbirth);
  lastFakeClient.published = []; // reset -- only care about what happens AFTER the birth
  lastFakeClient.simulateMessage("spBv1.0/G2/DDATA/Edge2/Motor1", ddata);
  var rebirths2 = decodedPublishesOf(lastFakeClient).filter(function (p) { return p.topic === "spBv1.0/G2/NCMD/Edge2"; });
  console.log("no further auto-rebirth once the Edge Node's NBIRTH has actually been seen?", rebirths2.length === 0);
})();

console.log("--- requestRebirthAll() (the manual \"Refresh\" trigger) asks every Edge Node currently known, ignoring the cooldown ---");
(function () {
  var RED = makeFakeRED();
  var mod = loadFreshNode();
  mod(RED);
  var Ctor = RED.getRegisteredCtor();
  var node = new Ctor({ id: "n4", brokerUrl: "mqtt://fake" });
  lastFakeClient.simulateConnect();

  var nbirth1 = sparkplug.encodePayload({ timestamp: 1, metrics: [{ name: "bdSeq", type: "Int64", value: 0 }] });
  var nbirth2 = sparkplug.encodePayload({ timestamp: 1, metrics: [{ name: "bdSeq", type: "Int64", value: 0 }] });
  lastFakeClient.simulateMessage("spBv1.0/G3/NBIRTH/Edge3", nbirth1);
  lastFakeClient.simulateMessage("spBv1.0/G4/NBIRTH/Edge4", nbirth2);
  lastFakeClient.published = [];

  var count = node.requestRebirthAll();
  console.log("reports 2 requests sent (one per known Edge Node)?", count === 2);
  var topics = lastFakeClient.published.map(function (p) { return p.topic; }).sort();
  console.log("actually published to both known Edge Nodes?", JSON.stringify(topics) === JSON.stringify(["spBv1.0/G3/NCMD/Edge3", "spBv1.0/G4/NCMD/Edge4"]));
})();

console.log("ALL OK");
