// Worker-thread entry for Nexa Dashboard's Sparkplug MQTT connection.
// Deliberately NOT run on Node-RED's main thread: this owns the actual
// `mqtt.connect()` socket (keepalive, reconnect) and Protobuf encode/decode,
// so neither can ever be starved by whatever else the main thread is doing
// (heavy flow execution elsewhere) — the concrete risk that motivated this
// split was a false NDEATH-equivalent: if the process handling MQTT keepalive
// is busy, a broker can decide the connection is dead. Standard Node.js
// `worker_threads` only — nothing here touches Node's runtime/kernel or
// Node-RED core.
//
// Protocol with the main thread (nodes/nexa-sparkplug.js), all via
// parentPort.postMessage/on("message"):
//   main -> worker: {type:"publish", groupId, edgeNodeId, deviceId, metrics}
//                   {type:"close"}
//   worker -> main: {type:"status", status:"connecting"|"connected"|"reconnecting"|"disconnected"|"error", detail}
//                   {type:"message", topic, payload}   -- one already-decoded Sparkplug payload
//                   {type:"decode-error", topic, error}
//                   {type:"closed"}
//
// All Sparkplug protocol decisions (the live value tree, rebirth tracking,
// when to ask for a rebirth) stay on the main thread exactly as before —
// this worker is a transport + codec boundary, not a place to move business
// logic into.
const { parentPort, workerData } = require("worker_threads");
const mqtt = require("mqtt");
const sparkplug = require("./sparkplug/sparkplugCodec");

const NAMESPACE = "spBv1.0";

function describeError(err) {
    if (!err) return "(no error object)";
    var parts = [];
    if (err.message) parts.push(err.message);
    if (err.code) parts.push("code=" + err.code);
    if (err.errno !== undefined) parts.push("errno=" + err.errno);
    if (err.reason) parts.push("reason=" + err.reason);
    if (parts.length) return parts.join(" ");
    try { return JSON.stringify(err); } catch (e) { return String(err); }
}

function inferMetricType(value) {
    if (typeof value === "boolean") return "Boolean";
    if (typeof value === "number") return "Double";
    return "String";
}

function status(status, detail) {
    parentPort.postMessage({ type: "status", status: status, detail: detail });
}

var client = null;

function connect() {
    status("connecting");
    var connectOpts = {
        username: workerData.username,
        password: workerData.password,
        clientId: workerData.clientId,
        keepalive: workerData.keepAlive,
        protocolVersion: workerData.protocolVersion,
        reconnectPeriod: workerData.reconnectPeriod,
        connectTimeout: workerData.connectTimeout
    };
    if (workerData.rejectUnauthorized !== undefined) connectOpts.rejectUnauthorized = workerData.rejectUnauthorized;
    if (workerData.ca) connectOpts.ca = workerData.ca;
    if (workerData.cert) connectOpts.cert = workerData.cert;
    if (workerData.key) connectOpts.key = workerData.key;

    client = mqtt.connect(workerData.brokerUrl, connectOpts);

    client.on("connect", function () {
        client.subscribe(workerData.subscribeTopics, { qos: workerData.subscribeQos || 0 }, function (err) {
            if (err) status("error", "failed to subscribe: " + describeError(err));
        });
        status("connected");
    });
    client.on("message", function (topic, buf) {
        var payload;
        try {
            payload = sparkplug.decodePayload(buf);
        } catch (e) {
            parentPort.postMessage({ type: "decode-error", topic: topic, error: describeError(e) });
            return;
        }
        parentPort.postMessage({ type: "message", topic: topic, payload: payload });
    });
    client.on("reconnect", function () { status("reconnecting"); });
    client.on("close", function () { status("disconnected"); });
    client.on("error", function (err) { status("error", describeError(err)); });
}

parentPort.on("message", function (msg) {
    if (!msg) return;
    if (msg.type === "publish") {
        if (!client || !client.connected) return;
        var topic = msg.deviceId
            ? NAMESPACE + "/" + msg.groupId + "/DCMD/" + msg.edgeNodeId + "/" + msg.deviceId
            : NAMESPACE + "/" + msg.groupId + "/NCMD/" + msg.edgeNodeId;
        var payload;
        try {
            payload = sparkplug.encodePayload({
                timestamp: Date.now(),
                metrics: msg.metrics.map(function (m) {
                    return { name: m.name, type: m.type || inferMetricType(m.value), value: m.value };
                })
            });
        } catch (e) {
            status("error", "failed to encode a publish for \"" + topic + "\": " + describeError(e));
            return;
        }
        client.publish(topic, payload, { qos: 0, retain: false }, function (err) {
            if (err) status("error", "failed to publish to \"" + topic + "\": " + describeError(err));
        });
        return;
    }
    if (msg.type === "close") {
        if (!client) { parentPort.postMessage({ type: "closed" }); return; }
        client.end(true, {}, function () { parentPort.postMessage({ type: "closed" }); });
    }
});

connect();
