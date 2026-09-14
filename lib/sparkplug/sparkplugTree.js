// Pure logic: maintains an in-memory Group -> Edge Node -> Device -> Metric
// tree from decoded Sparkplug B messages, for the Nexa Dashboard sidebar's
// "MQTT Sparkplug" explorer tab. Deliberately independent of
// @kufayeka/node-red-asset-engine (which already has its own, richer
// Sparkplug implementation) — Nexa Dashboard is designed to work standalone,
// without a hard dependency on the asset engine (see lib/nexa-plugin.js's
// own getAssetController escape-hatch comment for why cross-plugin
// dependencies here are kept loose).
//
// Shape of the tree returned by getSnapshot():
// {
//   "<groupId>": {
//     "<edgeNodeId>": {
//       online: true,                 // false after an NDEATH
//       nodeMetrics: { "<name>": {value, type, isNull, timestamp} },   // from NBIRTH/NDATA
//       devices: {
//         "<deviceId>": {
//           online: true,              // false after a DDEATH for this device
//           metrics: { "<name>": {value, type, isNull, timestamp} }    // from DBIRTH/DDATA
//         }
//       }
//     }
//   }
// }
// (aliasToName, used internally to resolve alias-only NDATA/DDATA metrics
// back to a name, is intentionally NOT part of this public snapshot shape —
// see applyMetrics below.)
//
// A metric NOT YET seen (no NBIRTH/DBIRTH received for it, or online:false)
// is exactly the "???" case the UI/runtime binding falls back to — this
// module doesn't invent a placeholder value itself, it just reports
// "not present"/"offline" and lets the caller decide how to display that.

function ensureEdgeNode(tree, groupId, edgeNodeId) {
  if (!tree[groupId]) tree[groupId] = {};
  if (!tree[groupId][edgeNodeId]) {
    // aliasToName: alias (number) -> metric name. Spec (p.46): an alias
    // "must be a unique number across this EoN node's entire set of
    // metrics" — i.e. scoped to the whole EDGE NODE, shared by its NBIRTH
    // AND every DBIRTH under it, not per-device. Reset only on a fresh
    // NBIRTH (a new Sparkplug session); a later DBIRTH for one device
    // merges its own metrics' aliases in without touching anyone else's.
    tree[groupId][edgeNodeId] = { online: true, nodeMetrics: {}, devices: {}, aliasToName: {} };
  }
  return tree[groupId][edgeNodeId];
}

function ensureDevice(edgeNode, deviceId) {
  if (!edgeNode.devices[deviceId]) {
    edgeNode.devices[deviceId] = { online: true, metrics: {} };
  }
  return edgeNode.devices[deviceId];
}

function applyMetrics(target, metrics, timestamp, aliasToName) {
  // Returns the full entries just written, not merely their names — a
  // delta consumer (RED.comms / the runtime SSE stream) needs the actual
  // value to update its own cache and re-render, without having to ask
  // back for a full tree just to look up what changed.
  var changed = [];
  (metrics || []).forEach(function (m) {
    if (!m) return;
    var name = m.name;
    if (name && m.alias !== undefined && m.alias !== null && aliasToName) {
      // A BIRTH message defines (or re-defines) this alias for the rest of
      // the session — learn it regardless of whether this particular
      // metric ALSO happens to be a later NDATA/DDATA reusing the same
      // object shape.
      aliasToName[m.alias] = name;
    }
    if (!name && m.alias !== undefined && m.alias !== null && aliasToName) {
      // NDATA/DDATA "can supply only the alias instead of the metric
      // friendly name" (spec p.46) — resolve it back via whatever the
      // most recent BIRTH for this Edge Node established. An alias with no
      // matching BIRTH yet (we joined mid-session and haven't been
      // rebirthed) is unresolvable — dropped below, same as before this
      // existed, rather than surfacing a synthetic "alias:<n>" name.
      name = aliasToName[m.alias];
    }
    if (!name) return;
    var entry = {
      value: m.isNull ? null : m.value,
      type: m.type,
      isNull: !!m.isNull,
      timestamp: m.timestamp !== undefined && m.timestamp !== null ? m.timestamp : timestamp
    };
    target[name] = entry;
    changed.push({ name: name, value: entry.value, type: entry.type, isNull: entry.isNull, timestamp: entry.timestamp });
  });
  return changed;
}

// One call per decoded Sparkplug message. Returns a small delta descriptor
// (or null if the message didn't change anything worth reporting) — this is
// exactly the shape re-published verbatim over RED.comms / the runtime SSE
// stream, so a listener never needs to re-derive it.
function applyMessage(tree, groupId, msgType, edgeNodeId, deviceId, payload) {
  var edgeNode = ensureEdgeNode(tree, groupId, edgeNodeId);

  if (msgType === "NBIRTH") {
    edgeNode.online = true;
    edgeNode.nodeMetrics = {};
    edgeNode.aliasToName = {}; // new session -- every previously-learned alias is void
    var nChanged = applyMetrics(edgeNode.nodeMetrics, payload.metrics, payload.timestamp, edgeNode.aliasToName);
    return { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: null, type: "birth", metrics: nChanged };
  }

  if (msgType === "NDATA") {
    var nDataChanged = applyMetrics(edgeNode.nodeMetrics, payload.metrics, payload.timestamp, edgeNode.aliasToName);
    if (!nDataChanged.length) return null;
    return { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: null, type: "data", metrics: nDataChanged };
  }

  if (msgType === "NDEATH") {
    edgeNode.online = false;
    Object.keys(edgeNode.devices).forEach(function (d) { edgeNode.devices[d].online = false; });
    return { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: null, type: "death" };
  }

  if (!deviceId) return null; // DBIRTH/DDATA/DDEATH all require a device segment

  var device = ensureDevice(edgeNode, deviceId);

  if (msgType === "DBIRTH") {
    device.online = true;
    device.metrics = {};
    var dChanged = applyMetrics(device.metrics, payload.metrics, payload.timestamp, edgeNode.aliasToName);
    return { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: deviceId, type: "birth", metrics: dChanged };
  }

  if (msgType === "DDATA") {
    var dDataChanged = applyMetrics(device.metrics, payload.metrics, payload.timestamp, edgeNode.aliasToName);
    if (!dDataChanged.length) return null;
    return { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: deviceId, type: "data", metrics: dDataChanged };
  }

  if (msgType === "DDEATH") {
    device.online = false;
    return { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: deviceId, type: "death" };
  }

  return null; // NCMD/DCMD/STATE carry no tree-worthy state for a passive listener
}

// Reads the live value for one fully-qualified metric reference, exactly as
// the "sparkplug:" component binding needs it. `deviceId` is null/undefined
// for a node-scoped (NCMD-style) metric. Returns undefined if the value has
// never been seen, or the edge node/device has since gone offline —
// deliberately NOT "???" itself (a display-layer concern, kept out of this
// pure logic module).
function getMetricEntry(tree, groupId, edgeNodeId, deviceId, metricName) {
  var group = tree[groupId];
  var edgeNode = group && group[edgeNodeId];
  if (!edgeNode) return undefined;
  if (!deviceId) {
    if (!edgeNode.online) return undefined;
    return edgeNode.nodeMetrics[metricName];
  }
  var device = edgeNode.devices[deviceId];
  if (!device || !device.online || !edgeNode.online) return undefined;
  return device.metrics[metricName];
}

module.exports = {
  applyMessage: applyMessage,
  getMetricEntry: getMetricEntry
};
