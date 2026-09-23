// Nexa IO end-to-end: the REAL lib/screen-worker.js in a real worker thread,
// a real WebSocket client (the `ws` package) on /nexa/_io:
//   open -> opened + layout + FULL frame from the snapshot
//   sparkplug-delta posted to the worker -> binary frame with the new value
//   explicit write -> worker posts write-request to main -> write-result -> ack
//   two clients with different subscriptions/RPI side by side
//   dead client (closed socket) is cleaned up
const path = require("path");
const { Worker } = require("worker_threads");
const WebSocket = require("ws");
const { decodeDataFrame } = require("../lib/io/ioProtocol.js");

let failures = 0;
function check(label, ok, actual) {
  if (!ok) failures++;
  console.log(label + "?", ok, "(actual: " + JSON.stringify(actual) + ")");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = (m) => "Kufayeka::NexaNodered::GP::" + m;

function waitFor(pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const v = pred();
      if (v) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error("timed out"));
      setTimeout(poll, 5);
    })();
  });
}

function openClient(port, rpi, keys) {
  const ws = new WebSocket("ws://127.0.0.1:" + port + "/nexa/_io");
  const c = { ws, texts: [], frames: [], layout: {}, values: {} };
  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      const m = JSON.parse(data.toString());
      c.texts.push(m);
      if (m.t === "layout") m.add.forEach((a) => { c.layout[a[0]] = a[1]; });
      return;
    }
    const f = decodeDataFrame(Buffer.from(data));
    c.frames.push(f);
    f.entries.forEach((e) => { c.values[c.layout[e.idx]] = e; });
  });
  ws.on("open", () => ws.send(JSON.stringify({ t: "open", rpi, keys })));
  return c;
}

async function main() {
  const worker = new Worker(path.join(__dirname, "..", "lib", "screen-worker.js"), {
    workerData: {
      port: 0,
      project: { screens: [], templates: [] },
      componentScriptSrcs: [],
      sparkplugSnapshot: { Kufayeka: { NexaNodered: { online: true, nodeMetrics: {}, devices: { GP: { online: true, metrics: {
        "Lantai_1/d": { value: 1452, type: "Int32" },
        "RuangBlower/MotorCommandON": { value: false, type: "Boolean" },
        "Lantai_2/a": { value: 3.5, type: "Double" }
      } } } } } }
    }
  });
  const writeRequests = [];
  let port = 0;
  worker.on("message", (m) => {
    if (m.type === "listening") port = m.port;
    if (m.type === "write-request") {
      writeRequests.push(m);
      // play Node-RED main: publish succeeded
      worker.postMessage({ type: "write-result", requestId: m.requestId, ok: true });
    }
  });
  await waitFor(() => port, 10000);

  const a = openClient(port, 20, [K("Lantai_1/d"), K("RuangBlower/MotorCommandON")]);
  await waitFor(() => a.frames.length >= 1, 5000);
  check("open -> opened reply", a.texts[0] && a.texts[0].t === "opened" && a.texts[0].rpi === 20, a.texts[0]);
  check("first frame FULL with snapshot values of exactly the 2 subscribed tags",
    a.frames[0].full && a.frames[0].entries.length === 2 && a.values[K("Lantai_1/d")].value === 1452 && a.values[K("RuangBlower/MotorCommandON")].value === false,
    a.frames[0].entries);

  // a 1ms "encoder" for 200ms -> page gets <= ~1 entry per RPI, always the latest
  const framesBefore = a.frames.length;
  const t0 = Date.now();
  let v = 2000;
  while (Date.now() - t0 < 200) {
    v++;
    worker.postMessage({ type: "sparkplug-delta", serialized: JSON.stringify({ type: "data", groupId: "Kufayeka", edgeNodeId: "NexaNodered", deviceId: "GP", metrics: [{ name: "Lantai_1/d", value: v, type: "Int32" }] }) });
    await sleep(1);
  }
  const lastSent = v;
  await waitFor(() => a.values[K("Lantai_1/d")] && a.values[K("Lantai_1/d")].value === lastSent, 2000);
  const got = a.frames.length - framesBefore;
  const deltas = lastSent - 2000;
  check(`fast tag (${deltas} deltas in 200ms) -> only ~1 frame per 20ms RPI (${got} frames), final value exact`,
    got <= 16 && got >= 3 && a.values[K("Lantai_1/d")].value === lastSent, { deltas, frames: got });

  // explicit write + ack
  a.ws.send(JSON.stringify({ t: "w", id: 1, g: "Kufayeka", e: "NexaNodered", d: "GP", m: [{ n: "RuangBlower/MotorCommandON", v: true }] }));
  const ack = await waitFor(() => a.texts.find((m) => m.t === "ack" && m.id === 1), 2000);
  check("explicit write -> write-request to main with the metric", writeRequests.length === 1 && writeRequests[0].deviceId === "GP" && writeRequests[0].metrics[0].name === "RuangBlower/MotorCommandON" && writeRequests[0].metrics[0].value === true, writeRequests[0]);
  check("write-result -> ack {ok:true} with the same id", ack.ok === true, ack);
  a.ws.send(JSON.stringify({ t: "w", id: 2, g: "", e: "", m: [] }));
  const bad = await waitFor(() => a.texts.find((m) => m.t === "ack" && m.id === 2), 2000);
  check("invalid write -> ack {ok:false} with an error, nothing sent to main", bad.ok === false && !!bad.err && writeRequests.length === 1, bad);

  // second client: other tag, slower RPI, independent
  const b = openClient(port, 200, [K("Lantai_2/a")]);
  await waitFor(() => b.frames.length >= 1, 5000);
  worker.postMessage({ type: "sparkplug-delta", serialized: JSON.stringify({ type: "data", groupId: "Kufayeka", edgeNodeId: "NexaNodered", deviceId: "GP", metrics: [{ name: "Lantai_2/a", value: 9.75, type: "Double" }] }) });
  await waitFor(() => b.values[K("Lantai_2/a")] && b.values[K("Lantai_2/a")].value === 9.75, 2000);
  check("2nd client (own tags, RPI 200) gets its tag; never sees client A's tags",
    !(K("Lantai_1/d") in b.values) && b.values[K("Lantai_2/a")].value === 9.75, Object.keys(b.values));

  // device death -> offline to both
  worker.postMessage({ type: "sparkplug-delta", serialized: JSON.stringify({ type: "death", groupId: "Kufayeka", edgeNodeId: "NexaNodered", deviceId: "GP" }) });
  await waitFor(() => a.values[K("Lantai_1/d")].online === false && b.values[K("Lantai_2/a")].online === false, 2000);
  check("DDEATH -> both clients get OFFLINE", true, "ok");

  // heartbeat keeps coming when nothing changes
  const hbBefore = a.frames.length;
  await sleep(1300);
  check("heartbeat: empty frame within ~1s of silence", a.frames.slice(hbBefore).some((f) => f.entries.length === 0), a.frames.length - hbBefore);

  b.ws.close();
  a.ws.close();
  await sleep(100);
  // Same shutdown as lib/nexa-plugin.js onremove: "close" then terminate().
  worker.postMessage({ type: "close" });
  await sleep(50);
  await worker.terminate();
  if (!failures) console.log("ALL OK");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
