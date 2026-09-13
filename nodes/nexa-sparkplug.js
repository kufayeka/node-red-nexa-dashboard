// Config node backing Nexa Dashboard's own "MQTT Sparkplug" sidebar tab —
// a passive Sparkplug B LISTENER (never publishes anything), maintaining a
// live Group -> Edge Node -> Device -> Metric tree (lib/sparkplug/
// sparkplugTree.js) from NBIRTH/DBIRTH/NDATA/DDATA/NDEATH/DDEATH messages.
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

const NAMESPACE = "spBv1.0";

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
    }

    function connect() {
      node.status({ fill: "yellow", shape: "ring", text: "connecting" });
      client = mqtt.connect(brokerUrl, {
        username: username,
        password: password,
        // No identity to protect (this node never publishes anything, only
        // listens) — a unique-per-node id is fine, unlike an Edge Node's own
        // stable clientId requirement.
        clientId: "kufayeka-nexa-sparkplug-" + node.id
      });

      client.on("connect", function () {
        connected = true;
        node.log("Nexa Sparkplug listener connected to " + brokerUrl);
        node.status({ fill: "green", shape: "dot", text: "connected" });
        client.subscribe([nodeTopicFilter, deviceTopicFilter], { qos: 0 }, function (err) {
          if (err) node.warn("Nexa Sparkplug: failed to subscribe: " + describeError(err));
        });
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
      // This node never publishes anything (no Will, no graceful death
      // publish needed) — just tear the connection down.
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
