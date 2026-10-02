// Writes to live Sparkplug tags from the page; the output fires once the write is published.
import { defineLogicRuntimes } from "../registry.js";
import { parseSparkplugBindingPath } from "../../../runtime/io/sparkplug.js";
import { sendSparkplugWrite } from "../../../runtime/io/client.js";

defineLogicRuntimes({
    // node.tag = "{sparkplug:group::edge::device::metric}", the value = msg.payload
    "sparkplug-write": {
        run: function (node, msg, ctx) {
            const ref = parseSparkplugBindingPath(node.tag);
            if (!ref) {
                console.error("[nexa-logic] sparkplug-write node " + node.id + ": \"" + node.tag + "\" is not a valid {sparkplug:...} binding");
                return;
            }
            sendSparkplugWrite(ref.groupId, ref.edgeNodeId, ref.deviceId, [{ name: ref.metricName, value: msg && msg.payload }])
                .then(function () { ctx.next(msg); })
                .catch(function (e) { console.error("[nexa-logic] sparkplug-write node " + node.id + " failed:", e); });
        }
    },
    // msg.writes = [{tag, value}]: one publish per Edge Node / device
    "sparkplug-write-multi": {
        run: function (node, msg, ctx) {
            const writes = (msg && Array.isArray(msg.writes)) ? msg.writes : [];
            if (!writes.length) {
                console.error("[nexa-logic] sparkplug-write-multi node " + node.id + ": msg.writes must be a non-empty array of {tag, value}");
                return;
            }
            const groups = {};
            const invalid = [];
            writes.forEach(function (w) {
                const ref = w && parseSparkplugBindingPath(w.tag);
                if (!ref) { invalid.push(w && w.tag); return; }
                const key = ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "");
                if (!groups[key]) groups[key] = { groupId: ref.groupId, edgeNodeId: ref.edgeNodeId, deviceId: ref.deviceId, metrics: [] };
                groups[key].metrics.push({ name: ref.metricName, value: w.value });
            });
            if (invalid.length) console.error("[nexa-logic] sparkplug-write-multi node " + node.id + ": ignoring invalid tag(s):", invalid);
            const keys = Object.keys(groups);
            if (!keys.length) return;
            Promise.all(keys.map(function (k) {
                const g = groups[k];
                return sendSparkplugWrite(g.groupId, g.edgeNodeId, g.deviceId, g.metrics);
            })).then(function () { ctx.next(msg); }).catch(function (e) {
                console.error("[nexa-logic] sparkplug-write-multi node " + node.id + " failed:", e);
            });
        }
    }
});
