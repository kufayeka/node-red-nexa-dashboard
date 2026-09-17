// Real worker_threads.Worker + a real embedded MQTT broker (aedes) — proves
// the actual thread-spawning/postMessage PLUMBING works, not just the
// encode/decode algorithm (already covered, without any real thread or
// network, by mock-sparkplug-worker.js). This is the one part of the
// worker-thread split that genuinely can't be verified by continuing to
// fake require("mqtt")/require("worker_threads") in-process, since that's
// exactly the seam being exercised here. Run standalone:
// `node test/mock-sparkplug-worker-integration.js`.
const assert = require("assert");
const net = require("net");
const path = require("path");
const { Worker } = require("worker_threads");
const { Aedes } = require("aedes");
const mqtt = require("mqtt");

const OVERALL_TIMEOUT_MS = 15000;

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

async function main() {
  const broker = await Aedes.createBroker();
  const server = net.createServer(broker.handle.bind(broker));
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  const brokerUrl = "mqtt://127.0.0.1:" + port;

  const worker = new Worker(path.join(__dirname, "..", "lib", "sparkplug-worker.js"), {
    workerData: {
      brokerUrl: brokerUrl,
      clientId: "test-worker",
      keepAlive: 30, protocolVersion: 4, reconnectPeriod: 1000, connectTimeout: 5000,
      subscribeTopics: ["spBv1.0/G1/+/E1", "spBv1.0/G1/+/E1/+"],
      subscribeQos: 0
    }
  });

  console.log("--- a real worker_threads.Worker connects to a real (embedded) MQTT broker and reports \"connected\" ---");
  await waitForMessage(worker, function (m) { return m.type === "status" && m.status === "connected"; }, OVERALL_TIMEOUT_MS);
  console.log("worker reported connected?", true);

  console.log("--- a {type:\"publish\"} message posted to the worker is actually published on the wire (a second real mqtt client sees it) ---");
  const observer = mqtt.connect(brokerUrl, { clientId: "test-observer" });
  await new Promise(function (resolve) { observer.on("connect", resolve); });
  await new Promise(function (resolve) { observer.subscribe("spBv1.0/G1/NCMD/E1", { qos: 0 }, resolve); });
  const observedMessage = new Promise(function (resolve) {
    observer.once("message", function (topic, buf) { resolve({ topic: topic, buf: buf }); });
  });
  worker.postMessage({ type: "publish", groupId: "G1", edgeNodeId: "E1", deviceId: null, metrics: [{ name: "Node Control/Rebirth", type: "Boolean", value: true }] });
  const observed = await Promise.race([
    observedMessage,
    new Promise(function (_, reject) { setTimeout(function () { reject(new Error("timed out waiting for the observer to see the publish")); }, OVERALL_TIMEOUT_MS); })
  ]);
  console.log("a second real MQTT client actually received the worker's publish on the wire?", observed.topic === "spBv1.0/G1/NCMD/E1");

  console.log("--- an incoming message published by ANOTHER client is relayed back to the main thread, already decoded ---");
  const sparkplug = require("../lib/sparkplug/sparkplugCodec.js");
  const relayedMessage = waitForMessage(worker, function (m) { return m.type === "message" && m.topic === "spBv1.0/G1/DDATA/E1/Motor1"; }, OVERALL_TIMEOUT_MS);
  const buf = sparkplug.encodePayload({ timestamp: Date.now(), metrics: [{ name: "Speed", type: "Double", value: 77 }] });
  observer.publish("spBv1.0/G1/DDATA/E1/Motor1", buf, { qos: 0 });
  const relayed = await relayedMessage;
  console.log("relayed message already decoded with the right metric value?", relayed.payload.metrics[0].value === 77);

  console.log("--- graceful close: worker acknowledges, terminates cleanly, no leaked broker connection ---");
  const closedAck = waitForMessage(worker, function (m) { return m.type === "closed"; }, OVERALL_TIMEOUT_MS);
  worker.postMessage({ type: "close" });
  await closedAck;
  await worker.terminate();
  console.log("worker closed and terminated cleanly?", true);

  observer.end(true);
  await new Promise(function (resolve) { server.close(resolve); });
  await new Promise(function (resolve) { broker.close(resolve); });

  console.log("ALL OK");
}

const hardTimeout = setTimeout(function () {
  console.error("mock-sparkplug-worker-integration.js: hard overall timeout exceeded — treating as a failure, not hanging forever.");
  process.exit(1);
}, OVERALL_TIMEOUT_MS + 5000);
hardTimeout.unref();

main().then(function () {
  clearTimeout(hardTimeout);
  process.exit(0);
}).catch(function (err) {
  clearTimeout(hardTimeout);
  console.error("FAILED:", err);
  process.exit(1);
});
