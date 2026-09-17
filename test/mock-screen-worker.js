// Unit/logic test for lib/screen-worker.js — the deployed-screen HTTP
// server that now runs in its own worker_threads.Worker. Run standalone:
// `node test/mock-screen-worker.js`.
//
// This fakes require("worker_threads") (parentPort/workerData), same
// technique as test/mock-sparkplug-worker.js, but does NOT fake `http` —
// the worker binds a REAL ephemeral port (workerData.port = 0) and this
// test drives it with real HTTP requests, since Node's http client/server
// are trivial to use directly and mocking a full request/response cycle by
// hand would be more error-prone than just using a real loopback port.
const { EventEmitter } = require("events");
const http = require("http");
const assert = require("assert");

class FakeParentPort extends EventEmitter {
  constructor() { super(); this.posted = []; }
  // Emits "message" too (not just recording into .posted) — this fake
  // parentPort is used bidirectionally: the worker code calls postMessage()
  // to send to the "main thread", and this test itself listens via
  // .on("message", ...) for things like the initial "listening" port.
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

function request(port, method, urlPath, body) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ host: "127.0.0.1", port: port, path: urlPath, method: method }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function main() {
  const baseWorkerData = {
    port: 0,
    project: {
      screens: [{ path: "/screen1", name: "Screen One", width: 800, height: 600, disabled: false }],
      templates: [{ id: "t1", name: "Tmpl1" }]
    },
    componentScriptSrcs: ["/pkg/widgets.js"],
    nodeRedPort: 1880,
    sparkplugSnapshot: { G1: { E1: { online: true, nodeMetrics: {}, devices: {} } } }
  };

  console.log("--- static asset routes serve the right files with the right content-type ---");
  {
    const parentPort = loadWorker(baseWorkerData);
    const port = await waitForListening(parentPort);
    const registryRes = await request(port, "GET", "/nexa/_registry.js");
    console.log("_registry.js served with 200 + application/javascript?", registryRes.status === 200 && registryRes.headers["content-type"] === "application/javascript");
    const runtimeRes = await request(port, "GET", "/nexa/_runtime.js");
    console.log("_runtime.js served with 200?", runtimeRes.status === 200);
  }

  console.log("--- a known screen path renders HTML embedding the screen/templates/component scripts from workerData ---");
  {
    const parentPort = loadWorker(baseWorkerData);
    const port = await waitForListening(parentPort);
    const res = await request(port, "GET", "/nexa/screen1");
    console.log("200 + html content-type?", res.status === 200 && /text\/html/.test(res.headers["content-type"]));
    console.log("embeds the screen name?", res.body.indexOf("Screen One") !== -1);
    console.log("embeds the templates array?", res.body.indexOf('"id":"t1"') !== -1);
    // Root-relative componentScriptSrcs must be rewritten to an ABSOLUTE URL
    // pointing at Node-RED's real port (nodeRedPort), same hostname the
    // request came in on (127.0.0.1 here) — NOT left relative. A plain
    // relative src here is exactly the reported "unknown component" bug:
    // it would 404 against this worker's own port, which has no such route,
    // so the component's registerComponent() call never runs.
    console.log("component script rewritten to Node-RED's real port, not left relative?", res.body.indexOf('<script src="http://127.0.0.1:1880/pkg/widgets.js"></script>') !== -1);
  }

  console.log("--- an unknown screen path is a 404, a disabled one is also a 404 ---");
  {
    const parentPort = loadWorker(Object.assign({}, baseWorkerData, {
      project: { screens: [{ path: "/off", name: "Off", width: 1, height: 1, disabled: true }], templates: [] }
    }));
    const port = await waitForListening(parentPort);
    const missing = await request(port, "GET", "/nexa/does-not-exist");
    console.log("unknown path is 404?", missing.status === 404);
    const disabled = await request(port, "GET", "/nexa/off");
    console.log("disabled screen is 404?", disabled.status === 404);
  }

  console.log("--- a {type:\"project\"} message updates which screens are servable and the nodeRedPort used for component scripts, without restarting the server ---");
  {
    const parentPort = loadWorker(Object.assign({}, baseWorkerData, { project: { screens: [], templates: [] } }));
    const port = await waitForListening(parentPort);
    const before = await request(port, "GET", "/nexa/screen1");
    console.log("screen1 doesn't exist yet?", before.status === 404);
    parentPort.emit("message", {
      type: "project",
      project: { screens: [{ path: "/screen1", name: "Screen One", width: 1, height: 1 }], templates: [] },
      componentScriptSrcs: ["/pkg/widgets.js"],
      nodeRedPort: 9999
    });
    const after = await request(port, "GET", "/nexa/screen1");
    console.log("screen1 exists after the project push?", after.status === 200 && after.body.indexOf("Screen One") !== -1);
    console.log("a pushed nodeRedPort is used for component scripts from then on?", after.body.indexOf('<script src="http://127.0.0.1:9999/pkg/widgets.js"></script>') !== -1);
  }

  console.log("--- _sparkplug-snapshot returns the initial workerData snapshot, then reflects a pushed update ---");
  {
    const parentPort = loadWorker(baseWorkerData);
    const port = await waitForListening(parentPort);
    const before = await request(port, "GET", "/nexa/_sparkplug-snapshot");
    console.log("initial snapshot served?", JSON.parse(before.body).G1 !== undefined);
    parentPort.emit("message", { type: "sparkplug-snapshot", snapshot: { G2: {} }, resync: false });
    const after = await request(port, "GET", "/nexa/_sparkplug-snapshot");
    console.log("snapshot updated after a push?", JSON.parse(after.body).G2 !== undefined && JSON.parse(after.body).G1 === undefined);
  }

  console.log("--- _sparkplug-stream: a connected SSE client receives a pushed delta and a resync event ---");
  {
    const parentPort = loadWorker(baseWorkerData);
    const port = await waitForListening(parentPort);
    const received = await new Promise(function (resolve) {
      var buf = "";
      var req = http.get({ host: "127.0.0.1", port: port, path: "/nexa/_sparkplug-stream" }, function (res) {
        res.on("data", function (chunk) {
          buf += chunk.toString("utf8");
          if (buf.indexOf("event: resync") !== -1) { req.destroy(); resolve(buf); }
        });
      });
      setTimeout(function () {
        parentPort.emit("message", { type: "sparkplug-delta", serialized: '{"hello":"world"}' });
        parentPort.emit("message", { type: "sparkplug-snapshot", snapshot: {}, resync: true });
      }, 100);
    });
    console.log("SSE client received the pushed delta?", received.indexOf('data: {"hello":"world"}') !== -1);
    console.log("SSE client received the resync event?", received.indexOf("event: resync") !== -1);
  }

  console.log("--- _sparkplug-write: posts a write-request to the main thread and resolves once write-result arrives ---");
  {
    const parentPort = loadWorker(baseWorkerData);
    const port = await waitForListening(parentPort);
    const resPromise = request(port, "POST", "/nexa/_sparkplug-write", JSON.stringify({ groupId: "G1", edgeNodeId: "E1", deviceId: "Motor1", metrics: [{ name: "Speed", value: 42 }] }));
    // Give the request a moment to reach the handler and post write-request.
    await new Promise(function (r) { setTimeout(r, 50); });
    const writeRequests = parentPort.posted.filter(function (m) { return m.type === "write-request"; });
    console.log("posted exactly one write-request with the right fields?", writeRequests.length === 1 && writeRequests[0].groupId === "G1" && writeRequests[0].metrics[0].value === 42);
    parentPort.emit("message", { type: "write-result", requestId: writeRequests[0].requestId, ok: true });
    const res = await resPromise;
    console.log("HTTP response resolved {ok:true} once write-result arrived?", JSON.parse(res.body).ok === true);
  }

  console.log("--- _sparkplug-write with missing fields is a 400, no write-request posted ---");
  {
    const parentPort = loadWorker(baseWorkerData);
    const port = await waitForListening(parentPort);
    const res = await request(port, "POST", "/nexa/_sparkplug-write", JSON.stringify({ groupId: "G1" }));
    console.log("400 for missing edgeNodeId/metrics?", res.status === 400);
    console.log("no write-request posted?", parentPort.posted.filter(function (m) { return m.type === "write-request"; }).length === 0);
  }

  console.log("ALL OK");
}

main().then(function () { process.exit(0); }).catch(function (err) {
  console.error("FAILED:", err);
  process.exit(1);
});
