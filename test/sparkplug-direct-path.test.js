// The tag path without the main thread: the real Sparkplug worker, a real MQTT broker (aedes)
// and a real MessageChannel standing in for the screen worker's end. The worker sends its
// snapshot first, then every delta on the port, and takes tag writes there.
// Run standalone: node test/sparkplug-direct-path.test.js
const net = require("net");
const path = require("path");
const { Worker, MessageChannel } = require("worker_threads");
const { Aedes } = require("aedes");
const mqtt = require("mqtt");
const sp = require("../src/server/sparkplug/sparkplugCodec.js");

let failures = 0;
function check(label, ok, actual) {
    if (!ok) failures++;
    console.log(label + "?", !!ok, "(actual: " + JSON.stringify(actual) + ")");
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
    const end = Date.now() + (ms || 5000);
    while (Date.now() < end) { const v = fn(); if (v) return v; await wait(10); }
    return fn();
}

(async function () {
    const broker = await Aedes.createBroker();
    const server = net.createServer(broker.handle.bind(broker));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = "mqtt://127.0.0.1:" + server.address().port;

    const worker = new Worker(path.join(__dirname, "..", "src", "server", "workers", "sparkplug-worker.js"), {
        workerData: { brokerUrl: url, clientId: "t-worker", keepAlive: 30, protocolVersion: 4, reconnectPeriod: 1000, connectTimeout: 5000,
            subscribeTopics: ["spBv1.0/+/+/+", "spBv1.0/+/+/+/+"], subscribeQos: 0 }
    });
    const toMain = [];
    worker.on("message", (m) => toMain.push(m));
    await until(() => toMain.some((m) => m.type === "status" && m.status === "connected"));

    const edge = mqtt.connect(url, { clientId: "t-edge" });
    await new Promise((r) => edge.on("connect", r));
    const cmds = [];
    edge.subscribe("spBv1.0/G/DCMD/E1/D1");
    edge.on("message", (topic, buf) => cmds.push(sp.decodePayload(buf)));
    await wait(100);

    // a birth before the port exists: it must be in the snapshot
    edge.publish("spBv1.0/G/NBIRTH/E1", sp.encodePayload({ timestamp: Date.now(), seq: 0, metrics: [{ name: "bdSeq", type: "UInt64", value: 0 }] }));
    edge.publish("spBv1.0/G/DBIRTH/E1/D1", sp.encodePayload({ timestamp: Date.now(), seq: 1, metrics: [{ name: "Speed", type: "Double", value: 10 }] }));
    await until(() => toMain.filter((m) => m.type === "message").length >= 2);

    const ch = new MessageChannel();
    const onPort = [];
    ch.port2.on("message", (m) => onPort.push(m));
    worker.postMessage({ type: "screen-port", port: ch.port1 }, [ch.port1]);
    const snap = await until(() => onPort.find((m) => m.type === "snapshot"));
    const d1 = snap && snap.snapshot.G && snap.snapshot.G.E1 && snap.snapshot.G.E1.devices && snap.snapshot.G.E1.devices.D1;
    check("the port gets the whole tree first (the birth from before it existed)", snap && JSON.stringify(snap.snapshot).indexOf("Speed") !== -1, d1 ? Object.keys(d1) : snap && Object.keys(snap.snapshot));

    for (let i = 1; i <= 20; i++) edge.publish("spBv1.0/G/DDATA/E1/D1", sp.encodePayload({ timestamp: Date.now(), seq: 1 + i, metrics: [{ name: "Speed", type: "Double", value: 10 + i }] }));
    await until(() => onPort.filter((m) => m.type === "delta").length >= 20);
    const deltas = onPort.filter((m) => m.type === "delta").map((m) => JSON.parse(m.serialized));
    const speeds = deltas.map((d) => JSON.stringify(d).match(/"value":(\d+)/)).filter(Boolean).map((m) => Number(m[1]));
    check("every DDATA arrives on the port as a delta, in order", speeds.length === 20 && speeds.every((v, i) => v === 11 + i), speeds);
    check("the snapshot came before the first delta", onPort.findIndex((m) => m.type === "snapshot") < onPort.findIndex((m) => m.type === "delta"), null);
    check("the main thread still gets every message (editor tree, rebirth)", toMain.filter((m) => m.type === "message").length === 22, toMain.filter((m) => m.type === "message").length);

    // a write on the port: published as a DCMD, answered on the port
    ch.port2.postMessage({ type: "write", requestId: "w1", groupId: "G", edgeNodeId: "E1", deviceId: "D1", metrics: [{ name: "Speed", value: 55 }] });
    const res = await until(() => onPort.find((m) => m.type === "write-result" && m.requestId === "w1"));
    const cmd = await until(() => cmds[0]);
    check("a write on the port is published (DCMD) and answered ok", res && res.ok === true && cmd && cmd.metrics[0].name === "Speed" && cmd.metrics[0].value === 55, { ok: res && res.ok, cmd: cmd && cmd.metrics[0] });
    ch.port2.postMessage({ type: "write", requestId: "w2", groupId: "G", edgeNodeId: "", metrics: [] });
    const bad = await until(() => onPort.find((m) => m.type === "write-result" && m.requestId === "w2"));
    check("an incomplete write is answered not ok", bad && bad.ok === false, bad);

    // a second port replaces the first (a redeploy re-wires)
    const ch2 = new MessageChannel();
    const onPort2 = [];
    ch2.port2.on("message", (m) => onPort2.push(m));
    worker.postMessage({ type: "screen-port", port: ch2.port1 }, [ch2.port1]);
    await until(() => onPort2.find((m) => m.type === "snapshot"));
    const before = onPort.length;
    edge.publish("spBv1.0/G/DDATA/E1/D1", sp.encodePayload({ timestamp: Date.now(), seq: 30, metrics: [{ name: "Speed", type: "Double", value: 99 }] }));
    await until(() => onPort2.some((m) => m.type === "delta"));
    check("a new port: its snapshot has the latest value, the deltas go only there", JSON.stringify(onPort2[0].snapshot).indexOf("\"value\":30") !== -1 && onPort2.some((m) => m.type === "delta") && onPort.length === before, { old: onPort.length - before });

    worker.postMessage({ type: "close" });
    await until(() => toMain.some((m) => m.type === "closed"));
    await worker.terminate();
    edge.end(true);
    ch.port2.close(); ch2.port2.close();
    server.close(); broker.close();
    if (!failures) console.log("ALL OK");
    setTimeout(() => process.exit(failures ? 1 : 0), 50);
})().catch((e) => { console.error(e); process.exit(1); });
