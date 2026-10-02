// Nexa Link end to end on the server: the real link worker (own thread, own port),
// the real "from Nexa" / "to Nexa" / channel nodes (nodes/nexa-link.js) under a
// minimal fake RED, and a real WebSocket client speaking src/shared/link/frame.js.
// Run standalone: node test/link-worker-integration.test.js
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const zlib = require('zlib');
const F = require('../src/shared/link/frame.js');
const bridge = require('../src/server/link/bridge.js');
const { issueToken } = require('../src/server/link/token.js');

let failures = 0;
function check(label, ok, actual) {
  if (!ok) failures++;
  console.log(label + '?', !!ok, '(actual: ' + JSON.stringify(actual) + ')');
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a minimal RED ----
const types = {};
const nodes = {};
const RED = {
  settings: { nexaDashboard: { screenWorkerPort: 0, linkWorkerPort: 0 } },
  log: { info() {}, warn(m) { console.log('[warn]', m); } },
  nodes: {
    createNode(node, config) {
      Object.assign(node, new EventEmitter());
      Object.setPrototypeOf(node, Object.assign(Object.create(EventEmitter.prototype), Object.getPrototypeOf(node)));
      node.id = config.id;
      node.sent = [];
      node.statuses = [];
      node.send = (m) => node.sent.push(m);
      node.status = (s) => node.statuses.push(s);
      node.error = (e) => { node.lastError = e; };
      nodes[config.id] = node;
    },
    registerType(name, ctor) { types[name] = ctor; },
    getNode(id) { return nodes[id]; }
  }
};
require('../nodes/nexa-link.js')(RED);
function make(type, config) { return new types[type](config); }
function input(node, msg) {
  return new Promise((resolve) => node.emit('input', msg, () => {}, (err) => resolve(err || null)));
}

// ---- a page ----
function connect(port, opts) {
  opts = opts || {};
  const token = opts.token || issueToken(bridge.getSecret());
  const url = 'ws://127.0.0.1:' + port + '/nexa/_link?t=' + encodeURIComponent(token) + (opts.deflate ? '&z=1' : '');
  const ws = new WebSocket(url, opts.origin ? { origin: opts.origin } : {});
  const page = { ws, texts: [], messages: [], r: new F.Reassembler(() => 1 << 30), next: 0 };
  ws.on('message', (data, isBinary) => {
    if (!isBinary) { page.texts.push(JSON.parse(data.toString())); return; }
    const m = page.r.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (m) page.messages.push(m);
  });
  page.send = (meta, value) => {
    const id = ++page.next;
    const bytes = value instanceof Uint8Array ? value : F.utf8(JSON.stringify(value));
    F.encodeMessage(id, meta, bytes, value instanceof Uint8Array ? F.F_BINARY : 0).forEach((fr) => ws.send(fr));
    return id;
  };
  page.opened = new Promise((resolve) => { ws.on('open', () => resolve(true)); ws.on('error', () => resolve(false)); ws.on('unexpected-response', () => resolve(false)); });
  return page;
}
async function until(fn, ms) {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) { const v = fn(); if (v) return v; await wait(10); }
  return fn();
}
const json = (m) => JSON.parse(F.fromUtf8(m.bytes));

(async function () {
  const portP = new Promise((r) => bridge.once('port', r));
  const ch = make('kufayeka-nexa-channel', { id: 'chP', name: 'products', maxMb: 32, timeoutS: 2, delivery: 'queue' });
  make('kufayeka-nexa-channel', { id: 'chS', name: 'status', delivery: 'latest', retain: true, compress: 'auto' });
  const from = make('kufayeka-nexa-from', { id: 'from1', channel: 'chP' });
  const to = make('kufayeka-nexa-to', { id: 'to1', channel: 'chP', target: 'auto' });
  const toStatus = make('kufayeka-nexa-to', { id: 'to2', channel: 'chS', target: 'all' });
  const port = await portP;
  check('link worker listening on its own port', port > 0 && bridge.isRunning(), port);

  // security
  const bad = connect(port, { token: 'nope.nope' });
  check('a bad token is refused', (await bad.opened) === false, null);
  const evil = connect(port, { origin: 'http://evil.example' });
  check('another site\'s page is refused (Origin)', (await evil.opened) === false, null);

  const page = connect(port, { origin: 'http://127.0.0.1:1898' });
  check('a page with a valid token connects', await page.opened, null);
  const welcome = await until(() => page.texts.find((t) => t.t === 'welcome'));
  check('welcome lists both channels with their timeout', welcome && welcome.channels.chP.timeout === 2000 && welcome.channels.chS.name === 'status', welcome && welcome.channels);

  // Request -> from Nexa -> (the flow) -> to Nexa -> the page
  const products = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: 'Product ' + i, price: i * 1.5, sku: 'SKU-' + i, stock: i % 17 }));
  const reqId = page.send({ t: 'req', ch: 'chP', screen: 'scr1' }, { page: 1 });
  const got = await until(() => from.sent[0]);
  check('from Nexa outputs the request', got && got.payload.page === 1 && got.topic === 'products', got && got.payload);
  check('msg._nexa has client, screen, reqId', got && got._nexa.client && got._nexa.screen === 'scr1' && got._nexa.reqId > 0, got && got._nexa);
  const t0 = Date.now();
  const err = await input(to, { payload: products, _nexa: got._nexa });
  const res = await until(() => page.messages.find((m) => m.meta.t === 'res' && m.meta.re === reqId), 5000);
  const ms = Date.now() - t0;
  check('to Nexa answered without error', err === null, err && err.message);
  check('10 000 products reach the page (' + (res ? (res.bytes.length / 1048576).toFixed(2) : '?') + ' MB in ' + ms + ' ms)', res && json(res).length === 10000 && json(res)[9999].sku === 'SKU-9999', res && res.meta);
  check('to Nexa status shows 1 page', to.statuses.some((s) => s.text === '1 page'), to.statuses);

  // error answer (a Catch node's msg.error)
  const reqId2 = page.send({ t: 'req', ch: 'chP' }, null);
  const got2 = await until(() => from.sent[1]);
  await input(to, { payload: null, error: { message: 'DB down', source: { id: 'x' } }, _nexa: got2._nexa });
  const res2 = await until(() => page.messages.find((m) => m.meta.re === reqId2));
  check('msg.error answers with the error', res2 && res2.meta.err === 'DB down', res2 && res2.meta);

  // timeout (channel timeout 2 s)
  const reqId3 = page.send({ t: 'req', ch: 'chP' }, null);
  const res3 = await until(() => page.messages.find((m) => m.meta.re === reqId3), 4000);
  check('no answer -> timeout after the channel timeout', res3 && /timeout/.test(res3.meta.err), res3 && res3.meta);
  const late = await input(to, { payload: 1, _nexa: from.sent[2]._nexa });
  check('a late answer is an error on the to Nexa node', late && /no longer waiting/.test(late.message), late && late.message);

  // send (To Node-RED): binary stays binary
  page.send({ t: 'send', ch: 'chP' }, new Uint8Array([1, 2, 3, 250]));
  const got4 = await until(() => from.sent[3]);
  check('a binary send arrives as a Buffer', got4 && Buffer.isBuffer(got4.payload) && got4.payload[3] === 250 && !got4._nexa.reqId, got4 && got4.payload);

  // push (From Node-RED) to subscribers, retain + compression
  const pageZ = connect(port, { deflate: true });
  await pageZ.opened;
  pageZ.ws.send(JSON.stringify({ t: 'sub', ch: ['chS'] }));
  page.ws.send(JSON.stringify({ t: 'sub', ch: ['chS'] }));
  await wait(50);
  const errP = await input(toStatus, { payload: { line: 1, state: 'running', products: products.slice(0, 2000) } });
  const pz = await until(() => pageZ.messages.find((m) => m.meta.t === 'push'));
  const pn = await until(() => page.messages.find((m) => m.meta.t === 'push'));
  check('push reached both pages', errP === null && pz && pn, errP && errP.message);
  check('the deflate page got it compressed, the other plain', pz && (pz.flags & F.F_DEFLATE) && pn && !(pn.flags & F.F_DEFLATE) && pz.bytes.length * 3 < pn.bytes.length, pz && [pz.bytes.length, pn.bytes.length]);
  check('compressed payload inflates to the same data', pz && JSON.parse(zlib.inflateRawSync(Buffer.from(pz.bytes)).toString()).state === 'running', null);
  const pageLate = connect(port);
  await pageLate.opened;
  pageLate.ws.send(JSON.stringify({ t: 'sub', ch: ['chS'] }));
  const ret = await until(() => pageLate.messages.find((m) => m.meta.t === 'push'));
  check('retain: a page that opens later gets the last status', ret && ret.meta.retained && json(ret).state === 'running', ret && ret.meta);

  // to the page in msg._nexa only
  const toClient = make('kufayeka-nexa-to', { id: 'to3', channel: 'chP', target: 'client' });
  page.ws.send(JSON.stringify({ t: 'sub', ch: ['chS', 'chP'] }));
  pageZ.ws.send(JSON.stringify({ t: 'sub', ch: ['chS', 'chP'] }));
  await wait(30);
  await input(toClient, { payload: 'just you', _nexa: got._nexa });
  await wait(100);
  check('target client: only that page', page.messages.some((m) => m.meta.t === 'push' && m.meta.ch === 'chP') && !pageZ.messages.some((m) => m.meta.ch === 'chP'), null);

  // too big for the channel
  const small = make('kufayeka-nexa-channel', { id: 'chT', name: 'tiny', maxMb: 0.001 });
  make('kufayeka-nexa-from', { id: 'from2', channel: 'chT' });
  await wait(30);
  const reqBig = page.send({ t: 'req', ch: 'chT' }, new Uint8Array(5000));
  const resBig = await until(() => page.messages.find((m) => m.meta.re === reqBig));
  check('an upload over maxBytes is refused before it reaches the flow', resBig && /allows/.test(resBig.meta.err) && !nodes.from2.sent.length, resBig && resBig.meta);

  // no from Nexa on a channel
  make('kufayeka-nexa-channel', { id: 'chE', name: 'empty' });
  await wait(30);
  const reqE = page.send({ t: 'req', ch: 'chE' }, 1);
  const resE = await until(() => page.messages.find((m) => m.meta.re === reqE));
  check('a request nobody listens to is answered with an error', resE && /no "from Nexa"/.test(resE.meta.err), resE && resE.meta);

  // redeploy: channels close + come back, the worker stays, the page stays connected
  ['chP', 'chS', 'chT', 'chE'].forEach((id) => nodes[id].emit('close'));
  make('kufayeka-nexa-channel', { id: 'chP', name: 'products', timeoutS: 2 });
  await wait(100);
  check('redeploy: same worker, page still connected', bridge.isRunning() && bridge.getPort() === port && page.ws.readyState === 1, bridge.getPort());

  // last channel gone -> the worker stops after the grace period
  nodes.chP.emit('close');
  await wait(3500);
  check('no channel left: the link worker stopped', !bridge.isRunning() && bridge.getPort() === null, bridge.isRunning());

  [page, pageZ, pageLate].forEach((p) => p.ws.terminate());
  bridge._stopForTests();
  if (!failures) console.log('ALL OK');
  setTimeout(() => process.exit(failures ? 1 : 0), 100);
})().catch((e) => { console.error(e); process.exit(1); });
