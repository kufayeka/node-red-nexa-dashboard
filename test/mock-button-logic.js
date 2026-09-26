// Latch/Momentary buttons (@kufayeka/nexa-component-buttons) on the
// deployed-page runtime, run against the REAL plugin script:
//   - built-in Sparkplug binding: readTag value -> button state, user
//     interaction -> writes true/false to writeTag (or readTag) with NO
//     Logic wiring (ctx.writeSparkplugProp)
//   - per-state CSS (cssTrue/cssFalse/cssHover/cssPressed/cssDisabled)
//   - events: state1/state0/change/click/pressed/released/hover/leave
//   - backward compat: old buttons (props.text, stateValue, state1/state0 ->
//     function -> Update Component) keep working
// plus the logic engine's fan-in/fan-out guarantees, and the ui-update rule
// that an explicit msg.text beats a primitive msg.payload guessed into text.
const fs = require('fs');
const path = require('path');

const elements = [];
function makeEl(tag) {
  const el = {
    tag: tag, style: {}, children: [], attrs: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    removeChild(child) { child.parentNode = null; this.children = this.children.filter(c => c !== child); },
    querySelector(sel) { return this.children.find(c => c.tag === sel) || null; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; }
  };
  // Stand-in for the <nexa-action-button> view element: just an event target.
  if (tag === 'nexa-action-button') {
    el._listeners = {};
    el.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
    el.input = function (kind) { (this._listeners['nexa-button-input'] || []).forEach(fn => fn({ detail: { kind: kind } })); };
    el.clickLatch = function () { this.input('press'); this.input('release'); this.input('click'); };
  }
  elements.push(el);
  return el;
}
const artboard = makeEl('div');
global.document = {
  createElement(tag) { return makeEl(tag); },
  getElementById(id) { return id === 'nexa-runtime-artboard' ? artboard : null; },
  querySelector(sel) {
    const m = /\[data-id="([^"]+)"\]/.exec(sel);
    return m ? (elements.find(e => e.attrs['data-id'] === m[1]) || null) : null;
  }
};
global.window = global;
global.window.addEventListener = function () {};

// Captures every Sparkplug write the page POSTs; the snapshot GET returns {}.
const writes = [];
let failNextWrite = false;
global.XMLHttpRequest = function () {
  const x = this;
  x.open = (m, p) => { x.method = m; x.url = p; };
  x.setRequestHeader = () => {};
  x.send = (body) => setTimeout(() => {
    if (/_sparkplug-write/.test(x.url)) {
      writes.push(JSON.parse(body));
      if (failNextWrite) { failNextWrite = false; x.status = 500; x.responseText = ''; }
      else { x.status = 200; x.responseText = '{"ok":true}'; }
    } else { x.status = 200; x.responseText = '{}'; }
    x.onload && x.onload();
  }, 0);
};

eval(fs.readFileSync(process.argv[2], 'utf8')); // nexa-registry-client.js
eval(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-buttons-components.js'), 'utf8'));

let failures = 0;
function check(label, ok, actual) {
  if (!ok) failures++;
  console.log(label + '?', ok, '(actual: ' + JSON.stringify(actual) + ')');
}

const latchDef = NEXA.getComponent('kufayeka-latch-button');
const momDef = NEXA.getComponent('kufayeka-momentary-button');
const evNames = latchDef.events.map(e => e.name);
check('buttons declare state1/state0 (existing Logic nodes) + change/click/pressed/released/hover/leave',
  ['state1', 'state0', 'change', 'click', 'pressed', 'released', 'hover', 'leave'].every(n => evNames.includes(n)), evNames);
check('latch button has hideSparkplugWatch === true', latchDef.hideSparkplugWatch === true, latchDef.hideSparkplugWatch);
check('momentary button has hideSparkplugWatch === true', momDef.hideSparkplugWatch === true, momDef.hideSparkplugWatch);
check('buttons declare custom renderProperties function', typeof latchDef.renderProperties === 'function' && typeof momDef.renderProperties === 'function', typeof latchDef.renderProperties);

const TAG = '{sparkplug:Kufayeka::NexaNodered::GP::RuangBlower/MotorCommandON}';
const TAG_W = '{sparkplug:Kufayeka::NexaNodered::GP::RuangBlower/MotorCommandSpeed}';

const logs = [];
const realLog = console.log;

window.__NEXA_SCREEN__ = {
  id: 's5', width: 800, height: 600, layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    // Old-style button + wiring exactly as Screen 5 had it (props.text, top-level msg.text).
    { id: 'latchOld', type: 'kufayeka-latch-button', x: 0, y: 0, w: 120, h: 40, layerId: 'default', props: { text: 'Latch Button' } },
    // New-style: built-in tag binding, no Logic at all.
    { id: 'latchTag', type: 'kufayeka-latch-button', x: 0, y: 60, w: 120, h: 40, layerId: 'default', props: { readTag: TAG, writeTag: '', textTrue: 'RUN', textFalse: 'STOP', cssTrue: 'background-color: lime;', cssPressed: 'color: red;' } },
    { id: 'momTag', type: 'kufayeka-momentary-button', x: 0, y: 120, w: 120, h: 40, layerId: 'default', props: { readTag: TAG, writeTag: TAG_W, textTrue: 'HELD', textFalse: 'IDLE' } },
    // Unbound latch: toggles locally, never writes.
    { id: 'latchLocal', type: 'kufayeka-latch-button', x: 0, y: 180, w: 120, h: 40, layerId: 'default', props: { textTrue: 'A', textFalse: 'B' } },
    { id: 'momentary', type: 'kufayeka-momentary-button', x: 0, y: 240, w: 120, h: 40, layerId: 'default', props: { text: 'Momentary' } }
  ],
  logic: {
    nodes: [
      { id: 'oldOn', type: 'ui-event', compId: 'latchOld', event: 'state1' },
      { id: 'oldOff', type: 'ui-event', compId: 'latchOld', event: 'state0' },
      { id: 'oldFnOn', type: 'function', code: 'return { payload: true, text: "ON" };' },
      { id: 'oldFnOff', type: 'function', code: 'return { payload: false, text: "OFF" };' },
      { id: 'oldUpd', type: 'ui-update', compId: 'latchOld', config: {} },
      // Every event of momTag logged, to check names + payloads.
      ...['state1', 'state0', 'change', 'click', 'pressed', 'released', 'hover', 'leave'].map(n => ({ id: 'ev_' + n, type: 'ui-event', compId: 'momTag', event: n })),
      { id: 'evLog', type: 'function', code: 'console.log("[ev]", msg.event, JSON.stringify(msg.payload)); return null;' },
      // Fan-out: one source into a mutating branch + an observing branch.
      { id: 'mDown', type: 'ui-event', compId: 'momentary', event: 'state1' },
      { id: 'mutator', type: 'function', code: 'msg.payload.state = 999; msg.tagged = "A"; return msg;' },
      { id: 'observer', type: 'function', code: 'console.log("[observer]", JSON.stringify(msg)); return null;' },
      // Fan-in: both momentary events into one counter node.
      { id: 'mUp', type: 'ui-event', compId: 'momentary', event: 'state0' },
      { id: 'counter', type: 'function', code: 'console.log("[counter]", msg.payload.state); return null;' }
    ],
    wires: [
      { id: 'w1', from: 'oldOn', to: 'oldFnOn' }, { id: 'w2', from: 'oldOff', to: 'oldFnOff' },
      { id: 'w3', from: 'oldFnOn', to: 'oldUpd' }, { id: 'w3b', from: 'oldFnOff', to: 'oldUpd' },
      ...['state1', 'state0', 'change', 'click', 'pressed', 'released', 'hover', 'leave'].map(n => ({ id: 'we_' + n, from: 'ev_' + n, to: 'evLog' })),
      { id: 'w7', from: 'mDown', to: 'mutator' }, { id: 'w8', from: 'mDown', to: 'observer' },
      { id: 'w9', from: 'mDown', to: 'counter' }, { id: 'w10', from: 'mUp', to: 'counter' }
    ]
  }
};
eval(fs.readFileSync(process.argv[3], 'utf8')); // nexa-runtime-client.js

function boxOf(compId) { return elements.find(e => e.attrs['data-id'] === compId); }
function wcOf(compId) { const b = boxOf(compId); return b && b.querySelector('nexa-action-button'); }
function compOf(compId) { return window.__NEXA_SCREEN__.components.find(c => c.id === compId); }
// Simulates what the runtime does on a Sparkplug delta for a bound
// component: re-render with the tag resolved to its live (string) value.
function tagUpdate(compId, value) {
  const c = compOf(compId);
  const resolved = Object.assign({}, c.props, { readTag: String(value) });
  NEXA.getComponent(c.type).render(boxOf(compId), resolved, wcOf(compId).__nexaCtx);
}
const tick = () => new Promise(r => setTimeout(r, 20));
const lastWrite = () => writes[writes.length - 1];

(async function () {
  await tick();

  // --- backward compat: old Screen 5 wiring (text via Update Component) ---
  wcOf('latchOld').clickLatch(); await tick();
  check('OLD wiring: state1 -> {payload:true, text:"ON"} -> Update Component sets text "ON"', wcOf('latchOld').text === 'ON', wcOf('latchOld').text);
  wcOf('latchOld').clickLatch(); await tick();
  check('OLD wiring: state0 -> text "OFF"', wcOf('latchOld').text === 'OFF', wcOf('latchOld').text);
  check('a button with NO tag bound never writes Sparkplug', writes.length === 0, writes);

  // --- latch with built-in tag binding, zero Logic ---
  const lt = wcOf('latchTag');
  tagUpdate('latchTag', '???');
  check('latch: tag unknown ("???") -> state-unknown, shows false text', lt.unknown === true && lt.text === 'STOP', { unknown: lt.unknown, text: lt.text });
  tagUpdate('latchTag', 'true');
  check('latch: read tag "true" -> state true, textTrue', lt.state === true && lt.text === 'RUN' && lt.unknown === false, { state: lt.state, text: lt.text });
  lt.clickLatch(); await tick();
  check('latch: click while tag is true writes FALSE to the tag (writeTag empty -> readTag)',
    JSON.stringify(lastWrite()) === JSON.stringify({ groupId: 'Kufayeka', edgeNodeId: 'NexaNodered', deviceId: 'GP', metrics: [{ name: 'RuangBlower/MotorCommandON', value: false }] }), lastWrite());
  check('latch: optimistic state false + textFalse right after click', lt.state === false && lt.text === 'STOP', { state: lt.state, text: lt.text });
  tagUpdate('latchTag', 'false');
  lt.clickLatch(); await tick();
  check('latch: next click writes TRUE', lastWrite().metrics[0].value === true, lastWrite());
  tagUpdate('latchTag', 'true');
  tagUpdate('latchTag', '0');
  check('latch: tag changed from outside ("0") -> state follows it', lt.state === false, lt.state);
  failNextWrite = true;
  tagUpdate('latchTag', 'true');
  lt.clickLatch(); await tick();
  check('latch: a FAILED write snaps state back to the last tag value', lt.state === true, lt.state);

  // --- per-state CSS ---
  const css = lt.customCss;
  check('css: cssTrue wrapped as button.nexa-btn.state-true {...}', /button\.nexa-btn\.state-true \{\nbackground-color: lime;\n\}/.test(css), css);
  check('css: cssPressed wrapped as button.nexa-btn.pressed:not(:disabled) {...}', /button\.nexa-btn\.pressed:not\(:disabled\) \{\ncolor: red;\n\}/.test(css), css);
  check('css: per-state blocks come AFTER the base css (so they win ties)', css.indexOf('state-true') > css.indexOf('button {'), css.slice(0, 80));
  lt.input('press');
  check('css: .pressed flag is set while held', lt.pressed === true, lt.pressed);
  lt.input('release');
  check('css: .pressed flag cleared on release', lt.pressed === false, lt.pressed);

  // --- momentary with separate writeTag + events ---
  const mt = wcOf('momTag');
  tagUpdate('momTag', 'false');
  console.log = function (...a) { logs.push(a.join(' ')); };
  mt.input('hover'); mt.input('press'); await tick();
  const w1 = lastWrite();
  tagUpdate('momTag', 'false'); // stale reading while held
  const heldState = mt.state;
  mt.input('release'); mt.input('release'); mt.input('click'); mt.input('leave'); await tick();
  const w2 = lastWrite();
  console.log = realLog;
  check('momentary: press writes TRUE to writeTag (not readTag)', w1.metrics[0].name === 'RuangBlower/MotorCommandSpeed' && w1.metrics[0].value === true, w1);
  check('momentary: a stale tag reading while held does NOT drop it back to false', heldState === true, heldState);
  check('momentary: release writes FALSE', w2.metrics[0].value === false, w2);
  const evs = logs.filter(l => l.startsWith('[ev]')).map(l => l.replace('[ev] ', ''));
  check('momentary events in order, payload {state,value}, double release only once',
    JSON.stringify(evs) === JSON.stringify([
      'hover {"state":false,"value":false}',
      'pressed {"state":false,"value":false}',
      'change {"state":true,"value":true}',
      'state1 {"state":true,"value":true}',
      'released {"state":true,"value":true}',
      'change {"state":false,"value":false}',
      'state0 {"state":false,"value":false}',
      'click {"state":false,"value":false}',
      'leave {"state":false,"value":false}'
    ]), evs);

  // --- unbound latch ---
  const ll = wcOf('latchLocal');
  const before = writes.length;
  ll.clickLatch(); await tick();
  check('unbound latch toggles locally (textTrue) without writing', ll.state === true && ll.text === 'A' && writes.length === before, { state: ll.state, text: ll.text });
  NEXA.getComponent('kufayeka-latch-button').render(boxOf('latchLocal'), compOf('latchLocal').props, ll.__nexaCtx);
  check('unbound latch keeps its state across a re-render', ll.state === true, ll.state);

  // --- engine: fan-out isolation + fan-in ---
  logs.length = 0;
  console.log = function (...a) { logs.push(a.join(' ')); };
  wcOf('momentary').input('press'); await tick();
  wcOf('momentary').input('release'); await tick();
  console.log = realLog;
  const obs = logs.filter(l => l.startsWith('[observer]'));
  check('fan-out: a sibling branch mutating msg does NOT leak into the other branch',
    obs.length === 1 && /"state":true/.test(obs[0]) && !/tagged/.test(obs[0]), obs);
  const cnt = logs.filter(l => l.startsWith('[counter]'));
  check('fan-in: a node with two incoming wires runs once per arriving message, in order',
    JSON.stringify(cnt) === '["[counter] true","[counter] false"]', cnt);

  if (!failures) console.log('ALL OK');
  process.exit(failures ? 1 : 0);
})();
