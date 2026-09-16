// Config node backing Nexa Dashboard's own "MQTT Sparkplug" sidebar tab —
// mostly a passive Sparkplug B LISTENER, maintaining a live Group -> Edge
// Node -> Device -> Metric tree (lib/sparkplug/sparkplugTree.js) from
// NBIRTH/DBIRTH/NDATA/DDATA/NDEATH/DDEATH messages. It ALSO publishes two
// kinds of standard Sparkplug command message: a "Node Control/Rebirth"
// NCMD request (see requestRebirth()'s own comment for exactly why that's
// unavoidable — NBIRTH/DBIRTH are one-shot and not broker-retained, so a
// listener that starts after an Edge Node already birthed has no other way
// to ever see its tag definitions/current values), and arbitrary
// NCMD/DCMD value writes (see writeMetrics()), backing the Screen Logic
// graph's "Sparkplug Write"/"Sparkplug Write Multi" nodes.
//
// Deliberately its OWN independent MQTT connection, not a reuse of
// @kufayeka/node-red-asset-engine's kufayeka-sparkplug-in/-edge-node nodes —
// Nexa Dashboard has no hard dependency on that package (see lib/nexa-
// plugin.js's getAssetController comment), and a user may well want Nexa
// pointed at a different broker/scope than whatever Asset Engine is doing.
//
// Same "one singleton, auto-created, edited via a custom UI rather than
// dragged onto a flow" pattern as ../nodes/nexa-project.js's
// kufayeka-nexa-project — see getOrCreateSparkplugConfigNode() in
// src/canvas/sparkplug-live.js for the editor-side half of that.
const mqtt = require("mqtt");
const sparkplug = require("../lib/sparkplug/sparkplugCodec");
const tree = require("../lib/sparkplug/sparkplugTree");
const { RebirthTracker } = require("../lib/sparkplug/sparkplugRebirth");

const NAMESPACE = "spBv1.0";
const REBIRTH_COOLDOWN_MS = 10000;

// Module-level (not inside the RED-scoped export below), same reasoning as
// nexa-project.js's own currentProject: a DIFFERENT file (lib/nexa-plugin.js)
// needs to reach whichever instance is currently deployed, via the exported
// getCurrentSparkplugNode() below, regardless of which plugin's own fresh
// `RED` object it was created through.
var currentSparkplugNode = null;

// See nodes/sparkplug-edge-node.js in @kufayeka/node-red-asset-engine for
// why plain `err.message` isn't enough — some errors from `mqtt`/net/tls
// carry the useful detail on .code/.errno/.reason instead, or nowhere normal.
function describeError(err) {
  if (!err) return "(no error object)";
  var parts = [];
  if (err.message) parts.push(err.message);
  if (err.code) parts.push("code=" + err.code);
  if (err.errno !== undefined) parts.push("errno=" + err.errno);
  if (err.reason) parts.push("reason=" + err.reason);
  if (parts.length) return parts.join(" ");
  try {
    return JSON.stringify(err);
  } catch (e) {
    return String(err);
  }
}

module.exports = function (RED) {
  function NexaSparkplugNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    currentSparkplugNode = node;

    var brokerUrl = config.brokerUrl || "mqtt://localhost:1883";
    var username = node.credentials && node.credentials.username;
    var password = node.credentials && node.credentials.password;
    var groupFilter = config.groupFilter && config.groupFilter.trim() ? config.groupFilter.trim() : "+";
    var edgeNodeFilter = config.edgeNodeFilter && config.edgeNodeFilter.trim() ? config.edgeNodeFilter.trim() : "+";

    var nodeTopicFilter = NAMESPACE + "/" + groupFilter + "/+/" + edgeNodeFilter;
    var deviceTopicFilter = NAMESPACE + "/" + groupFilter + "/+/" + edgeNodeFilter + "/+";

    var client = null;
    var closing = false;
    var connected = false;
    var dataTree = {};
    var listeners = [];
    var rebirthTracker = new RebirthTracker(REBIRTH_COOLDOWN_MS);

    function emitDelta(delta) {
      listeners.forEach(function (fn) {
        try {
          fn(delta);
        } catch (e) {
          // one bad listener (e.g. a comms-publish call that throws because
          // the editor socket just dropped) must not stop the others.
          node.warn("Nexa Sparkplug: a tree-change listener threw: " + describeError(e));
        }
      });
    }

    // --- Public surface, read by lib/nexa-plugin.js (comms/REST/SSE
    // wiring) and by the editor bundle indirectly via those same channels.
    node.subscribeTree = function (fn) {
      listeners.push(fn);
      return function () {
        var idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    };
    node.getSnapshot = function () {
      return dataTree;
    };
    node.getMetricValue = function (groupId, edgeNodeId, deviceId, metricName) {
      return tree.getMetricEntry(dataTree, groupId, edgeNodeId, deviceId, metricName);
    };
    node.isConnected = function () {
      return connected;
    };

    // [tck-id-payloads-ncmd-qos]: MUST be QoS 0, not retained — matches
    // @kufayeka/node-red-asset-engine's own sparkplug-out.js, which
    // publishes this exact same request from the opposite side (a Host
    // Application requesting an Edge Node rebirth itself).
    function requestRebirth(groupId, edgeNodeId) {
      if (!client || !connected) return;
      var topic = NAMESPACE + "/" + groupId + "/NCMD/" + edgeNodeId;
      var payload;
      try {
        payload = sparkplug.encodePayload({
          timestamp: Date.now(),
          metrics: [{ name: "Node Control/Rebirth", type: "Boolean", value: true }]
        });
      } catch (e) {
        node.warn("Nexa Sparkplug: failed to encode a Rebirth request for \"" + groupId + "/" + edgeNodeId + "\": " + describeError(e));
        return;
      }
      client.publish(topic, payload, { qos: 0, retain: false }, function (err) {
        if (err) node.warn("Nexa Sparkplug: failed to publish Rebirth request to \"" + topic + "\": " + describeError(err));
      });
    }

    // Value write-back (Screen Logic's "Sparkplug Write"/"Sparkplug Write
    // Multi" nodes, via the public REST endpoint in lib/nexa-plugin.js — a
    // deployed page can't hold this node's own MQTT client directly, only
    // reach it over HTTP). Publishes a DCMD (deviceId given) or NCMD
    // (deviceId falsy — a node-scoped write), the exact same shape/QoS as
    // requestRebirth's own NCMD above and as
    // @kufayeka/node-red-asset-engine's sparkplug-out.js — this is not a
    // second write mechanism, just this package's own client publishing the
    // same standard Sparkplug command message.
    // `metrics`: [{ name, value }, ...] — the wire DataType isn't something
    // a browser-side Logic node has any reason to know or declare, so each
    // value's type is inferred from its own JS typeof, same convention
    // sparkplugCodec.js's encodeProperties already uses for the (also
    // generic, caller-supplied-value) `properties` map.
    function inferMetricType(value) {
      if (typeof value === "boolean") return "Boolean";
      if (typeof value === "number") return "Double";
      return "String";
    }
    node.writeMetrics = function (groupId, edgeNodeId, deviceId, metrics) {
      if (!client || !connected) return false;
      if (!groupId || !edgeNodeId || !Array.isArray(metrics) || !metrics.length) return false;
      var topic = deviceId
        ? NAMESPACE + "/" + groupId + "/DCMD/" + edgeNodeId + "/" + deviceId
        : NAMESPACE + "/" + groupId + "/NCMD/" + edgeNodeId;
      var payload;
      try {
        payload = sparkplug.encodePayload({
          timestamp: Date.now(),
          metrics: metrics.map(function (m) {
            return { name: m.name, type: inferMetricType(m.value), value: m.value };
          })
        });
      } catch (e) {
        node.warn("Nexa Sparkplug: failed to encode a write for \"" + topic + "\": " + describeError(e));
        return false;
      }
      client.publish(topic, payload, { qos: 0, retain: false }, function (err) {
        if (err) node.warn("Nexa Sparkplug: failed to publish write to \"" + topic + "\": " + describeError(err));
      });
      return true;
    };

    // Manual "Rebirth / Refresh" trigger (sidebar button + REST endpoint,
    // see lib/nexa-plugin.js) — unlike the automatic trigger below, this
    // bypasses the tracker's "already birthed"/cooldown checks entirely: a
    // user explicitly asking for a refresh should always get one, even if
    // this listener already believes everything is up to date. Requests a
    // rebirth from every Edge Node currently known (from the tree built up
    // so far), plus the configured filter pair itself if it's concrete and
    // we haven't seen anything from it yet. Returns how many requests were
    // actually sent, purely so the REST endpoint/UI can report something
    // meaningful ("no Edge Node known yet" vs "asked N Edge Nodes").
    node.requestRebirthAll = function () {
      var seen = {};
      var count = 0;
      Object.keys(dataTree).forEach(function (groupId) {
        Object.keys(dataTree[groupId]).forEach(function (edgeNodeId) {
          seen[groupId + "::" + edgeNodeId] = true;
          requestRebirth(groupId, edgeNodeId);
          count++;
        });
      });
      if (groupFilter !== "+" && edgeNodeFilter !== "+" && !seen[groupFilter + "::" + edgeNodeFilter]) {
        requestRebirth(groupFilter, edgeNodeFilter);
        count++;
      }
      return count;
    };

    function onMessage(topic, buf) {
      var parts = topic.split("/");
      if (parts[0] !== NAMESPACE) return;
      var groupId = parts[1];
      var msgType = parts[2];
      var edgeNodeId = parts[3];
      var deviceId = parts[4];
      var payload;
      try {
        payload = sparkplug.decodePayload(buf);
      } catch (e) {
        node.warn("Nexa Sparkplug: failed to decode payload on \"" + topic + "\": " + describeError(e));
        return;
      }
      var delta = tree.applyMessage(dataTree, groupId, msgType, edgeNodeId, deviceId, payload);
      if (delta) emitDelta(delta);

      // Auto-recovery for the actual root cause reported: NBIRTH/DBIRTH are
      // published exactly once and are NOT broker-retained (spec: only the
      // Death Certificate/Will and Host STATE messages are), so a listener
      // that starts (or a browser tab that opens) AFTER an Edge Node's birth
      // already happened would otherwise never see its tag definitions or
      // current values — only whatever changes to arrive AFTER it started
      // watching. Seeing NDATA/DDATA/DBIRTH for an Edge Node we've never
      // seen an NBIRTH from means exactly that: ask it to rebirth, so its
      // full definition (and every metric alias — see sparkplugTree.js)
      // becomes available. RebirthTracker's cooldown keeps this from
      // spamming an Edge Node that's slow to respond or doesn't support it.
      if (msgType === "NBIRTH") {
        rebirthTracker.markBirthed(groupId, edgeNodeId);
      } else if (msgType === "NDEATH") {
        rebirthTracker.markDead(groupId, edgeNodeId);
      } else if (msgType === "NDATA" || msgType === "DDATA" || msgType === "DBIRTH") {
        if (rebirthTracker.shouldRequest(groupId, edgeNodeId, Date.now())) {
          node.log("Nexa Sparkplug: requesting Rebirth from \"" + groupId + "/" + edgeNodeId + "\" (its own NBIRTH was never seen)");
          requestRebirth(groupId, edgeNodeId);
        }
      }
    }

    function connect() {
      node.status({ fill: "yellow", shape: "ring", text: "connecting" });
      client = mqtt.connect(brokerUrl, {
        username: username,
        password: password,
        // No CONTROL-PLANE identity to protect (this listener publishes
        // only the one standard, harmless Rebirth request above, never a
        // Will/Death Certificate of its own) — a unique-per-node id is
        // fine, unlike an Edge Node's own stable clientId requirement.
        clientId: "kufayeka-nexa-sparkplug-" + node.id
      });

      client.on("connect", function () {
        connected = true;
        node.log("Nexa Sparkplug listener connected to " + brokerUrl);
        node.status({ fill: "green", shape: "dot", text: "connected" });
        client.subscribe([nodeTopicFilter, deviceTopicFilter], { qos: 0 }, function (err) {
          if (err) node.warn("Nexa Sparkplug: failed to subscribe: " + describeError(err));
        });
        // A wildcard filter ("+") has no single concrete Edge Node to ask
        // yet — MQTT publish topics can't themselves contain a wildcard, so
        // the best this can do there is wait for onMessage's own per-message
        // trigger above. A fully concrete group+edge node filter, though, IS
        // one specific Edge Node we already know we want — no reason to
        // wait for its first message before asking.
        if (groupFilter !== "+" && edgeNodeFilter !== "+") {
          requestRebirth(groupFilter, edgeNodeFilter);
        }
      });
      client.on("message", onMessage);
      client.on("reconnect", function () {
        connected = false;
        node.status({ fill: "yellow", shape: "ring", text: "reconnecting" });
      });
      client.on("close", function () {
        connected = false;
        if (!closing) {
          node.status({ fill: "red", shape: "ring", text: "disconnected" });
          node.warn("Nexa Sparkplug: MQTT connection closed (client will auto-reconnect)");
        }
      });
      client.on("error", function (err) {
        connected = false;
        node.status({ fill: "red", shape: "ring", text: "error" });
        node.warn("Nexa Sparkplug MQTT error: " + describeError(err));
      });
    }

    connect();

    node.on("close", function (done) {
      closing = true;
      if (currentSparkplugNode === node) currentSparkplugNode = null;
      if (!client) { done(); return; }
      // This node registers no Will/Death Certificate of its own (it's not
      // an Edge Node — no graceful death publish needed on shutdown) — just
      // tear the connection down.
      client.end(true, {}, function () { done(); });
    });
  }

  RED.nodes.registerType("kufayeka-nexa-sparkplug", NexaSparkplugNode, {
    credentials: {
      username: { type: "text" },
      password: { type: "password" }
    }
  });
};

module.exports.getCurrentSparkplugNode = function () {
  return currentSparkplugNode;
};
