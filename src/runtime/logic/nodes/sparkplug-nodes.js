// Sparkplug Write Nodes Handlers
// Implementations for sparkplug-write and sparkplug-write-multi nodes.

import { parseSparkplugBindingPath } from "../../io/sparkplug.js";
import { sendSparkplugWrite } from "../../io/client.js";

export function runSparkplugWriteNode(screen, node, msg, budget, continuePropagation, outMsg) {
    const writeRef = parseSparkplugBindingPath(node.tag);
    if (!writeRef) {
        console.error("[nexa-logic] sparkplug-write node " + node.id + ": \"" + node.tag + "\" is not a valid {sparkplug:...} binding");
        return;
    }
    sendSparkplugWrite(writeRef.groupId, writeRef.edgeNodeId, writeRef.deviceId, [{ name: writeRef.metricName, value: msg && msg.payload }])
        .then(function () { continuePropagation(screen, node, outMsg, budget); })
        .catch(function (e) { console.error("[nexa-logic] sparkplug-write node " + node.id + " failed:", e); });
}

export function runSparkplugWriteMultiNode(screen, node, msg, budget, continuePropagation, outMsg) {
    const writes = (msg && Array.isArray(msg.writes)) ? msg.writes : [];
    if (!writes.length) {
        console.error("[nexa-logic] sparkplug-write-multi node " + node.id + ": msg.writes must be a non-empty array of {tag, value}");
        return;
    }
    const writeGroups = {};
    const invalidTags = [];
    writes.forEach(function (w) {
        const ref = w && parseSparkplugBindingPath(w.tag);
        if (!ref) { invalidTags.push(w && w.tag); return; }
        const key = ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "");
        if (!writeGroups[key]) writeGroups[key] = { groupId: ref.groupId, edgeNodeId: ref.edgeNodeId, deviceId: ref.deviceId, metrics: [] };
        writeGroups[key].metrics.push({ name: ref.metricName, value: w.value });
    });
    if (invalidTags.length) {
        console.error("[nexa-logic] sparkplug-write-multi node " + node.id + ": ignoring invalid tag(s):", invalidTags);
    }
    const groupKeys = Object.keys(writeGroups);
    if (!groupKeys.length) return;
    Promise.all(groupKeys.map(function (key) {
        const g = writeGroups[key];
        return sendSparkplugWrite(g.groupId, g.edgeNodeId, g.deviceId, g.metrics);
    })).then(function () {
        continuePropagation(screen, node, outMsg, budget);
    }).catch(function (e) {
        console.error("[nexa-logic] sparkplug-write-multi node " + node.id + " failed:", e);
    });
}
