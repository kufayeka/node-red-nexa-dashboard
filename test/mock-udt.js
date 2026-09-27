// Types (UDT) on a deployed page (src/model/types.js + lib/nexa-runtime-client.js):
// an instance is an app variable of a type; {M101.Speed} (a member with a tag
// source using the type's params) resolves and updates live, whole or inside an
// expression; a nested type (a Pump has a Motor) gets the parent's params; a
// template faceplate receives the whole instance ({M101}) and binds {motor.Speed};
// writes go to a read/write member's tag, or set a read/write value member, and
// a read-only member refuses. DOM shim / fake SSE / fake XHR as the other mocks.
const elements = [];
function makeEl(tag) {
  const el = {
    tag: tag, style: {}, children: [], attrs: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    querySelector(sel) { return this.children.find(c => c.tag === sel) || null; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; }
  };
  elements.push(el);
  return el;
}
const artboard = makeEl('div');
artboard.id = 'nexa-runtime-artboard';
global.document = {
  createElement(tag) { return makeEl(tag); },
  getElementById(id) { return id === 'nexa-runtime-artboard' ? artboard : null; },
  querySelector(sel) {
    const m = /\[data-id="([^"]+)"\]/.exec(sel);
    return m ? (elements.find(e => e.attrs['data-id'] === m[1]) || null) : null;
  }
};
global.window = global;
global.WebSocket = undefined;
global.console = console;
global.window.addEventListener = function () {};
global.window.__NEXA_RUNTIME_PREFIX__ = '/nexa';
function FakeXHR() { FakeXHR.instances.push(this); }
FakeXHR.instances = [];
FakeXHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
FakeXHR.prototype.setRequestHeader = function () {};
FakeXHR.prototype.send = function (body) { this.requestBody = body; };
global.window.XMLHttpRequest = FakeXHR;
function FakeEventSource(url) { this.url = url; this.listeners = {}; FakeEventSource.instances.push(this); }
FakeEventSource.prototype.addEventListener = function (name, fn) { this.listeners[name] = fn; };
FakeEventSource.instances = [];
global.window.EventSource = FakeEventSource;
var rafQueue = [];
global.window.requestAnimationFrame = function (fn) { rafQueue.push(fn); return rafQueue.length; };
function flushRAF() { var q = rafQueue; rafQueue = []; q.forEach(function (fn) { fn(); }); }

const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(process.argv[2], 'utf8')); // nexa-registry-client.js
// the model (window.NexaModel), as the page loads it from /nexa/_model.js
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nexa-model-client.js'), 'utf8'));

var shown = {}, writer = null;
NEXA.registerComponent('label', { render: function (el, props) { shown[el.attrs['data-id']] = props.text; } });
NEXA.registerComponent('writer', { render: function (el, props, ctx) { writer = ctx; } });

window.__NEXA_APP__ = {
  types: [
    { id: 'T_MOTOR', name: 'Motor', params: [{ id: 'p1', name: 'Group', defaultValue: 'G1' }, { id: 'p2', name: 'Node', defaultValue: 'E1' }, { id: 'p3', name: 'Device', defaultValue: '' }],
      members: [
        { id: 'm1', name: 'Speed', dataType: 'number', source: '{sparkplug:{Group}::{Node}::{Device}::Speed}', access: 'read' },
        { id: 'm2', name: 'Setpoint', dataType: 'number', source: '{sparkplug:{Group}::{Node}::{Device}::SP}', access: 'readwrite' },
        { id: 'm3', name: 'Label', dataType: 'string', defaultValue: 'Motor', access: 'readwrite' },
        { id: 'm4', name: 'Limit', dataType: 'number', defaultValue: 10, access: 'read' }] },
    { id: 'T_PUMP', name: 'Pump', params: [{ id: 'q1', name: 'Device', defaultValue: '' }],
      members: [
        { id: 'n1', name: 'Flow', dataType: 'number', source: '{sparkplug:G1::E1::{Device}::Flow}', access: 'read' },
        { id: 'n2', name: 'motor', dataType: 'type:T_MOTOR' }] }
  ],
  variables: [
    { id: 'i1', name: 'M101', type: 'type:T_MOTOR', params: { Device: 'M101' }, overrides: { m3: 'Main conveyor' } },
    { id: 'i2', name: 'P1', type: 'type:T_PUMP', params: { Device: 'P1' } }
  ]
};
window.__NEXA_TEMPLATES__ = [{ id: 'FP', name: 'Faceplate', width: 200, height: 40, params: [{ id: 'fp1', name: 'motor', label: 'motor', type: 'object', defaultValue: null }],
  components: [{ id: 'inFP', type: 'label', x: 0, y: 0, w: 200, h: 20, props: { text: '{motor.Label}: {motor.Speed} rpm' } }], logic: { nodes: [], wires: [] } }];
window.__NEXA_SCREEN__ = {
  id: 's1', width: 800, height: 600, treeVersion: 1, orphans: [],
  components: [
    { id: 'speed', type: 'label', x: 0, y: 0, w: 100, h: 20, props: { text: '{M101.Speed}' } },
    { id: 'expr', type: 'label', x: 0, y: 20, w: 300, h: 20, props: { text: 'M101 ({M101.Label}): {M101.Speed} rpm, limit {M101.Limit}' } },
    { id: 'nested', type: 'label', x: 0, y: 40, w: 100, h: 20, props: { text: '{P1.motor.Speed}' } },
    { id: 'label', type: 'label', x: 0, y: 60, w: 100, h: 20, props: { text: '{M101.Label}' } },
    { id: 'fp', type: '@template', templateId: 'FP', x: 0, y: 100, w: 200, h: 40, paramValues: { motor: '{M101}' } },
    { id: 'wr', type: 'writer', x: 0, y: 200, w: 10, h: 10, props: { sp: '{M101.Setpoint}', lbl: '{M101.Label}', lim: '{M101.Limit}', spd: '{M101.Speed}' } }
  ],
  logic: { nodes: [], wires: [] }
};

eval(fs.readFileSync(process.argv[3], 'utf8')); // nexa-runtime-client.js
var source = FakeEventSource.instances[0];
function live(device, name, value) {
  source.onmessage({ data: JSON.stringify({ type: 'data', groupId: 'G1', edgeNodeId: 'E1', deviceId: device, metrics: [{ name: name, value: value, isNull: false }] }) });
  flushRAF();
}

console.log('--- on mount ---');
console.log('a value member: the instance override ("Main conveyor")?', shown.label === 'Main conveyor');
console.log('a tag member before any value: "???" (not the binding text)?', shown.speed === '???', JSON.stringify(shown.speed));

console.log('--- live values ---');
live('M101', 'Speed', 1450);
console.log('{M101.Speed} (tag address filled from the params) -> 1450?', String(shown.speed) === '1450');
console.log('in an expression with value members too?', shown.expr === 'M101 (Main conveyor): 1450 rpm, limit 10', JSON.stringify(shown.expr));
console.log('a faceplate template given {M101} binds {motor.Speed} live?', shown['fp::inFP'] === 'Main conveyor: 1450 rpm', JSON.stringify(shown['fp::inFP']));
live('P1', 'Speed', 99);
console.log('a nested type ({P1.motor.Speed}) gets the parent\'s params (Device=P1)?', String(shown.nested) === '99');

console.log('--- writes ---');
(async function () {
  FakeXHR.instances = [];
  var p = writer.writeTag('sp', 50);
  var post = FakeXHR.instances.find(function (x) { return x.method === 'POST'; });
  var body = post && JSON.parse(post.requestBody);
  console.log('a read/write TAG member writes its own tag (G1 / E1 / M101 / SP = 50)?', !!body && body.groupId === 'G1' && body.edgeNodeId === 'E1' && body.deviceId === 'M101' && body.metrics[0].name === 'SP' && body.metrics[0].value === 50);
  post.status = 200; post.responseText = '{"ok":true}'; post.onload();
  await p;
  await writer.writeTag('lbl', 'Pump A');
  console.log('a read/write VALUE member is set: {M101.Label} everywhere, the faceplate too?', shown.label === 'Pump A' && shown['fp::inFP'] === 'Pump A: 1450 rpm');
  var r1 = await writer.writeTag('lim', 1).then(function () { return 'written'; }, function (e) { return e.message; });
  var r2 = await writer.writeTag('spd', 1).then(function () { return 'written'; }, function (e) { return e.message; });
  console.log('read-only members refuse (a value and a tag)?', /read-only/.test(r1) && /read-only/.test(r2), r1, '|', r2);
  console.log('ALL OK');
})().catch(function (e) { console.error(e); process.exit(1); });
