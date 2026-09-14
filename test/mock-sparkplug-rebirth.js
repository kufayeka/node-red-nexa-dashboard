// Pure logic test for lib/sparkplug/sparkplugRebirth.js — no DOM, no MQTT
// needed. Run standalone: `node test/mock-sparkplug-rebirth.js`. See
// test/run-all.js for the pass/fail convention.
const { RebirthTracker } = require("../lib/sparkplug/sparkplugRebirth.js");

console.log("--- an Edge Node never seen before is due for a rebirth request ---");
var t1 = new RebirthTracker(10000);
console.log("not yet birthed, never requested -> due now?", t1.shouldRequest("G1", "Edge1", 1000) === true);

console.log("--- once birthed, no further request is ever due (until it dies again) ---");
var t2 = new RebirthTracker(10000);
t2.markBirthed("G1", "Edge1");
console.log("isBirthed reports true?", t2.isBirthed("G1", "Edge1") === true);
console.log("shouldRequest is false once birthed?", t2.shouldRequest("G1", "Edge1", 1000) === false);

console.log("--- a request is recorded and honors its cooldown before firing again ---");
var t3 = new RebirthTracker(10000);
console.log("first request fires?", t3.shouldRequest("G1", "Edge1", 1000) === true);
console.log("a second check inside the cooldown window does NOT fire again?", t3.shouldRequest("G1", "Edge1", 5000) === false);
console.log("...but fires again once the cooldown has elapsed?", t3.shouldRequest("G1", "Edge1", 11001) === true);

console.log("--- different Edge Nodes (even same edgeNodeId, different group) are tracked independently ---");
var t4 = new RebirthTracker(10000);
t4.markBirthed("G1", "Edge1");
console.log("G1/Edge1 birthed -> no request due?", t4.shouldRequest("G1", "Edge1", 1000) === false);
console.log("G2/Edge1 (different group, same edge node id) is STILL due?", t4.shouldRequest("G2", "Edge1", 1000) === true);

console.log("--- markDead() undoes markBirthed(), as if we'd never seen it (an NDEATH ended the session) ---");
var t5 = new RebirthTracker(10000);
t5.markBirthed("G1", "Edge1");
t5.markDead("G1", "Edge1");
console.log("isBirthed is false again after markDead?", t5.isBirthed("G1", "Edge1") === false);
console.log("a request is due again after markDead?", t5.shouldRequest("G1", "Edge1", 1000) === true);

console.log("--- a rebirth response (a fresh NBIRTH) should stop further requests immediately ---");
var t6 = new RebirthTracker(10000);
t6.shouldRequest("G1", "Edge1", 1000); // simulate: we just asked
t6.markBirthed("G1", "Edge1"); // ...and the Edge Node responded with a real NBIRTH
console.log("no more requests due, even well past the cooldown?", t6.shouldRequest("G1", "Edge1", 999999) === false);

console.log("ALL OK");
