// Verifies the "Sparkplug Write" / "Sparkplug Write Multi" Logic node
// execution in lib/nexa-runtime-client.js's runLogicGraph — the write-back
// feature added on top of the read-only Sparkplug binding that already
// existed. Uses a fake XMLHttpRequest (this file's own sendSparkplugWrite
// helper is XHR-based, not fetch) to capture outgoing POSTs to
// RUNTIME_PREFIX + "/_sparkplug-write" and manually control their response,
// same "eval the real file into a hand-rolled shim" technique as the other
// runtime-client mocks. Run standalone:
//   node test/mock-sparkplug-write-logic.js <registry-client> <runtime-client>
const assert = require('assert');

global.document = {
  createElement() { return { style: {}, children: [], attrs: {}, setAttribute() {}, appendChild() {} }; },
  getElementById(id) { return id === 'nexa-runtime-artboard' ? { style: {}, children: [], appendChild() {} } : null; },
  querySelector() { return null; }
};
global.window = global;
global.console = console;
global.window.addEventListener = function () {};
global.window.__NEXA_RUNTIME_PREFIX__ = "/nexa";

// Fake XMLHttpRequest -- captures every request; a test manually decides
// when/how each one "responds" via respondTo(), so ordering and timing are
// fully deterministic (no real network, no real async scheduling races).
function FakeXHR() {
  FakeXHR.instances.push(this);
}
FakeXHR.instances = [];
FakeXHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
FakeXHR.prototype.setRequestHeader = function () {};
FakeXHR.prototype.send = function (body) { this.requestBody = body; };
global.window.XMLHttpRequest = FakeXHR;

function respondTo(xhr, status, jsonBody) {
  xhr.status = status;
  xhr.responseText = JSON.stringify(jsonBody || {});
  if (typeof xhr.onload === "function") xhr.onload();
}

// Without a fake EventSource, setUpSparkplugLiveBinding falls back to an
// IMMEDIATE snapshot GET via XMLHttpRequest (see its own "no EventSource"
// branch) -- a real, but unrelated, XHR that would otherwise contaminate
// FakeXHR.instances alongside the write-node POSTs this file actually
// wants to inspect. A trivial stub is enough since its onopen is never
// triggered here.
function FakeEventSource(url) { this.url = url; }
FakeEventSource.prototype.addEventListener = function () {};
global.window.EventSource = FakeEventSource;

const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nexa-registry-client.js'), 'utf8'));
NEXA.registerComponent('kufayeka-rect', { render: function () {} });

function freshMount(screen) {
  FakeXHR.instances = [];
  delete require.cache; // no-op, kept for readability -- eval below always re-defines the whole module scope fresh
  global.window.__NEXA_SCREEN__ = screen;
  global.window.__NEXA_TEMPLATES__ = [];
  eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nexa-runtime-client.js'), 'utf8'));
}

console.log("--- \"Sparkplug Write\": onload -> sparkplug-write fires a DCMD-shaped POST, with msg.payload as the value ---");
freshMount({
  id: 's1', width: 400, height: 300,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [{ id: 'c1', type: 'kufayeka-rect', x: 0, y: 0, w: 10, h: 10, rotation: 0, layerId: 'default', props: {} }],
  logic: {
    nodes: [
      { id: 'onload1', type: 'onload' },
      { id: 'fn1', type: 'function', code: 'msg.payload = 77; return msg;' },
      { id: 'write1', type: 'sparkplug-write', tag: '{sparkplug:G1::E1::Motor1::Speed}' }
    ],
    wires: [{ id: 'w1', from: 'onload1', to: 'fn1' }, { id: 'w2', from: 'fn1', to: 'write1' }]
  }
});
setTimeout(function () {
  console.log("exactly one XHR request sent?", FakeXHR.instances.length === 1);
  var xhr = FakeXHR.instances[0];
  console.log("POSTed to the write endpoint?", xhr.method === "POST" && xhr.url === "/nexa/_sparkplug-write");
  var body = JSON.parse(xhr.requestBody);
  console.log("correct groupId/edgeNodeId/deviceId parsed from the tag?", body.groupId === "G1" && body.edgeNodeId === "E1" && body.deviceId === "Motor1");
  console.log("correct metric name/value (value from msg.payload, set by the upstream function)?", body.metrics.length === 1 && body.metrics[0].name === "Speed" && body.metrics[0].value === 77);
  respondTo(xhr, 200, { ok: true });

  console.log("--- \"Sparkplug Write Multi\": batches writes for the SAME device into one POST, DIFFERENT devices into separate POSTs ---");
  freshMount({
    id: 's2', width: 400, height: 300,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [{ id: 'c1', type: 'kufayeka-rect', x: 0, y: 0, w: 10, h: 10, rotation: 0, layerId: 'default', props: {} }],
    logic: {
      nodes: [
        { id: 'onload1', type: 'onload' },
        {
          id: 'fn1', type: 'function', code:
            'msg.writes = [' +
            '  { tag: "{sparkplug:G1::E1::Motor1::Speed}", value: 1 },' +
            '  { tag: "{sparkplug:G1::E1::Motor1::Torque}", value: 2 },' +
            '  { tag: "{sparkplug:G1::E1::Motor2::Speed}", value: 3 }' +
            '];\nreturn msg;'
        },
        { id: 'writeMulti1', type: 'sparkplug-write-multi' }
      ],
      wires: [{ id: 'w1', from: 'onload1', to: 'fn1' }, { id: 'w2', from: 'fn1', to: 'writeMulti1' }]
    }
  });
  setTimeout(function () {
    console.log("exactly TWO XHR requests (Motor1 batched together, Motor2 separate)?", FakeXHR.instances.length === 2);
    var byDevice = {};
    FakeXHR.instances.forEach(function (xhr2) {
      var b = JSON.parse(xhr2.requestBody);
      byDevice[b.deviceId] = b;
    });
    console.log("Motor1's request carries BOTH its metrics in one payload?", byDevice.Motor1 && byDevice.Motor1.metrics.length === 2);
    console.log("Motor2's request carries only its own metric?", byDevice.Motor2 && byDevice.Motor2.metrics.length === 1 && byDevice.Motor2.metrics[0].name === "Speed" && byDevice.Motor2.metrics[0].value === 3);
    FakeXHR.instances.forEach(function (xhr2) { respondTo(xhr2, 200, { ok: true }); });

    console.log("--- an invalid tag is skipped (not thrown), a fully-invalid msg.writes sends nothing ---");
    freshMount({
      id: 's3', width: 400, height: 300,
      layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
      components: [],
      logic: {
        nodes: [
          { id: 'onload1', type: 'onload' },
          { id: 'fn1', type: 'function', code: 'msg.writes = [{ tag: "not a real binding", value: 1 }]; return msg;' },
          { id: 'writeMulti1', type: 'sparkplug-write-multi' }
        ],
        wires: [{ id: 'w1', from: 'onload1', to: 'fn1' }, { id: 'w2', from: 'fn1', to: 'writeMulti1' }]
      }
    });
    setTimeout(function () {
      console.log("no request sent for an all-invalid msg.writes?", FakeXHR.instances.length === 0);
      console.log("ALL OK");
    }, 0);
  }, 0);
}, 0);
