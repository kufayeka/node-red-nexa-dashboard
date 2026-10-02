// src/shared/link/frame.js + src/server/link/hub.js — Nexa Link, no sockets.
// Run standalone: node test/link-hub.test.js
const zlib = require('zlib');
const F = require('../src/shared/link/frame.js');
const { LinkHub } = require('../src/server/link/hub.js');

let failures = 0;
function check(label, ok, actual) {
  if (!ok) failures++;
  console.log(label + '?', !!ok, '(actual: ' + JSON.stringify(actual) + ')');
}
const tick = () => new Promise((r) => setImmediate(r));

// ---------- frame ----------
const big = new Uint8Array(200 * 1024).map((_, i) => i % 251);
const frames = F.encodeMessage(7, { t: 'push', ch: 'a' }, big, F.F_BINARY, 64 * 1024);
check('200 KB -> 4 frames of <= 64 KB', frames.length === 4 && frames.every((f) => f.length <= 64 * 1024 + F.HEADER_BYTES + 64), frames.map((f) => f.length));
const f0 = F.decodeFrame(frames[0]);
const f3 = F.decodeFrame(frames[3]);
check('meta + FIRST only on the first frame', f0.meta && f0.meta.ch === 'a' && (f0.flags & F.F_FIRST) && !F.decodeFrame(frames[1]).meta, f0.meta);
check('LAST + BINARY on the last frame', (f3.flags & F.F_LAST) && (f3.flags & F.F_BINARY) && f3.totalLen === big.length, f3.flags);

// interleave two messages: reassembles both
const small = F.utf8(JSON.stringify({ hello: 'wörld' }));
const framesB = F.encodeMessage(8, { t: 'push', ch: 'b' }, small, 0);
const ra = new F.Reassembler(() => 1024 * 1024);
const got = [];
[frames[0], framesB[0], frames[1], frames[2], frames[3]].forEach((fr) => { const r = ra.push(fr); if (r) got.push(r); });
check('interleaved: small message completes first', got.length === 2 && got[0].msgId === 8 && JSON.parse(F.fromUtf8(got[0].bytes)).hello === 'wörld', got.map((g) => g.msgId));
check('interleaved: big message intact', got[1] && got[1].bytes.length === big.length && got[1].bytes.every((v, i) => v === big[i]), got[1] && got[1].bytes.length);
check('complete payload owns its ArrayBuffer (transferable)', got[1].bytes.byteOffset === 0 && got[1].bytes.buffer.byteLength === big.length, got[1].bytes.buffer.byteLength);
check('nothing left pending', ra.pending.size === 0 && ra.pendingBytes === 0, ra.pendingBytes);

// limits
const raSmall = new F.Reassembler((meta) => (meta.ch === 'known' ? 1000 : 0));
const tooBig = F.encodeMessage(1, { t: 'send', ch: 'known' }, new Uint8Array(5000), 0, 1000);
const r0 = raSmall.push(tooBig[0]);
const rest = tooBig.slice(1).map((fr) => raSmall.push(fr));
check('over maxBytes: refused on the first frame', r0 && /allows 1000/.test(r0.error), r0);
check('over maxBytes: the rest is dropped quietly', rest.every((r) => r === null) && raSmall.refused.size === 0, rest);
const unknown = raSmall.push(F.encodeMessage(2, { t: 'send', ch: 'nope' }, small, 0)[0]);
check('unknown channel refused', unknown && unknown.error === 'unknown channel', unknown);
let threw = false;
try { F.decodeFrame(new Uint8Array([9, 0, 0, 0])); } catch (e) { threw = true; }
check('malformed frame throws', threw, threw);

// ---------- hub ----------
function fakeTransport(opts) {
  opts = opts || {};
  const t = {
    texts: [], frames: [], buffered: 0, cbs: [],
    sendText(s) { t.texts.push(JSON.parse(s)); },
    sendBinary(u8, cb) {
      t.frames.push(u8);
      if (opts.slow) { t.buffered += u8.length; t.cbs.push(cb); } else setImmediate(cb);
    },
    bufferedAmount() { return t.buffered; },
    // the socket drained: run the write callbacks, like ws does
    drain() { t.buffered = 0; const cbs = t.cbs; t.cbs = []; cbs.forEach((cb) => cb()); }
  };
  return t;
}
function messagesOf(t) {
  const r = new F.Reassembler(() => 1 << 30);
  const out = [];
  t.frames.forEach((fr) => { const m = r.push(fr); if (m) out.push(m); });
  return out;
}
function jsonOf(m) { return JSON.parse(F.fromUtf8(m.bytes)); }
function upload(hub, client, msgId, meta, value, flags) {
  F.encodeMessage(msgId, meta, value instanceof Uint8Array ? value : F.utf8(JSON.stringify(value)), flags || 0).forEach((fr) => hub.handleBinary(client, fr));
}

(async function () {
  const fromNexa = [];
  const hub = new LinkHub({
    onFromNexa: (m) => fromNexa.push(m),
    compress: (u8) => new Promise((res, rej) => zlib.deflateRaw(u8, (e, z) => (e ? rej(e) : res(new Uint8Array(z)))))
  });
  hub.setChannel({ id: 'ch1', name: 'products', timeout: 200, maxBytes: 1024 * 1024 });
  hub.setChannel({ id: 'st', name: 'status', delivery: 'latest', retain: true });
  hub.setChannel({ id: 'z', name: 'zipped', compress: 'auto' });

  const t1 = fakeTransport();
  const c1 = hub.addClient(t1, { ip: '10.0.0.5' });
  check('welcome lists the channels', t1.texts[0].t === 'welcome' && t1.texts[0].channels.ch1.name === 'products' && t1.texts[0].channels.ch1.timeout === 200, t1.texts[0]);

  // request -> flow -> reply
  upload(hub, c1, 1, { t: 'req', ch: 'ch1', screen: 's1' }, { page: 2 });
  check('request reaches the flow with client, screen, ip', fromNexa.length === 1 && fromNexa[0].kind === 'req' && fromNexa[0].client === c1.id && fromNexa[0].screen === 's1' && fromNexa[0].ip === '10.0.0.5', fromNexa[0] && { kind: fromNexa[0].kind, client: fromNexa[0].client });
  check('request payload intact', JSON.parse(F.fromUtf8(fromNexa[0].bytes)).page === 2, F.fromUtf8(fromNexa[0].bytes));
  const products = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: 'Product ' + i, price: i * 1.5, sku: 'SKU-' + i }));
  const reply = hub.toNexa({ target: 'reply', rid: fromNexa[0].rid, ch: 'ch1', binary: false, bytes: F.utf8(JSON.stringify(products)) });
  await tick(); for (let i = 0; i < 40; i++) await tick();
  const res = messagesOf(t1).find((m) => m.meta.t === 'res');
  check('reply ok', reply.ok, reply);
  check('10 000 products arrive as one response to request 1', res && res.meta.re === 1 && jsonOf(res).length === 10000 && jsonOf(res)[9999].sku === 'SKU-9999', res && res.meta);
  check('a second reply is refused', !hub.toNexa({ target: 'reply', rid: fromNexa[0].rid, ch: 'ch1', bytes: F.utf8('1') }).ok, null);
  check('inflight back to 0', c1.inflight === 0, c1.inflight);

  // timeout
  upload(hub, c1, 2, { t: 'req', ch: 'ch1' }, null);
  await new Promise((r) => setTimeout(r, 260));
  const tmo = messagesOf(t1).find((m) => m.meta.t === 'res' && m.meta.re === 2);
  check('no answer -> timeout error to the page', tmo && /timeout/.test(tmo.meta.err), tmo && tmo.meta);
  check('late reply refused', !hub.toNexa({ target: 'reply', rid: fromNexa[1].rid, ch: 'ch1', bytes: F.utf8('1') }).ok, null);

  // error reply
  upload(hub, c1, 3, { t: 'req', ch: 'ch1' }, null);
  hub.toNexa({ target: 'reply', rid: fromNexa[2].rid, ch: 'ch1', error: 'DB down' });
  await tick(); await tick();
  const er = messagesOf(t1).find((m) => m.meta.re === 3);
  check('error reply reaches the page', er && er.meta.err === 'DB down', er && er.meta);

  // unknown channel / too many in flight
  upload(hub, c1, 4, { t: 'req', ch: 'nope' }, 1);
  await tick();
  const unk = messagesOf(t1).find((m) => m.meta.re === 4);
  check('request on an unknown channel -> error response', unk && unk.meta.err === 'unknown channel', unk && unk.meta);
  const before = fromNexa.length;
  for (let i = 0; i < 10; i++) upload(hub, c1, 100 + i, { t: 'req', ch: 'ch1' }, i);
  await tick();
  check('only 8 requests in flight reach the flow', fromNexa.length - before === 8, fromNexa.length - before);
  const busy = messagesOf(t1).filter((m) => m.meta.re >= 108 && /too many/.test(m.meta.err || ''));
  check('the 9th and 10th are refused', busy.length === 2, busy.length);

  // send (fire and forget)
  upload(hub, c1, 5, { t: 'send', ch: 'ch1' }, { clicked: true });
  check('send reaches the flow', fromNexa[fromNexa.length - 1].kind === 'send', fromNexa[fromNexa.length - 1].kind);

  // push to subscribers only + retain + latest
  const t2 = fakeTransport();
  const c2 = hub.addClient(t2, {});
  hub.handleText(c2, { t: 'sub', ch: ['st'] });
  const pushed = hub.toNexa({ target: 'all', ch: 'st', bytes: F.utf8('"running"') });
  await tick(); await tick();
  check('push reaches the subscriber only', pushed.delivered === 1 && messagesOf(t2).some((m) => m.meta.t === 'push' && jsonOf(m) === 'running'), pushed);
  const t3 = fakeTransport();
  const c3 = hub.addClient(t3, {});
  hub.handleText(c3, { t: 'sub', ch: ['st'] });
  await tick();
  const ret = messagesOf(t3).find((m) => m.meta.t === 'push');
  check('retain: a late subscriber gets the last message', ret && ret.meta.retained && jsonOf(ret) === 'running', ret && ret.meta);

  // latest: a slow client gets only the newest status
  const ts = fakeTransport({ slow: true });
  const cs = hub.addClient(ts, {});
  hub.handleText(cs, { t: 'sub', ch: ['st'] }); // gets the retained one
  ts.buffered = hub.highWater + 1; // the socket is backed up
  for (let i = 0; i < 50; i++) hub.toNexa({ target: 'all', ch: 'st', bytes: F.utf8(JSON.stringify(i)) });
  for (let i = 0; i < 5; i++) await tick();
  ts.drain(); hub.pump(cs);
  for (let i = 0; i < 5; i++) await tick();
  ts.drain();
  const latest = messagesOf(ts).filter((m) => m.meta.t === 'push').map(jsonOf);
  check('latest: the slow client gets few messages, ending with the newest', latest.length <= 4 && latest[latest.length - 1] === 49, latest);

  // queue: a slow client gets every message, in order
  hub.setChannel({ id: 'q', name: 'data' });
  const tq = fakeTransport({ slow: true });
  const cq = hub.addClient(tq, {});
  hub.handleText(cq, { t: 'sub', ch: ['q'] });
  for (let i = 0; i < 50; i++) hub.toNexa({ target: 'all', ch: 'q', bytes: F.utf8(JSON.stringify(i)) });
  for (let r = 0; r < 60; r++) { await tick(); tq.drain(); }
  const all = messagesOf(tq).filter((m) => m.meta.t === 'push').map(jsonOf);
  check('queue: all 50 in order', all.length === 50 && all.every((v, i) => v === i), all.length);

  // pacing: nothing more than highWater goes into a stuck socket
  const tp = fakeTransport({ slow: true });
  const cp = hub.addClient(tp, {});
  hub.handleText(cp, { t: 'sub', ch: ['ch1'] });
  hub.toNexa({ target: 'all', ch: 'ch1', bytes: new Uint8Array(900 * 1024), binary: true });
  for (let i = 0; i < 5; i++) await tick();
  check('pacing: a stuck socket holds at most highWater + 1 frame', tp.buffered <= hub.highWater + 64 * 1024 + 100, tp.buffered);
  // round robin: a small message queued behind a big one goes out within a frame or two
  hub.toNexa({ target: 'client', client: cp.id, ch: 'ch1', bytes: F.utf8('"small"') });
  for (let i = 0; i < 3; i++) await tick();
  tp.drain();
  for (let i = 0; i < 3; i++) await tick();
  const order = tp.frames.map((fr) => F.decodeFrame(fr)).filter((f) => f.flags & F.F_LAST).map((f) => f.totalLen);
  check('round robin: the small message finishes before the big one', order[0] === 7, order);

  // compression: once per message, only for clients that can inflate
  const tz = fakeTransport();
  const cz = hub.addClient(tz, { deflate: true });
  const tn = fakeTransport();
  const cn = hub.addClient(tn, { deflate: false });
  hub.handleText(cz, { t: 'sub', ch: ['z'] });
  hub.handleText(cn, { t: 'sub', ch: ['z'] });
  let compressCalls = 0;
  const realCompress = hub.compress;
  hub.compress = (u8) => { compressCalls++; return realCompress(u8); };
  hub.toNexa({ target: 'all', ch: 'z', bytes: F.utf8(JSON.stringify(products)) });
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 5));
  const mz = messagesOf(tz).find((m) => m.meta.t === 'push');
  const mn = messagesOf(tn).find((m) => m.meta.t === 'push');
  check('compressed once for two clients', compressCalls === 1, compressCalls);
  check('deflate client gets DEFLATE, much smaller', mz && (mz.flags & F.F_DEFLATE) && mz.bytes.length < mn.bytes.length / 3, mz && [mz.bytes.length, mn.bytes.length]);
  check('deflated payload inflates back to the products', mz && JSON.parse(zlib.inflateRawSync(Buffer.from(mz.bytes)).toString()).length === 10000, null);
  check('non-deflate client gets the plain JSON', mn && !(mn.flags & F.F_DEFLATE) && jsonOf(mn).length === 10000, null);

  // a page that leaves: its pending requests go away
  upload(hub, c2, 1, { t: 'req', ch: 'ch1' }, 1);
  const rid = fromNexa[fromNexa.length - 1].rid;
  hub.removeClient(c2);
  check('page left: reply refused', !hub.toNexa({ target: 'reply', rid, ch: 'ch1', bytes: F.utf8('1') }).ok, null);

  hub.close();
  if (!failures) console.log('ALL OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
