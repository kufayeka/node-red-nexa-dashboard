// The Join node's rules (src/features/logic/control/join-core.js), without a browser.
// Run standalone: node test/logic-join.test.js
const { createJoin } = await import("../src/features/logic/control/join-core.js");

let failures = 0;
function check(label, ok, actual) {
    if (!ok) failures++;
    console.log(label + "?", !!ok, "(actual: " + JSON.stringify(actual) + ")");
}
const slots = [{ topic: "price" }, { topic: "stock" }];

// wait-all, object
let j = createJoin({ mode: "wait-all", slots, outputFormat: "object", timeout: 0 });
let r1 = j.push({ topic: "price", payload: 9.5 });
check("wait-all: nothing until every slot spoke", r1.send === null && !r1.startTimer, r1);
let r2 = j.push({ topic: "stock", payload: 3 });
check("wait-all: then one message, msg.payload = {topic: payload}", r2.send && r2.send.payload.price === 9.5 && r2.send.payload.stock === 3 && r2.send.complete === true, r2.send && r2.send.payload);
check("wait-all: msg.joinMessages has the full messages", r2.send.joinMessages.price.topic === "price", Object.keys(r2.send.joinMessages));
check("wait-all: starts over after sending", j.push({ topic: "stock", payload: 4 }).send === null, null);

// a topic that is not a slot
const ign = createJoin({ mode: "wait-all", slots }).push({ topic: "other", payload: 1 });
check("an unknown msg.topic is ignored, with the reason", ign.send === null && /not one of the slots/.test(ign.ignored), ign.ignored);

// wait-all with a timeout
j = createJoin({ mode: "wait-all", slots, outputFormat: "array", timeout: 500 });
r1 = j.push({ topic: "stock", payload: 7 });
check("wait-all + timeout: the first message starts the timer", r1.startTimer === true && r1.send === null, r1);
const partial = j.timeout();
check("timeout: sends what is there, missing slots null, complete false (array: slot order)", partial && JSON.stringify(partial.payload) === "[null,7]" && partial.complete === false, partial && partial.payload);
check("timeout with nothing waiting: nothing", j.timeout() === null, null);
j.push({ topic: "price", payload: 1 });
check("a round that completes stops the timer", j.push({ topic: "stock", payload: 2 }).stopTimer === true, null);

// combine-latest
j = createJoin({ mode: "combine-latest", slots, outputFormat: "object" });
const c1 = j.push({ topic: "price", payload: 1 });
check("combine-latest: sends on every message (others null, complete false)", c1.send && c1.send.payload.price === 1 && c1.send.payload.stock === null && c1.send.complete === false, c1.send && c1.send.payload);
j.push({ topic: "stock", payload: 5 });
const c3 = j.push({ topic: "price", payload: 2 });
check("combine-latest: always the latest of each", c3.send.payload.price === 2 && c3.send.payload.stock === 5 && c3.send.complete === true, c3.send.payload);

// sequence-n
j = createJoin({ mode: "sequence-n", count: 3, outputFormat: "object" });
j.push({ payload: "a" }); j.push({ topic: "x", payload: "b" });
const s3 = j.push({ payload: "c" });
check("sequence-n: every N messages, in arrival order, any topic", s3.send && JSON.stringify(s3.send.payload) === '["a","b","c"]', s3.send && s3.send.payload);
check("sequence-n: starts over", j.push({ payload: "d" }).send === null, null);

// forward
j = createJoin({ mode: "wait-all", slots, outputFormat: "forward" });
j.push({ topic: "price", payload: 9, keep: "first" });
const f = j.push({ topic: "stock", payload: 2, keep: "me" });
check("forward: the completing msg itself, with msg.join = {topic: payload}", f.send.keep === "me" && f.send.payload === 2 && f.send.join.price === 9 && f.send.join.stock === 2, f.send);

if (!failures) console.log("ALL OK");
process.exit(failures ? 1 : 0);
