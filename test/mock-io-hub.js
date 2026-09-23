// lib/io/ioProtocol.js + lib/io/ioHub.js — Nexa IO implicit/explicit, no sockets.
const { encodeDataFrame, decodeDataFrame, HEADER_BYTES } = require('../lib/io/ioProtocol.js');
const { IoHub } = require('../lib/io/ioHub.js');

let failures = 0;
function check(label, ok, actual) {
  if (!ok) failures++;
  console.log(label + '?', ok, '(actual: ' + JSON.stringify(actual) + ')');
}

// --- protocol round trip ---
const now = 1790000000000;
const items = [
  { idx: 0, entry: { online: true, value: 42, timestamp: now - 5 } },
  { idx: 1, entry: { online: true, value: -3.25 } },
  { idx: 2, entry: { online: true, value: true } },
  { idx: 3, entry: { online: true, value: false } },
  { idx: 4, entry: { online: true, value: 'héllo' } },
  { idx: 5, entry: { online: true, value: [1, 2, { a: 3 }] } },
  { idx: 6, entry: { online: true, isNull: true, value: null } },
  { idx: 7, entry: { online: false, value: 9 } },
  { idx: 8, entry: undefined },
  { idx: 9, entry: { online: true, value: 3000000000 } }
];
const buf = encodeDataFrame(items, { full: true, now });
const dec = decodeDataFrame(buf);
check('round trip: full flag + count', dec.full === true && dec.entries.length === 10, { full: dec.full, n: dec.entries.length });
check('int32 + timestamp offset', dec.entries[0].value === 42 && dec.entries[0].timestamp === now - 5, dec.entries[0]);
check('float64', dec.entries[1].value === -3.25, dec.entries[1].value);
check('bools', dec.entries[2].value === true && dec.entries[3].value === false, [dec.entries[2].value, dec.entries[3].value]);
check('utf8 string', dec.entries[4].value === 'héllo', dec.entries[4].value);
check('json', JSON.stringify(dec.entries[5].value) === '[1,2,{"a":3}]', dec.entries[5].value);
check('null', dec.entries[6].isNull === true && dec.entries[6].online === true, dec.entries[6]);
check('offline + never-seen both OFFLINE', dec.entries[7].online === false && dec.entries[8].online === false, [dec.entries[7], dec.entries[8]]);
check('> int32 goes as float64', dec.entries[9].value === 3000000000, dec.entries[9].value);
const one = encodeDataFrame([{ idx: 3, entry: { online: true, value: 12345 } }], { now });
check('one int tag = 12B header + 7B entry', one.length === HEADER_BYTES + 7, one.length);
const hb = encodeDataFrame([], { now });
check('heartbeat frame is 12 bytes', hb.length === 12, hb.length);

// --- hub ---
function fakeTransport() {
  const t = { texts: [], frames: [], buffered: 0 };
  t.sendText = (s) => t.texts.push(JSON.parse(s));
  t.sendBinary = (b) => t.frames.push(decodeDataFrame(b));
  t.bufferedAmount = () => t.buffered;
  return t;
}
const K = (dev, m) => 'G::E::' + dev + '::' + m;
const hub = new IoHub({ hbMs: 1000, highWater: 1000 });
hub.absorbSnapshot({ G: { E: { online: true, nodeMetrics: {}, devices: { GP: { online: true, metrics: {
  'Lantai_1/d': { value: 1, type: 'Int32', engUnit: 'pulse' },
  'RuangBlower/MotorCommandON': { value: false, type: 'Boolean' },
  'Other/x': { value: 5, type: 'Int32' }
} } } } } });

const t1 = fakeTransport();
const c1 = hub.addClient(t1);
hub.handleText(c1, { t: 'open', rpi: 20, keys: [K('GP', 'Lantai_1/d'), K('GP', 'RuangBlower/MotorCommandON'), K('GP', 'Missing/tag')] });
clearInterval(c1.timer); // drive cycles by hand
check('open -> opened with rpi + hb', t1.texts[0].t === 'opened' && t1.texts[0].rpi === 20 && t1.texts[0].hb === 1000, t1.texts[0]);
check('layout sent before first frame, with type/engUnit', t1.texts[1] && t1.texts[1].t === 'layout' && t1.texts[1].add.length === 3 && t1.texts[1].add[0][3] === 'pulse', t1.texts[1]);
const f0 = t1.frames[0];
check('first frame is FULL with only the 3 subscribed keys (not Other/x)', f0.full && f0.entries.length === 3, f0.entries.length);
check('unknown tag comes as OFFLINE (-> ??? on screen)', f0.entries[2].online === false, f0.entries[2]);

// 100 encoder changes between two cycles -> one entry with the last value
for (let i = 2; i <= 101; i++) hub.applyDelta({ type: 'data', groupId: 'G', edgeNodeId: 'E', deviceId: 'GP', metrics: [{ name: 'Lantai_1/d', value: i, type: 'Int32', engUnit: 'pulse' }] });
hub.applyDelta({ type: 'data', groupId: 'G', edgeNodeId: 'E', deviceId: 'GP', metrics: [{ name: 'Other/x', value: 99, type: 'Int32' }] });
hub.tick(c1);
const f1 = t1.frames[1];
check('100 changes in one RPI -> ONE entry, latest value; unsubscribed tag not sent', f1.entries.length === 1 && f1.entries[0].value === 101 && !f1.full, f1.entries);

// nothing changed -> no frame until hb
hub.tick(c1);
check('no change -> no frame (before heartbeat is due)', t1.frames.length === 2, t1.frames.length);
c1.lastSent = Date.now() - 1500;
hub.tick(c1);
check('heartbeat: empty frame after hbMs', t1.frames.length === 3 && t1.frames[2].entries.length === 0, t1.frames.length);

// backpressure: socket backed up -> skip cycles, then send only the latest
t1.buffered = 5000;
hub.applyDelta({ type: 'data', groupId: 'G', edgeNodeId: 'E', deviceId: 'GP', metrics: [{ name: 'Lantai_1/d', value: 500, type: 'Int32', engUnit: 'pulse' }] });
hub.tick(c1); hub.tick(c1);
hub.applyDelta({ type: 'data', groupId: 'G', edgeNodeId: 'E', deviceId: 'GP', metrics: [{ name: 'Lantai_1/d', value: 501, type: 'Int32', engUnit: 'pulse' }] });
check('backed-up socket: cycles skipped, nothing queued', t1.frames.length === 3 && c1.cyclesSkipped === 2, { frames: t1.frames.length, skipped: c1.cyclesSkipped });
t1.buffered = 0;
hub.tick(c1);
check('drained: ONE frame with only the latest value (500 dropped)', t1.frames.length === 4 && t1.frames[3].entries.length === 1 && t1.frames[3].entries[0].value === 501, t1.frames[3] && t1.frames[3].entries);

// metadata change -> layout re-sent for that index
const textsBefore = t1.texts.length;
hub.applyDelta({ type: 'data', groupId: 'G', edgeNodeId: 'E', deviceId: 'GP', metrics: [{ name: 'Lantai_1/d', value: 502, type: 'Int32', engUnit: 'mm' }] });
hub.tick(c1);
const relayout = t1.texts[textsBefore];
check('engUnit change -> layout re-sent for that index only', relayout && relayout.t === 'layout' && relayout.add.length === 1 && relayout.add[0][3] === 'mm', relayout);

// death -> offline
hub.applyDelta({ type: 'death', groupId: 'G', edgeNodeId: 'E', deviceId: 'GP' });
hub.tick(c1);
const fd = t1.frames[t1.frames.length - 1];
check('DDEATH -> subscribed tags sent OFFLINE', fd.entries.length === 2 && fd.entries.every((e) => e.online === false), fd.entries);

// resubscribe: new key gets its current value immediately
hub.applyDelta({ type: 'birth', groupId: 'G', edgeNodeId: 'E', deviceId: 'GP', metrics: [{ name: 'Other/x', value: 7, type: 'Int32' }] });
hub.handleText(c1, { t: 'sub', keys: [K('GP', 'Other/x')] });
hub.tick(c1);
const fs2 = t1.frames[t1.frames.length - 1];
check('sub -> newly subscribed key sent with its current value', fs2.entries.length === 1 && fs2.entries[0].value === 7, fs2.entries);

// multi client: independent RPI/subscription, "*" gets everything
const t2 = fakeTransport();
const c2 = hub.addClient(t2);
hub.handleText(c2, { t: 'open', rpi: 1, keys: '*' });
clearInterval(c2.timer);
check('RPI clamped to >= 5ms', t2.texts[0].rpi === 5, t2.texts[0].rpi);
check('"*" client: full frame with every known tag', t2.frames[0].full && t2.frames[0].entries.length === 3, t2.frames[0].entries.length);

// explicit write
let written = null;
const hubW = new IoHub({ onWrite: (c, m) => { written = m; } });
const tw = fakeTransport(); const cw = hubW.addClient(tw);
hubW.handleText(cw, { t: 'w', id: 9, g: 'G', e: 'E', d: 'GP', m: [{ n: 'RuangBlower/MotorCommandON', v: true }] });
check('explicit write handed to onWrite', written && written.id === 9 && written.m[0].v === true, written);

hub.close(); hubW.close();
if (!failures) console.log('ALL OK');
process.exit(failures ? 1 : 0);
