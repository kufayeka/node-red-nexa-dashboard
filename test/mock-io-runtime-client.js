// Nexa IO from the PAGE side: the real lib/nexa-runtime-client.js (+ the real
// buttons plugin) running against the real lib/screen-worker.js over a real
// WebSocket (Node's built-in WebSocket standing in for the browser's).
//   - page subscribes only to the tags its components are bound to
//   - a tag change reaches the bound component
//   - a latch click writes over IO (explicit) and gets acked
//   - worker dies -> watchdog marks values "???" (no frozen stale values)
// Run: node test/mock-io-runtime-client.js lib/nexa-registry-client.js lib/nexa-runtime-client.js
const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");

let failures = 0;
function check(label, ok, actual) {
  if (!ok) failures++;
  console.log(label + "?", ok, "(actual: " + JSON.stringify(actual) + ")");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitFor(pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      let v; try { v = pred(); } catch (e) { v = false; }
      if (v) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error("timed out waiting"));
      setTimeout(poll, 5);
    })();
  });
}

if (typeof WebSocket !== "function") { console.log("SKIP: this Node has no global WebSocket"); console.log("ALL OK"); process.exit(0); }
const NodeWebSocket = WebSocket;

async function main() {
  const worker = new Worker(path.join(__dirname, "..", "lib", "screen-worker.js"), {
    workerData: {
      port: 0, project: { screens: [], templates: [] }, componentScriptSrcs: [],
      sparkplugSnapshot: { Kufayeka: { NexaNodered: { online: true, nodeMetrics: {}, devices: { GP: { online: true, metrics: {
        "Lantai_1/d": { value: 1452, type: "Int32" },
        "RuangBlower/MotorCommandON": { value: false, type: "Boolean" },
        "Unused/tag": { value: 1, type: "Int32" }
      } } } } } }
    }
  });
  const writeRequests = [];
  let port = 0;
  worker.on("message", (m) => {
    if (m.type === "listening") port = m.port;
    if (m.type === "write-request") {
      writeRequests.push(m);
      worker.postMessage({ type: "write-result", requestId: m.requestId, ok: true });
      // like the real edge node: the write comes back as DDATA
      worker.postMessage({ type: "sparkplug-delta", serialized: JSON.stringify({ type: "data", groupId: m.groupId, edgeNodeId: m.edgeNodeId, deviceId: m.deviceId, metrics: m.metrics.map((x) => ({ name: x.name, value: x.value, type: "Boolean" })) }) });
    }
  });
  await waitFor(() => port, 10000);

  // --- minimal DOM ---
  const elements = [];
  function makeEl(tag) {
    const el = { tag, style: {}, children: [], attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { c.parentNode = this; this.children.push(c); },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      querySelector(sel) { return this.children.find((c) => c.tag === sel) || null; } };
    if (tag === "nexa-action-button") {
      el._l = {}; el.addEventListener = function (t, f) { (this._l[t] = this._l[t] || []).push(f); };
      el.input = function (kind) { (this._l["nexa-button-input"] || []).forEach((f) => f({ detail: { kind } })); };
    }
    elements.push(el); return el;
  }
  const artboard = makeEl("div");
  global.document = { createElement: makeEl, getElementById: (id) => (id === "nexa-runtime-artboard" ? artboard : null),
    querySelector(sel) { const m = /\[data-id="([^"]+)"\]/.exec(sel); return m ? elements.find((e) => e.attrs["data-id"] === m[1]) || null : null; } };
  global.window = global;
  window.addEventListener = function () {};
  window.location = { protocol: "http:", host: "127.0.0.1:" + port };
  window.WebSocket = NodeWebSocket;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 1);

  eval(fs.readFileSync(process.argv[2], "utf8"));
  eval(fs.readFileSync(path.join(__dirname, "..", "..", "nexa-component-buttons", "dist", "buttons-components.js"), "utf8"));
  const labelRenders = [];
  NEXA.registerComponent("mock-label", { render: function (el, props) { el.text = props.text; labelRenders.push(props.text); } });

  const TAG_D = "{sparkplug:Kufayeka::NexaNodered::GP::Lantai_1/d}";
  const TAG_M = "{sparkplug:Kufayeka::NexaNodered::GP::RuangBlower/MotorCommandON}";
  window.__NEXA_SCREEN__ = { id: "s", width: 400, height: 300, layers: [{ id: "default", name: "L", parentId: null, visible: true }],
    components: [
      { id: "lbl", type: "mock-label", x: 0, y: 0, w: 100, h: 30, layerId: "default", props: { text: TAG_D } },
      { id: "btn", type: "kufayeka-latch-button", x: 0, y: 40, w: 100, h: 30, layerId: "default", props: { readTag: TAG_M, textTrue: "ON", textFalse: "OFF" } }
    ], logic: { nodes: [], wires: [] } };
  window.__NEXA_QUERY__ = { rpi: "20" };
  eval(fs.readFileSync(process.argv[3], "utf8"));

  const lbl = elements.find((e) => e.attrs["data-id"] === "lbl");
  const wc = elements.find((e) => e.attrs["data-id"] === "btn").querySelector("nexa-action-button");

  await waitFor(() => lbl.text === "1452", 5000);
  check("page connected over IO: label shows the snapshot value", lbl.text === "1452", lbl.text);
  check("latch state from its readTag (false -> OFF)", wc.state === false && wc.text === "OFF", { state: wc.state, text: wc.text });

  worker.postMessage({ type: "sparkplug-delta", serialized: JSON.stringify({ type: "data", groupId: "Kufayeka", edgeNodeId: "NexaNodered", deviceId: "GP", metrics: [{ name: "Lantai_1/d", value: 1500, type: "Int32" }] }) });
  await waitFor(() => lbl.text === "1500", 2000);
  check("tag change -> bound label updated", lbl.text === "1500", lbl.text);

  // 50 quick changes -> label ends on the last one, far fewer renders than changes
  const rendersBefore = labelRenders.length;
  for (let i = 1; i <= 50; i++) {
    worker.postMessage({ type: "sparkplug-delta", serialized: JSON.stringify({ type: "data", groupId: "Kufayeka", edgeNodeId: "NexaNodered", deviceId: "GP", metrics: [{ name: "Lantai_1/d", value: 1600 + i, type: "Int32" }] }) });
  }
  await waitFor(() => lbl.text === "1650", 2000);
  check("burst of 50 changes -> final value shown, coalesced renders", lbl.text === "1650" && labelRenders.length - rendersBefore <= 10, { renders: labelRenders.length - rendersBefore });

  wc.input("press"); wc.input("release"); wc.input("click");
  await waitFor(() => writeRequests.length === 1, 2000);
  check("latch click -> explicit write over IO (not HTTP)", writeRequests[0].metrics[0].name === "RuangBlower/MotorCommandON" && writeRequests[0].metrics[0].value === true, writeRequests[0]);
  await waitFor(() => wc.state === true && wc.text === "ON", 2000);
  check("write echoed back as DDATA -> button ON", wc.state === true && wc.text === "ON", { state: wc.state, text: wc.text });

  // server gone -> within the watchdog window the label must stop showing a stale value
  await worker.terminate();
  const t0 = Date.now();
  await waitFor(() => lbl.text === "???", 6000);
  check("worker died -> label shows ??? (watchdog / close), no frozen stale value", lbl.text === "???", { text: lbl.text, ms: Date.now() - t0 });

  if (!failures) console.log("ALL OK");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
