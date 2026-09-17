// Real worker_threads.Worker running the real lib/screen-worker.js, driven
// over real HTTP — proves the actual thread-spawning/postMessage PLUMBING
// works, not just the routing logic (already covered, without a real
// thread, by mock-screen-worker.js). Run standalone:
// `node test/mock-screen-worker-integration.js`.
const assert = require("assert");
const http = require("http");
const path = require("path");
const { Worker } = require("worker_threads");

const TIMEOUT_MS = 15000;

function waitForMessage(worker, predicate, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      worker.off("message", onMsg);
      reject(new Error("timed out waiting for a matching worker message"));
    }, timeoutMs);
    function onMsg(msg) {
      if (predicate(msg)) {
        clearTimeout(timer);
        worker.off("message", onMsg);
        resolve(msg);
      }
    }
    worker.on("message", onMsg);
  });
}

function request(port, method, urlPath, body) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ host: "127.0.0.1", port: port, path: urlPath, method: method }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }); });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function main() {
  const worker = new Worker(path.join(__dirname, "..", "lib", "screen-worker.js"), {
    workerData: {
      port: 0,
      project: { screens: [{ path: "/screen1", name: "Real Screen", width: 800, height: 600 }], templates: [] },
      componentScriptSrcs: [],
      sparkplugSnapshot: {}
    }
  });

  console.log("--- a real worker_threads.Worker starts its own real http.Server and reports the actually-bound port ---");
  const listening = await waitForMessage(worker, function (m) { return m.type === "listening"; }, TIMEOUT_MS);
  const port = listening.port;
  console.log("worker reported a real (non-zero) bound port?", typeof port === "number" && port > 0);

  console.log("--- a real HTTP GET against that port renders the deployed screen from workerData ---");
  const screenRes = await request(port, "GET", "/nexa/screen1");
  console.log("real HTTP request rendered the real screen?", screenRes.status === 200 && screenRes.body.indexOf("Real Screen") !== -1);

  console.log("--- a {type:\"sparkplug-delta\"} message posted to the worker is broadcast to a real connected SSE client ---");
  const sseReceived = await new Promise(function (resolve, reject) {
    var buf = "";
    var timer = setTimeout(function () { reject(new Error("SSE client never received the delta")); }, TIMEOUT_MS);
    var req = http.get({ host: "127.0.0.1", port: port, path: "/nexa/_sparkplug-stream" }, function (res) {
      res.on("data", function (chunk) {
        buf += chunk.toString("utf8");
        if (buf.indexOf("data: ") !== -1) { clearTimeout(timer); req.destroy(); resolve(buf); }
      });
    });
    setTimeout(function () {
      worker.postMessage({ type: "sparkplug-delta", serialized: '{"real":"delta"}' });
    }, 200);
  });
  console.log("a real SSE client actually received the pushed delta?", sseReceived.indexOf('data: {"real":"delta"}') !== -1);

  console.log("--- _sparkplug-write round-trips through a real postMessage exchange with the main thread ---");
  const writeReqPromise = waitForMessage(worker, function (m) { return m.type === "write-request"; }, TIMEOUT_MS);
  const writeResPromise = request(port, "POST", "/nexa/_sparkplug-write", JSON.stringify({ groupId: "G1", edgeNodeId: "E1", metrics: [{ name: "X", value: 1 }] }));
  const writeReq = await writeReqPromise;
  worker.postMessage({ type: "write-result", requestId: writeReq.requestId, ok: true });
  const writeRes = await writeResPromise;
  console.log("real write round-trip resolved {ok:true}?", writeRes.status === 200 && JSON.parse(writeRes.body).ok === true);

  console.log("--- graceful close: worker acknowledges and terminates cleanly ---");
  const closedAck = waitForMessage(worker, function (m) { return m.type === "closed"; }, TIMEOUT_MS);
  worker.postMessage({ type: "close" });
  await closedAck;
  await worker.terminate();
  console.log("worker closed and terminated cleanly?", true);

  console.log("ALL OK");
}

const hardTimeout = setTimeout(function () {
  console.error("mock-screen-worker-integration.js: hard overall timeout exceeded — treating as a failure, not hanging forever.");
  process.exit(1);
}, TIMEOUT_MS + 5000);
hardTimeout.unref();

main().then(function () {
  clearTimeout(hardTimeout);
  process.exit(0);
}).catch(function (err) {
  clearTimeout(hardTimeout);
  console.error("FAILED:", err);
  process.exit(1);
});
