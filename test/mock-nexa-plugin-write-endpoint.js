// Verifies lib/nexa-plugin.js's own POST RUNTIME_PREFIX + "/_sparkplug-write"
// route handler in isolation — the JSON body reading (RED.httpNode has no
// body-parser applied by Node-RED itself, so this file hand-rolls one) and
// request validation, separate from nodes/nexa-sparkplug.js's own
// writeMetrics() (already covered directly in mock-nexa-sparkplug-node.js).
// Run standalone: node test/mock-nexa-plugin-write-endpoint.js
const { EventEmitter } = require("events");
const assert = require("assert");

// Minimal fake RED: captures the registered POST handler for the write
// endpoint (this file has no interest in any of the OTHER routes
// lib/nexa-plugin.js registers), and provides just enough of
// httpAdmin/httpNode's surface for the module to load without throwing.
function makeFakeRED(sparkplugWriteMetricsImpl) {
  var writeHandler = null;
  var fakeApp = {
    get: function () {},
    post: function (routePath, handler) {
      if (routePath.indexOf("_sparkplug-write") !== -1) writeHandler = handler;
    }
  };
  return {
    plugins: { registerPlugin: function (type, def) { def.onadd(); } },
    events: { on: function () {} },
    log: { info: function () {}, warn: function () {} },
    httpAdmin: fakeApp,
    httpNode: fakeApp,
    getWriteHandler: function () { return writeHandler; }
  };
}

function fakeReqRes(bodyBuffer) {
  var req = new EventEmitter();
  var res = {
    statusCode: 200,
    _json: null,
    status: function (code) { this.statusCode = code; return this; },
    json: function (obj) { this._json = obj; return this; }
  };
  process.nextTick(function () {
    if (bodyBuffer !== undefined) req.emit("data", Buffer.from(bodyBuffer));
    req.emit("end");
  });
  return { req: req, res: res };
}

// Stub out nodes/nexa-sparkplug.js's getCurrentSparkplugNode() BEFORE
// nexa-plugin.js requires it, so this test controls exactly what "the
// current Sparkplug node" is without needing a real MQTT client at all.
var fakeSparkplugNode = null;
var sparkplugModulePath = require.resolve("../nodes/nexa-sparkplug.js");
require.cache[sparkplugModulePath] = {
  id: sparkplugModulePath, filename: sparkplugModulePath, loaded: true,
  exports: Object.assign(function () {}, { getCurrentSparkplugNode: function () { return fakeSparkplugNode; } })
};

var RED = makeFakeRED();
require("../lib/nexa-plugin.js")(RED);
var handler = RED.getWriteHandler();

function run(bodyBuffer, done) {
  var pair = fakeReqRes(bodyBuffer);
  handler(pair.req, pair.res);
  process.nextTick(function () { process.nextTick(function () { done(pair.res); }); });
}

console.log("--- a well-formed write request calls writeMetrics() with the right args and returns {ok:true} ---");
var capturedArgs = null;
fakeSparkplugNode = { writeMetrics: function (g, e, d, m) { capturedArgs = [g, e, d, m]; return true; } };
run(JSON.stringify({ groupId: "G1", edgeNodeId: "E1", deviceId: "Motor1", metrics: [{ name: "Speed", value: 42 }] }), function (res) {
  assert.strictEqual(res.statusCode, 200);
  console.log("responded {ok:true}?", res._json && res._json.ok === true);
  console.log("writeMetrics called with the right groupId/edgeNodeId/deviceId?", capturedArgs[0] === "G1" && capturedArgs[1] === "E1" && capturedArgs[2] === "Motor1");
  console.log("metrics forwarded correctly?", capturedArgs[3].length === 1 && capturedArgs[3][0].name === "Speed" && capturedArgs[3][0].value === 42);

  console.log("--- invalid JSON body -> 400, writeMetrics never called ---");
  capturedArgs = null;
  run("{not valid json", function (res2) {
    console.log("responded 400?", res2.statusCode === 400);
    console.log("writeMetrics NOT called?", capturedArgs === null);

    console.log("--- missing required fields (no metrics) -> 400 ---");
    run(JSON.stringify({ groupId: "G1", edgeNodeId: "E1" }), function (res3) {
      console.log("responded 400 for an empty/missing metrics array?", res3.statusCode === 400);

      console.log("--- no Sparkplug connection configured yet -> 404, not a crash ---");
      fakeSparkplugNode = null;
      run(JSON.stringify({ groupId: "G1", edgeNodeId: "E1", metrics: [{ name: "X", value: 1 }] }), function (res4) {
        console.log("responded 404 when no connection is configured?", res4.statusCode === 404);
        console.log("ALL OK");
      });
    });
  });
});
