// Worker-thread entry for Nexa Dashboard's Sparkplug MQTT connection: the MQTT
// socket (keepalive, reconnect) and the Protobuf codec, off Node-RED's main thread
// (a busy main thread must not make the broker think we're dead).
//
// It also keeps its own copy of the live value tree (src/server/sparkplug/sparkplugTree.js)
// and, once the plugin hands it a port to the screen worker, sends the tag deltas
// and takes tag writes THERE directly, so a busy main thread no longer delays tags.
// The main thread still builds its own tree from the same messages (editor sidebar,
// rebirth decisions): nodes/nexa-sparkplug.js is unchanged.
//
// main -> worker (parentPort): {type:"publish", groupId, edgeNodeId, deviceId, metrics}
//                              {type:"screen-port", port}   a MessagePort to the screen worker (transferred)
//                              {type:"close"}
// worker -> main:              {type:"status", status, detail} / {type:"message", topic, payload} (decoded)
//                              {type:"decode-error", topic, error} / {type:"closed"}
// worker -> screen (port):     {type:"snapshot", snapshot}  first, the whole tree
//                              {type:"delta", serialized}   then every change, in order
//                              {type:"write-result", requestId, ok}
// screen -> worker (port):     {type:"write", requestId, groupId, edgeNodeId, deviceId, metrics}
const { parentPort, workerData } = require("worker_threads");
const mqtt = require("mqtt");
const sparkplug = require("../sparkplug/sparkplugCodec");
const tree = require("../sparkplug/sparkplugTree");

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
var dataTree = {};
var screenPort = null;

// the worker's copy of the tree; a change goes straight to the screen worker
function applyToTree(topic, payload) {
    var parts = topic.split("/");
    if (parts[0] !== NAMESPACE) return;
    var delta = tree.applyMessage(dataTree, parts[1], parts[2], parts[3], parts[4], payload);
    if (delta && screenPort) {
        var serialized;
        try { serialized = JSON.stringify(delta); } catch (e) { return; }
        screenPort.postMessage({ type: "delta", serialized: serialized });
    }
}

/** Publishes a DCMD (deviceId) / NCMD; false when not connected or the request is incomplete. */
function publish(msg) {
    if (!client || !client.connected) return false;
    if (!msg.groupId || !msg.edgeNodeId || !Array.isArray(msg.metrics) || !msg.metrics.length) return false;
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
        return false;
    }
    client.publish(topic, payload, { qos: 0, retain: false }, function (err) {
        if (err) status("error", "failed to publish to \"" + topic + "\": " + describeError(err));
    });
    return true;
}

function attachScreenPort(port) {
    if (screenPort) { try { screenPort.close(); } catch (e) { /* already closed */ } }
    screenPort = port;
    port.on("message", function (msg) {
        if (msg && msg.type === "write") {
            port.postMessage({ type: "write-result", requestId: msg.requestId, ok: publish(msg) });
        }
    });
    port.postMessage({ type: "snapshot", snapshot: dataTree });
}

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
        // to main first (postMessage copies it now), then into this worker's own tree
        parentPort.postMessage({ type: "message", topic: topic, payload: payload });
        applyToTree(topic, payload);
    });
    client.on("reconnect", function () { status("reconnecting"); });
    client.on("close", function () { status("disconnected"); });
    client.on("error", function (err) { status("error", describeError(err)); });
}

parentPort.on("message", function (msg) {
    if (!msg) return;
    if (msg.type === "publish") { publish(msg); return; }
    if (msg.type === "screen-port" && msg.port) { attachScreenPort(msg.port); return; }
    if (msg.type === "close") {
        if (!client) { parentPort.postMessage({ type: "closed" }); return; }
        client.end(true, {}, function () { parentPort.postMessage({ type: "closed" }); });
    }
});

connect();
