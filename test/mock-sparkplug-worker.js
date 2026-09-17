// Unit test for lib/sparkplug-worker.js — the actual mqtt.connect()/Protobuf
// codec boundary that now runs inside a real worker_threads.Worker in
// production. Run standalone: `node test/mock-sparkplug-worker.js`.
//
// This file is a normal Node.js module (require()-able) even though its
// production home is a worker thread, so it's tested the same way
// nexa-sparkplug.js used to be tested before this split: fake require("mqtt")
// via require.cache (same technique test/mock-nexa-sparkplug-node.js's OLD
// version used, and asset-engine's test/helpers/fakeMqtt.js still uses) —
// plus a fake require("worker_threads") providing a controllable
// parentPort/workerData, since lib/sparkplug-worker.js talks to the outside
// world exclusively through those, not through any exported function.
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
  subscribe(topics, opts, cb) { this.subscribed = { topics: topics, opts: opts }; if (typeof cb === "function") cb(null); }
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

class FakeParentPort extends EventEmitter {
  postMessage(msg) { (this.posted = this.posted || []).push(msg); this.emit("message", msg); }
}

function loadWorker(workerData) {
  delete require.cache[require.resolve("../lib/sparkplug-worker.js")];
  var parentPort = new FakeParentPort();
  var workerThreadsPath = require.resolve("worker_threads");
  var real = require.cache[workerThreadsPath];
  require.cache[workerThreadsPath] = {
    id: workerThreadsPath, filename: workerThreadsPath, loaded: true,
    exports: Object.assign({}, real ? real.exports : {}, { parentPort: parentPort, workerData: workerData })
  };
  require("../lib/sparkplug-worker.js");
  // Restore the ORIGINAL cache entry (not just delete it) — worker_threads is
  // a built-in module, and other code in this same process may hold
  // references that assume the module identity stays stable.
  if (real) require.cache[workerThreadsPath] = real;
  else delete require.cache[workerThreadsPath];
  return parentPort;
}

function decodedPublishesOf(client) {
  return client.published.map(function (p) { return { topic: p.topic, opts: p.opts, payload: sparkplug.decodePayload(p.payload) }; });
}

console.log("--- connects with the exact keepAlive/protocolVersion/reconnectPeriod/connectTimeout/clientId given via workerData ---");
(function () {
  var parentPort = loadWorker({
    brokerUrl: "mqtt://fake", username: "u", password: "p", clientId: "my-id",
    keepAlive: 45, protocolVersion: 5, reconnectPeriod: 2000, connectTimeout: 10000,
    subscribeTopics: ["a/b"], subscribeQos: 0
  });
  console.log("mqtt.connect() called with the given brokerUrl?", lastFakeClient.url === "mqtt://fake");
  var opts = lastFakeClient.options;
  console.log("all connect options passed through correctly?",
    opts.username === "u" && opts.password === "p" && opts.clientId === "my-id" &&
    opts.keepalive === 45 && opts.protocolVersion === 5 && opts.reconnectPeriod === 2000 && opts.connectTimeout === 10000);
})();

console.log("--- on connect: subscribes to the given topics and reports status \"connected\" to the main thread ---");
(function () {
  var parentPort = loadWorker({ brokerUrl: "mqtt://fake", subscribeTopics: ["spBv1.0/G1/+/E1", "spBv1.0/G1/+/E1/+"], subscribeQos: 0 });
  lastFakeClient.simulateConnect();
  console.log("subscribed to the right topics?", JSON.stringify(lastFakeClient.subscribed.topics) === JSON.stringify(["spBv1.0/G1/+/E1", "spBv1.0/G1/+/E1/+"]));
  var statusMsgs = parentPort.posted.filter(function (m) { return m.type === "status"; });
  console.log("posted a \"connected\" status message?", statusMsgs.some(function (m) { return m.status === "connected"; }));
})();

console.log("--- an incoming MQTT message is decoded and posted to the main thread as an already-decoded payload ---");
(function () {
  var parentPort = loadWorker({ brokerUrl: "mqtt://fake", subscribeTopics: [], subscribeQos: 0 });
  lastFakeClient.simulateConnect();
  var buf = sparkplug.encodePayload({ timestamp: 1, metrics: [{ name: "Speed", type: "Double", value: 42 }] });
  lastFakeClient.simulateMessage("spBv1.0/G1/DDATA/E1/Motor1", buf);
  var msgEvents = parentPort.posted.filter(function (m) { return m.type === "message"; });
  console.log("posted exactly one decoded message with the right topic/metric?",
    msgEvents.length === 1 && msgEvents[0].topic === "spBv1.0/G1/DDATA/E1/Motor1" && msgEvents[0].payload.metrics[0].value === 42);
})();

console.log("--- a message that fails to decode posts a decode-error instead of throwing ---");
(function () {
  var parentPort = loadWorker({ brokerUrl: "mqtt://fake", subscribeTopics: [], subscribeQos: 0 });
  lastFakeClient.simulateConnect();
  lastFakeClient.simulateMessage("spBv1.0/G1/DDATA/E1/Motor1", Buffer.from([0xff, 0xff, 0xff]));
  var errEvents = parentPort.posted.filter(function (m) { return m.type === "decode-error"; });
  console.log("posted a decode-error instead of crashing?", errEvents.length === 1);
})();

console.log("--- a {type:\"publish\"} message from the main thread encodes and publishes a DCMD (deviceId given) at QoS 0, not retained ---");
(function () {
  var parentPort = loadWorker({ brokerUrl: "mqtt://fake", subscribeTopics: [], subscribeQos: 0 });
  lastFakeClient.simulateConnect();
  parentPort.emit("message", { type: "publish", groupId: "G1", edgeNodeId: "E1", deviceId: "Motor1", metrics: [{ name: "Speed", value: 42 }] });
  var pubs = decodedPublishesOf(lastFakeClient);
  console.log("published to the right DCMD topic, QoS 0, not retained?",
    pubs.length === 1 && pubs[0].topic === "spBv1.0/G1/DCMD/E1/Motor1" && pubs[0].opts.qos === 0 && pubs[0].opts.retain === false);
  console.log("metric type inferred correctly (number -> Double) when not given?", pubs[0].payload.metrics[0].type === "Double" && pubs[0].payload.metrics[0].value === 42);
})();

console.log("--- a {type:\"publish\"} message with NO deviceId publishes a node-scoped NCMD instead ---");
(function () {
  var parentPort = loadWorker({ brokerUrl: "mqtt://fake", subscribeTopics: [], subscribeQos: 0 });
  lastFakeClient.simulateConnect();
  parentPort.emit("message", { type: "publish", groupId: "G1", edgeNodeId: "E1", deviceId: null, metrics: [{ name: "Node Control/Rebirth", type: "Boolean", value: true }] });
  var pubs = decodedPublishesOf(lastFakeClient);
  console.log("published to a node-scoped NCMD topic?", pubs.length === 1 && pubs[0].topic === "spBv1.0/G1/NCMD/E1");
})();

console.log("--- a {type:\"publish\"} message is silently dropped (not queued/thrown) while disconnected ---");
(function () {
  var parentPort = loadWorker({ brokerUrl: "mqtt://fake", subscribeTopics: [], subscribeQos: 0 });
  // deliberately NOT simulating connect
  parentPort.emit("message", { type: "publish", groupId: "G1", edgeNodeId: "E1", deviceId: null, metrics: [{ name: "X", value: 1 }] });
  console.log("nothing published while disconnected, no throw?", lastFakeClient.published.length === 0);
})();

console.log("--- a {type:\"close\"} message ends the mqtt client and posts \"closed\" back to the main thread ---");
(function () {
  var parentPort = loadWorker({ brokerUrl: "mqtt://fake", subscribeTopics: [], subscribeQos: 0 });
  lastFakeClient.simulateConnect();
  parentPort.emit("message", { type: "close" });
  var closedMsgs = parentPort.posted.filter(function (m) { return m.type === "closed"; });
  console.log("posted \"closed\" after ending the client?", closedMsgs.length === 1);
})();

console.log("ALL OK");
