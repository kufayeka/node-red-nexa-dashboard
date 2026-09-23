// Coalesces Sparkplug tree deltas bound for the EDITOR (RED.comms) into one
// publish every `intervalMs`. Node-RED's comms keeps one unbounded FIFO per
// editor connection and drains at most 50 messages per 50ms, so publishing
// every single high-frequency delta made debug output, node status and this
// tree all arrive seconds late (measured 2-6s, growing) once tag traffic
// passed that rate. Deployed screens don't go through here — they get every
// delta directly from lib/screen-worker.js's SSE.
//
// Merging rules (order-preserving):
//   - "data" deltas for the same group/edge/device merge their metrics by
//     name, last value wins — the tree only ever shows the latest value.
//   - "birth"/"death" deltas are barriers: kept as-is and in order, and data
//     arriving after one never merges into data from before it (a DBIRTH
//     resets the device's metric set; a DDEATH must not be reordered after
//     a later DDATA).
// `flush(batch)` receives a non-empty array of deltas.
function createDeltaBatcher(flush, intervalMs) {
    var buffer = [];
    var dataIndex = {}; // "group::edge::device" -> buffered data delta (since the last barrier)
    var timer = null;

    function doFlush() {
        timer = null;
        if (!buffer.length) return;
        var batch = buffer;
        buffer = [];
        dataIndex = {};
        flush(batch);
    }

    function push(delta) {
        if (!delta) return;
        if (delta.type === "data") {
            var key = delta.groupId + "::" + delta.edgeNodeId + "::" + (delta.deviceId || "");
            var existing = dataIndex[key];
            if (existing) {
                (delta.metrics || []).forEach(function (m) {
                    var i = existing._pos[m.name];
                    if (i === undefined) { existing._pos[m.name] = existing.metrics.length; existing.metrics.push(m); }
                    else existing.metrics[i] = m;
                });
            } else {
                var copy = Object.assign({}, delta, { metrics: [] });
                Object.defineProperty(copy, "_pos", { value: {}, enumerable: false });
                (delta.metrics || []).forEach(function (m) {
                    var i = copy._pos[m.name];
                    if (i === undefined) { copy._pos[m.name] = copy.metrics.length; copy.metrics.push(m); }
                    else copy.metrics[i] = m;
                });
                dataIndex[key] = copy;
                buffer.push(copy);
            }
        } else {
            buffer.push(delta);
            dataIndex = {};
        }
        if (!timer) timer = setTimeout(doFlush, intervalMs);
    }

    function stop() {
        if (timer) { clearTimeout(timer); timer = null; }
        buffer = [];
        dataIndex = {};
    }

    return { push: push, flushNow: function () { if (timer) clearTimeout(timer); doFlush(); }, stop: stop };
}

module.exports = { createDeltaBatcher: createDeltaBatcher };
