// Editor-side live cache + binding-path grammar for Nexa Dashboard's own
// MQTT Sparkplug connection (nodes/nexa-sparkplug.js). Shared by the
// sidebar's "MQTT Sparkplug" explorer tab (src/sidebar/sparkplug-panel.js)
// and by component rendering (src/canvas/component-renderer.js) — both need
// the exact same live value cache and "???" fallback rule.
import { getOrCreateProjectConfigNode } from "../state.js";
//
// Binding syntax a dropped component's prop carries, e.g. props.text:
//   "{sparkplug:<groupId>::<edgeNodeId>::<deviceId>::<metricName>}"
// "::" (NOT "/") separates the four fields deliberately: a Sparkplug metric
// NAME can itself contain "/" (its own hierarchical naming convention, e.g.
// "Line1/Motor1/Speed" for a nested asset), so "/" can't double as this
// syntax's own field separator without ambiguity. `deviceId` is the empty
// string between its two "::" for a node-scoped (no Device segment) metric.
export var SPARKPLUG_BINDING_PREFIX = "sparkplug:";

export function makeSparkplugBindingPath(ref) {
    return "{" + SPARKPLUG_BINDING_PREFIX + ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "") + "::" + ref.metricName + "}";
}

// Returns {groupId, edgeNodeId, deviceId (or null), metricName} or null if
// `raw` isn't a whole "{sparkplug:...}" binding string (mirrors component-
// renderer.js's own WHOLE_BINDING_RE contract: this only recognizes the
// WHOLE prop value as one binding, not one embedded in a bigger string —
// a Sparkplug value's live type shouldn't get silently flattened to text by
// treating it the same as the generic {path} interpolation string form).
export function parseSparkplugBindingPath(raw) {
    if (typeof raw !== "string") return null;
    var trimmed = raw.trim();
    if (trimmed.charAt(0) !== "{" || trimmed.charAt(trimmed.length - 1) !== "}") return null;
    var inner = trimmed.slice(1, -1);
    if (inner.indexOf(SPARKPLUG_BINDING_PREFIX) !== 0) return null;
    var parts = inner.slice(SPARKPLUG_BINDING_PREFIX.length).split("::");
    if (parts.length < 4) return null;
    // Everything from the 4th field on rejoins with "::" -- an extremely
    // unlikely but possible metric name containing "::" itself shouldn't
    // get truncated at the first occurrence.
    var metricName = parts.slice(3).join("::");
    if (!parts[0] || !parts[1] || !metricName) return null;
    return { groupId: parts[0], edgeNodeId: parts[1], deviceId: parts[2] || null, metricName: metricName };
}

function refKey(ref) {
    return ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "") + "::" + ref.metricName;
}

// One-shot "is this prop string a sparkplug binding, and if so what's its
// refKey" — the exact same key format applyDelta's own `changed` array uses
// (see notify() below), so a caller building a tag->component reverse index
// (component-renderer.js's ensureSparkplugLiveRenderWired) can match a
// changed key straight back to a component's binding without re-deriving
// the key format itself and risking the two drifting apart.
export function refKeyOfBindingString(raw) {
    var ref = parseSparkplugBindingPath(raw);
    return ref ? refKey(ref) : null;
}

var liveCache = {}; // refKey(ref) -> {value, type, isNull, online}
// Mirrors lib/sparkplug/sparkplugTree.js's own shape exactly (group ->
// edge node -> device -> metric) — duplicated here rather than shared,
// same as nexa-runtime-client.js already duplicates component-renderer.js's
// interpolation logic verbatim: this is browser ES-module code bundled by
// esbuild, that file is a plain Node.js CommonJS module, and this bit of
// bookkeeping is small enough that sharing it isn't worth the two module
// systems' friction. Used ONLY for the sidebar explorer tree's own
// rendering (src/sidebar/sparkplug-panel.js) — value lookups/formatting go
// through liveCache above instead.
var rawTree = {};
var updateListeners = [];
var commsWired = false;

// `fn(changedKeys)` is called with the list of refKey() strings that just
// changed — a component-render loop can cheaply check whether ITS OWN
// binding's refKey is in that list before doing any work, instead of every
// bound component re-rendering on every single unrelated metric tick.
export function onSparkplugLiveUpdate(fn) {
    updateListeners.push(fn);
}

function notify(changedKeys) {
    updateListeners.forEach(function (fn) {
        try { fn(changedKeys); } catch (e) { /* one bad listener shouldn't break the others */ }
    });
}

function ensureRawEdgeNode(groupId, edgeNodeId) {
    if (!rawTree[groupId]) rawTree[groupId] = {};
    if (!rawTree[groupId][edgeNodeId]) rawTree[groupId][edgeNodeId] = { online: true, nodeMetrics: {}, devices: {} };
    return rawTree[groupId][edgeNodeId];
}
function ensureRawDevice(edgeNode, deviceId) {
    if (!edgeNode.devices[deviceId]) edgeNode.devices[deviceId] = { online: true, metrics: {} };
    return edgeNode.devices[deviceId];
}

function applyDelta(delta) {
    if (!delta) return;
    var changed = [];
    var edgeNode = ensureRawEdgeNode(delta.groupId, delta.edgeNodeId);
    var metricsTarget;

    if (delta.type === "death") {
        // A death delta carries no metrics array -- mark the whole edge
        // node (deviceId null: NDEATH) or just this one device (deviceId
        // set: DDEATH) offline, and every already-cached leaf under it, so
        // a bound component falls back to "???" instead of freezing on
        // whatever value it last saw forever.
        if (delta.deviceId) {
            ensureRawDevice(edgeNode, delta.deviceId).online = false;
        } else {
            edgeNode.online = false;
        }
        var nodePrefix = delta.groupId + "::" + delta.edgeNodeId + "::";
        var devicePrefix = delta.deviceId ? nodePrefix + delta.deviceId + "::" : null;
        Object.keys(liveCache).forEach(function (key) {
            if (devicePrefix ? key.indexOf(devicePrefix) !== 0 : key.indexOf(nodePrefix) !== 0) return;
            if (liveCache[key].online) {
                liveCache[key] = Object.assign({}, liveCache[key], { online: false });
                changed.push(key);
            }
        });
    } else {
        if (delta.type === "birth") {
            if (delta.deviceId) {
                var dev = ensureRawDevice(edgeNode, delta.deviceId);
                dev.online = true;
                dev.metrics = {};
                metricsTarget = dev.metrics;
            } else {
                edgeNode.online = true;
                edgeNode.nodeMetrics = {};
                metricsTarget = edgeNode.nodeMetrics;
            }
        } else {
            metricsTarget = delta.deviceId ? ensureRawDevice(edgeNode, delta.deviceId).metrics : edgeNode.nodeMetrics;
        }
        (delta.metrics || []).forEach(function (m) {
            var entry = {
                value: m.value,
                type: m.type,
                isNull: m.isNull,
                timestamp: m.timestamp,
                properties: m.properties || null,
                metadata: m.metadata || null,
                engUnit: m.engUnit || null,
                isHistorical: !!m.isHistorical,
                isTransient: !!m.isTransient
            };
            metricsTarget[m.name] = entry;
            var key = delta.groupId + "::" + delta.edgeNodeId + "::" + (delta.deviceId || "") + "::" + m.name;
            liveCache[key] = {
                value: m.value,
                type: m.type,
                isNull: m.isNull,
                online: true,
                timestamp: m.timestamp,
                properties: m.properties || null,
                metadata: m.metadata || null,
                engUnit: m.engUnit || null,
                isHistorical: !!m.isHistorical,
                isTransient: !!m.isTransient
            };
            changed.push(key);
        });
    }
    if (changed.length) notify(changed);
}

export function getSparkplugEntry(ref) {
    return liveCache[refKey(ref)];
}

// Formats epoch timestamp into SCADA-standard "YYYY-MM-DD h:mm:ss A" (matching Ignition Tag Browser)
export function formatSparkplugTimestamp(ts) {
    if (!ts) return "";
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return String(ts);
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1);
    if (mm.length < 2) mm = "0" + mm;
    var dd = String(d.getDate());
    if (dd.length < 2) dd = "0" + dd;
    var hours = d.getHours();
    var minutes = String(d.getMinutes());
    if (minutes.length < 2) minutes = "0" + minutes;
    var seconds = String(d.getSeconds());
    if (seconds.length < 2) seconds = "0" + seconds;
    var ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return yyyy + "-" + mm + "-" + dd + " " + hours + ":" + minutes + ":" + seconds + " " + ampm;
}

// The full Group -> Edge Node -> Device -> Metric structure, for the
// sidebar explorer tree to render (src/sidebar/sparkplug-panel.js). Live
// values for display should still go through formatSparkplugValue/
// getSparkplugEntry above, not by reading .value off this directly — this
// exists for STRUCTURE (what nodes/devices/metrics exist), not as a second
// value source to keep in sync.
export function getRawTree() {
    return rawTree;
}

// Every metric currently known (from any NBIRTH/DBIRTH/NDATA/DDATA seen so
// far), as {ref, binding, label} — used by the "Sparkplug Write"/"Sparkplug
// Write Multi" Logic node dialogs (src/dialogs/) to offer a pick-from-list
// autocomplete instead of requiring the exact "{sparkplug:...}" syntax to
// be typed by hand, the same DX asset-write.html's own path autocomplete
// gives for a plain asset attribute path.
export function listKnownSparkplugBindings() {
    var out = [];
    Object.keys(rawTree).forEach(function (groupId) {
        var edgeNodes = rawTree[groupId];
        Object.keys(edgeNodes).forEach(function (edgeNodeId) {
            var edgeNode = edgeNodes[edgeNodeId];
            Object.keys(edgeNode.nodeMetrics || {}).forEach(function (name) {
                var ref = { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: null, metricName: name };
                out.push({ ref: ref, binding: makeSparkplugBindingPath(ref), label: groupId + "/" + edgeNodeId + "/" + name });
            });
            Object.keys(edgeNode.devices || {}).forEach(function (deviceId) {
                var device = edgeNode.devices[deviceId];
                Object.keys(device.metrics || {}).forEach(function (name) {
                    var ref = { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: deviceId, metricName: name };
                    out.push({ ref: ref, binding: makeSparkplugBindingPath(ref), label: groupId + "/" + edgeNodeId + "/" + deviceId + "/" + name });
                });
            });
        });
    });
    return out.sort(function (a, b) { return a.label.localeCompare(b.label); });
}

// The single shared "no real value yet" formatter — used by both the
// drag-drop default text and the live render path, so a freshly-dropped
// component and one whose Edge Node just went offline can never show two
// different placeholders for the same "nothing to show" situation.
export function formatSparkplugValue(ref) {
    var entry = getSparkplugEntry(ref);
    if (!entry || !entry.online || entry.isNull || entry.value === undefined || entry.value === null) return "???";
    return String(entry.value);
}

// Resolves every "{sparkplug:...}" string prop to its live (or "???")
// display value — applied UNCONDITIONALLY (unlike the generic {path}
// template-param interpolation, which only runs inside a "@template"
// instance's own scope), since a Sparkplug-bound value lives in this
// module's global cache, not any one component's enclosing scope. Returns
// the SAME object back untouched when nothing in it is a sparkplug binding,
// so a caller that doesn't otherwise need a copy doesn't pay for one.
export function resolveSparkplugProps(props) {
    var out = null;
    Object.keys(props || {}).forEach(function (k) {
        var v = props[k];
        if (Array.isArray(v)) {
            // an SDK component's `multiple` input: an array of tag bindings
            if (!v.some(function (x) { return parseSparkplugBindingPath(x); })) return;
            if (!out) out = Object.assign({}, props);
            out[k] = v.map(function (x) { var r = parseSparkplugBindingPath(x); return r ? formatSparkplugValue(r) : x; });
            return;
        }
        if (typeof v !== "string") return;
        var ref = parseSparkplugBindingPath(v);
        if (!ref) return;
        if (!out) out = Object.assign({}, props);
        out[k] = formatSparkplugValue(ref);
    });
    return out || props;
}

function absorbSnapshotTree(tree) {
    rawTree = tree || {};
    liveCache = {};
    Object.keys(tree || {}).forEach(function (groupId) {
        Object.keys(tree[groupId] || {}).forEach(function (edgeNodeId) {
            var edgeNode = tree[groupId][edgeNodeId];
            Object.keys(edgeNode.nodeMetrics || {}).forEach(function (name) {
                var m = edgeNode.nodeMetrics[name] || {};
                liveCache[groupId + "::" + edgeNodeId + "::" + "::" + name] = {
                    value: m.value,
                    type: m.type,
                    isNull: m.isNull,
                    online: edgeNode.online,
                    timestamp: m.timestamp,
                    properties: m.properties || null,
                    metadata: m.metadata || null,
                    engUnit: m.engUnit || null,
                    isHistorical: !!m.isHistorical,
                    isTransient: !!m.isTransient
                };
            });
            Object.keys(edgeNode.devices || {}).forEach(function (deviceId) {
                var device = edgeNode.devices[deviceId];
                Object.keys(device.metrics || {}).forEach(function (name) {
                    var m = device.metrics[name] || {};
                    liveCache[groupId + "::" + edgeNodeId + "::" + deviceId + "::" + name] = {
                        value: m.value,
                        type: m.type,
                        isNull: m.isNull,
                        online: edgeNode.online && device.online,
                        timestamp: m.timestamp,
                        properties: m.properties || null,
                        metadata: m.metadata || null,
                        engUnit: m.engUnit || null,
                        isHistorical: !!m.isHistorical,
                        isTransient: !!m.isTransient
                    };
                });
            });
        });
    });
}

// Fetched once on demand (sidebar tab open, or first live render need) —
// RED.comms only delivers deltas going FORWARD from whenever a listener
// subscribes, never history, so this is the only way to see values that
// were already live before this editor tab was opened.
export function loadSparkplugSnapshot(onDone) {
    // window.$.getJSON isn't present in the hand-rolled DOM-shim test
    // harness (see test/mock-*.js) — a real editor always has jQuery
    // loaded; skipping there just means those tests exercise everything
    // else about this module without a real snapshot round-trip.
    if (!window.$ || typeof window.$.getJSON !== "function") {
        if (typeof onDone === "function") onDone(null);
        return;
    }
    window.$.getJSON("nexa-dashboard/_sparkplug-tree", function (tree) {
        absorbSnapshotTree(tree);
        notify(Object.keys(liveCache));
        if (typeof onDone === "function") onDone(tree);
    }).fail(function () {
        if (typeof onDone === "function") onDone(null);
    });
}

export function ensureSparkplugCommsWired() {
    if (commsWired) return;
    commsWired = true;
    // Unconditional initial fetch — by the time this tab is opened, the
    // editor's own comms WebSocket has almost always ALREADY connected
    // (comms.js connects at editor startup), so a "connect" listener
    // registered only now would never retroactively fire for that first
    // connection and we'd never get an initial snapshot at all.
    loadSparkplugSnapshot();
    if (window.RED && window.RED.comms && window.RED.comms.subscribe) {
        // The runtime batches these (lib/sparkplug/deltaBatcher.js) — an
        // ARRAY of deltas per message; a single delta is still accepted.
        window.RED.comms.subscribe("nexa/sparkplug/delta", function (topic, delta) {
            if (Array.isArray(delta)) delta.forEach(applyDelta);
            else applyDelta(delta);
        });
    }
    // ...but "connect" ALSO fires again after every subsequent automatic
    // reconnect (Node-RED's own comms.js re-emits it each time its
    // WebSocket re-establishes) — a delta stream alone can never recover
    // whatever changed while disconnected, so THAT'S where a fresh resync
    // belongs too, not just once at tab-open. Same bug/fix as the deployed
    // runtime's own SSE handling in nexa-runtime-client.js.
    if (window.RED && window.RED.comms && typeof window.RED.comms.on === "function") {
        window.RED.comms.on("connect", loadSparkplugSnapshot);
    }
    // A REAL, SEPARATE bug this used to miss entirely: editing
    // kufayeka-nexa-sparkplug's own settings (broker URL, group/edge
    // filter) and clicking Deploy does NOT reconnect the editor's comms
    // WebSocket at all — that connection is completely independent of a
    // flow deploy. What actually happens server-side is
    // nodes/nexa-sparkplug.js's node instance gets closed and a BRAND NEW
    // one created (new empty tree, new mqtt client) — lib/nexa-plugin.js's
    // wireSparkplugSubscription() picks up that new instance for FUTURE
    // deltas, but the tree already cached here from BEFORE the deploy was
    // never invalidated, so the sidebar kept showing stale data
    // indefinitely with nothing to prompt a refetch. RED.events.emit
    // ("deploy") (editor-client's deploy.js) fires client-side right after
    // every successful deploy — including a config-node-only edit — so
    // this is the actual hook for "connection settings changed, go get a
    // fresh tree", not RED.comms at all.
    if (window.RED && window.RED.events && typeof window.RED.events.on === "function") {
        window.RED.events.on("deploy", function () {
            loadSparkplugSnapshot();
            // The server-side close-old/create-new swap isn't necessarily
            // finished the instant this fires (deploy.js emits it right
            // after the HTTP deploy call resolves, not after the runtime
            // has actually finished restarting flows) — one extra fetch a
            // moment later catches the tree once the new node has actually
            // connected, without needing a real retry/backoff loop: if the
            // new Edge Node hasn't published anything yet by then either,
            // the ordinary live delta stream fills it in from here on.
            setTimeout(loadSparkplugSnapshot, 1500);
        });
    }
}

// kufayeka-nexa-sparkplug is a REAL, multi-instance Node-RED config node
// (like @kufayeka/node-red-asset-engine's kufayeka-sparkplug-edge-node) —
// several can exist (e.g. pointed at different brokers), each independently
// connected. WHICH one is active for the current project is just a normal
// config-node reference, picked via the project's own "Sparkplug Connection"
// field (nodes/nexa-project.js/.html) — there's no "the one" connection to
// auto-create/reuse anymore (that used to silently collapse multiple
// connections to a last-one-wins singleton).
//
// Opens the project's chosen connection's own edit dialog if one is set, or
// the PROJECT's edit dialog (which has the "Sparkplug Connection" picker —
// pick an existing kufayeka-nexa-sparkplug instance, or "Add new
// kufayeka-nexa-sparkplug...") if none is set yet. Both reuse Node-RED's
// own built-in, auto-generated (defaults/credentials-driven) edit trays —
// their credential handling/encryption for free, rather than hand-rolling a
// settings dialog.
export function openSparkplugConnectionSettings() {
    var RED = window.RED;
    var project = getOrCreateProjectConfigNode();
    if (!project) return;
    if (project.sparkplugConnection && RED.nodes.node(project.sparkplugConnection)) {
        RED.editor.editConfig("", "kufayeka-nexa-sparkplug", project.sparkplugConnection);
        return;
    }
    RED.editor.editConfig("", "kufayeka-nexa-project", project.id);
}

// Manual "Rebirth / Refresh" trigger (src/sidebar/sparkplug-panel.js's
// toolbar button) — see nodes/nexa-sparkplug.js's requestRebirthAll() for
// why this exists even though missing births are also recovered from
// automatically: NBIRTH/DBIRTH are one-shot and not broker-retained, so a
// user should always be able to force a fresh one on demand rather than
// only ever wait on the automatic path (which itself waits for at least
// one DATA message, or a concrete non-wildcard filter, before it acts).
export function requestSparkplugRebirth() {
    if (!window.$ || typeof window.$.ajax !== "function") return;
    window.$.ajax({ url: "nexa-dashboard/_sparkplug-rebirth", type: "POST" })
        .done(function (resp) {
            var count = (resp && resp.requested) || 0;
            if (window.RED && window.RED.notify) {
                window.RED.notify(
                    count > 0
                        ? "Requested Rebirth from " + count + " Edge Node" + (count === 1 ? "" : "s")
                        : "No Edge Node known yet to request a Rebirth from — check the connection settings.",
                    { type: count > 0 ? "success" : "warning", timeout: 3000 }
                );
            }
        })
        .fail(function () {
            if (window.RED && window.RED.notify) {
                window.RED.notify("Failed to request Rebirth — is the Nexa Sparkplug connection configured?", { type: "error", timeout: 3000 });
            }
        });
}
