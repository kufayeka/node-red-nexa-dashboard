// Pure logic test for lib/sparkplug/sparkplugTree.js — no DOM needed. Run
// standalone: `node test/mock-sparkplug-tree.js`. See test/run-all.js for
// the pass/fail convention ("? false" anywhere = a failed assertion,
// "ALL OK" at the end = every assertion in this file printed "? true").
const tree = require("../lib/sparkplug/sparkplugTree.js");

console.log("--- NBIRTH creates the edge node and its node-scoped metrics ---");
var t1 = {};
var d1 = tree.applyMessage(t1, "G1", "NBIRTH", "Edge1", null, {
    timestamp: 1000, metrics: [{ name: "bdSeq", type: "Int64", value: 1 }]
});
console.log("delta type is birth?", d1 && d1.type === "birth");
console.log("delta has no deviceId (node-scoped)?", d1.deviceId === null);
console.log("edge node marked online?", t1.G1.Edge1.online === true);
console.log("bdSeq metric captured?", t1.G1.Edge1.nodeMetrics.bdSeq.value === 1);

console.log("--- DBIRTH creates a device under that edge node ---");
tree.applyMessage(t1, "G1", "DBIRTH", "Edge1", "Plant1", {
    timestamp: 1001, metrics: [{ name: "Speed", type: "Double", value: 10 }]
});
console.log("device online?", t1.G1.Edge1.devices.Plant1.online === true);
console.log("device metric captured?", t1.G1.Edge1.devices.Plant1.metrics.Speed.value === 10);
console.log("getMetricEntry reads it back?", tree.getMetricEntry(t1, "G1", "Edge1", "Plant1", "Speed").value === 10);

console.log("--- DDATA updates an existing metric, reports only the changed name ---");
var d2 = tree.applyMessage(t1, "G1", "DDATA", "Edge1", "Plant1", {
    timestamp: 1002, metrics: [{ name: "Speed", type: "Double", value: 77 }]
});
console.log("DDATA delta type is data?", d2.type === "data");
console.log("DDATA delta names the changed metric?", d2.metrics[0].name === "Speed");
console.log("DDATA delta carries the actual new value, not just the name?", d2.metrics[0].value === 77);
console.log("value actually updated?", t1.G1.Edge1.devices.Plant1.metrics.Speed.value === 77);

console.log("--- is_null metric surfaces as value:null, isNull:true, NOT a fake 0 ---");
tree.applyMessage(t1, "G1", "DDATA", "Edge1", "Plant1", {
    timestamp: 1003, metrics: [{ name: "Speed", type: "Double", value: undefined, isNull: true }]
});
var nullEntry = tree.getMetricEntry(t1, "G1", "Edge1", "Plant1", "Speed");
console.log("value is null, not 0?", nullEntry.value === null);
console.log("isNull flag set?", nullEntry.isNull === true);

console.log("--- DDEATH takes just that device offline, NOT the whole edge node ---");
tree.applyMessage(t1, "G1", "DBIRTH", "Edge1", "Plant2", { timestamp: 1004, metrics: [{ name: "Status", type: "String", value: "OK" }] });
tree.applyMessage(t1, "G1", "DDEATH", "Edge1", "Plant1", { timestamp: 1005, metrics: [] });
console.log("Plant1 now offline?", t1.G1.Edge1.devices.Plant1.online === false);
console.log("Plant2 still online (unaffected)?", t1.G1.Edge1.devices.Plant2.online === true);
console.log("edge node itself still online?", t1.G1.Edge1.online === true);
console.log("getMetricEntry for an offline device returns undefined (the \"???\" case)?", tree.getMetricEntry(t1, "G1", "Edge1", "Plant1", "Speed") === undefined);

console.log("--- NDEATH takes the WHOLE edge node (and every device under it) offline ---");
tree.applyMessage(t1, "G1", "NDEATH", "Edge1", null, { timestamp: 1006 });
console.log("edge node offline?", t1.G1.Edge1.online === false);
console.log("Plant2 (was online) now offline too?", t1.G1.Edge1.devices.Plant2.online === false);
console.log("getMetricEntry for a node-scoped metric on a dead edge node returns undefined?", tree.getMetricEntry(t1, "G1", "Edge1", null, "bdSeq") === undefined);

console.log("--- a fresh NBIRTH after death brings the edge node back online and resets its node-scoped metrics ---");
tree.applyMessage(t1, "G1", "NBIRTH", "Edge1", null, { timestamp: 1007, metrics: [] });
console.log("back online?", t1.G1.Edge1.online === true);
console.log("stale bdSeq from before is gone (NBIRTH replaces, not merges)?", t1.G1.Edge1.nodeMetrics.bdSeq === undefined);

console.log("--- unknown group/edge/metric lookups return undefined, never throw ---");
try {
    var r1 = tree.getMetricEntry({}, "Nope", "Nope", "Nope", "Nope");
    console.log("unknown group returns undefined without throwing?", r1 === undefined);
} catch (e) {
    console.log("unknown group returns undefined without throwing?", false);
}

console.log("--- a DDATA/DBIRTH/DDEATH with NO device segment is ignored, not mistaken for node-scoped ---");
var d3 = tree.applyMessage({}, "G1", "DDATA", "Edge1", null, { timestamp: 1, metrics: [{ name: "X", type: "Double", value: 1 }] });
console.log("device-type message without a deviceId produces no delta?", d3 === null);

console.log("--- metric alias resolution (spec p.46: an alias is unique per EDGE NODE, shared by NBIRTH + every DBIRTH under it) ---");
var t2 = {};
tree.applyMessage(t2, "G2", "NBIRTH", "Edge2", null, {
    timestamp: 1, metrics: [{ name: "bdSeq", alias: 0, type: "Int64", value: 1 }]
});
tree.applyMessage(t2, "G2", "DBIRTH", "Edge2", "Motor1", {
    timestamp: 2, metrics: [{ name: "Speed", alias: 1, type: "Double", value: 10 }]
});
var aliasOnly = tree.applyMessage(t2, "G2", "DDATA", "Edge2", "Motor1", {
    timestamp: 3, metrics: [{ name: undefined, alias: 1, type: "Double", value: 42 }]
});
console.log("a DDATA carrying ONLY an alias (no name) still resolves via the DBIRTH's own alias table?", aliasOnly && aliasOnly.metrics[0].name === "Speed");
console.log("...and actually updates the right metric's value?", tree.getMetricEntry(t2, "G2", "Edge2", "Motor1", "Speed").value === 42);

var unresolvable = tree.applyMessage(t2, "G2", "DDATA", "Edge2", "Motor1", {
    timestamp: 4, metrics: [{ name: undefined, alias: 999, type: "Double", value: 1 }]
});
console.log("an alias with NO matching birth is dropped (returns null, not a synthetic name)?", unresolvable === null);

var t3 = {};
tree.applyMessage(t3, "G3", "NBIRTH", "Edge3", null, { timestamp: 1, metrics: [{ name: "A", alias: 5, type: "Double", value: 1 }] });
tree.applyMessage(t3, "G3", "NBIRTH", "Edge3", null, { timestamp: 2, metrics: [{ name: "B", alias: 5, type: "Double", value: 2 }] });
var afterRebirth = tree.applyMessage(t3, "G3", "NDATA", "Edge3", null, { timestamp: 3, metrics: [{ name: undefined, alias: 5, type: "Double", value: 99 }] });
console.log("a fresh NBIRTH invalidates the PREVIOUS session's alias mapping (alias 5 now means \"B\", not the old \"A\")?", afterRebirth && afterRebirth.metrics[0].name === "B");

console.log("ALL OK");
