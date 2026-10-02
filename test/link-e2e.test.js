'use strict';
// Nexa Link end to end, on a LIVE page of an isolated Node-RED (its own userDir in the temp
// folder, never the user's data/), with a real MQTT broker (aedes) and a simulated Sparkplug
// edge whose tag "Tick" changes every 20 ms:
//   - Request -> from Nexa -> a function (10 000 products) -> to Nexa -> the page
//   - From Node-RED: a flow pushes 20 MB (binary) to the page
//   - the tag frames (/_io) are timed in the page the whole time: their gaps must stay
//     normal while the 20 MB go through the link (own socket, own thread)
//   - and, reported (not a pass/fail): what a flow that blocks Node-RED's main thread for
//     500 ms does to the tags today (the tag path still goes through the main thread)
//   node test/link-e2e.test.js     (needs Chrome, the dashboard built, ports 1899 / 1898 / 1897 / 1893 free)
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { Aedes } = require('aedes');
const mqtt = require('mqtt');
const sp = require('../src/server/sparkplug/sparkplugCodec.js');
const { withPage } = require('../sdk/testkit/cdp.js');
const RED_JS = path.resolve(__dirname, '../../../node-red/red.js');
const PORTS = { editor: 1899, pages: 1898, link: 1897, mqtt: 1893 };
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-link-e2e-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, actual) => { if (!ok) failures++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (actual !== undefined ? '   ' + JSON.stringify(actual) : '')); };

const TAG = '{sparkplug:G::E1::D1::Tick}';
const fn = (id, name, func, outputs, wires) => ({ id, type: 'function', z: 'tab1', name, func, outputs: outputs || 1, wires: wires || [[]] });

function writeFlows() {
    const dir = path.join(S, 'nr-link');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.js'), 'module.exports = { uiPort: ' + PORTS.editor + ', flowFile: "flows.json", nexaDashboard: { screenWorkerPort: ' + PORTS.pages + ', linkWorkerPort: ' + PORTS.link + ' }, logging: { console: { level: "warn" } }, editorTheme: { tours: false, projects: { enabled: false } } };\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'nr-link', version: '0.0.1', private: true }));
    const logic = {
        nodes: [
            { id: 'inj', type: 'inject', intervalMs: 1500, once: true, payloadType: 'json', payload: '{"page":1}', x: 20, y: 20 },
            { id: 'req', type: 'link-request', channel: 'chP', channelName: 'products', x: 200, y: 20 },
            { id: 'ok', type: 'function', code: 'window.__res = window.__res || []; window.__res.push({ n: msg.payload.length, last: msg.payload[msg.payload.length - 1].sku, t: performance.now() }); return null;', x: 400, y: 20 },
            { id: 'err', type: 'function', code: 'window.__err = msg.error; return null;', x: 400, y: 80 },
            { id: 'rcv', type: 'link-receive', channel: 'chB', channelName: 'big', x: 20, y: 160 },
            { id: 'got', type: 'function', code: 'window.__big = window.__big || []; var u = new Uint8Array(msg.payload); window.__big.push({ bytes: msg.payload.byteLength, mid: u[u.length >> 1], t: performance.now() }); return null;', x: 200, y: 160 }
        ],
        wires: [{ from: 'inj', to: 'req' }, { from: 'req', to: 'ok', fromPort: 0 }, { from: 'req', to: 'err', fromPort: 1 }, { from: 'rcv', to: 'got' }]
    };
    const project = { id: 'proj', type: 'kufayeka-nexa-project', name: 'Link', sparkplugConnection: 'spc',
        screens: [{ id: 'sL', name: 'Link', path: '/link', width: 600, height: 400, gridSize: 10, snap: false, treeVersion: 1, orphans: [],
            components: [{ id: 'st1', type: 'nexa-ui-stat', x: 20, y: 20, w: 220, h: 96, props: { label: 'Tick', inputValue: TAG, change: '' } }],
            logic, variables: [] }],
        templates: [], types: [], breakpoints: [], theme: null, variables: [] };
    const conn = { id: 'spc', type: 'kufayeka-nexa-sparkplug', name: 'test', brokerUrl: 'mqtt://127.0.0.1:' + PORTS.mqtt, groupFilter: '+', edgeNodeFilter: '+', keepAlive: 30, protocolVersion: '4', reconnectPeriod: 1000, connectTimeout: 10000, clientIdOverride: '' };
    const flows = [
        { id: 'tab1', type: 'tab', label: 'Link' }, conn, project,
        { id: 'chP', type: 'kufayeka-nexa-channel', name: 'products', maxMb: 32, timeoutS: 10, delivery: 'queue', retain: false, compress: 'off' },
        { id: 'chB', type: 'kufayeka-nexa-channel', name: 'big', maxMb: 64, timeoutS: 10, delivery: 'queue', retain: false, compress: 'off' },
        // Request: 10 000 products
        { id: 'fromP', type: 'kufayeka-nexa-from', z: 'tab1', channel: 'chP', wires: [['mk']] },
        fn('mk', 'products', 'msg.payload = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: "Product " + i, price: i * 1.5, sku: "SKU-" + i, stock: i % 17, desc: "Lorem ipsum dolor sit amet " + i })); return msg;', 1, [['toP']]),
        { id: 'toP', type: 'kufayeka-nexa-to', z: 'tab1', channel: 'chP', target: 'auto', wires: [] },
        // GET /blast: push 20 MB to every page on "big"
        { id: 'hb', type: 'http in', z: 'tab1', url: '/blast', method: 'get', wires: [['mkB']] },
        fn('mkB', 'blast', 'const b = Buffer.alloc(20 * 1024 * 1024, 7); return [{ payload: b }, msg];', 2, [['toB'], ['res']]),
        { id: 'toB', type: 'kufayeka-nexa-to', z: 'tab1', channel: 'chB', target: 'all', wires: [] },
        // GET /block: keep Node-RED's main thread busy for 500 ms
        { id: 'hk', type: 'http in', z: 'tab1', url: '/block', method: 'get', wires: [['blk']] },
        fn('blk', 'block', 'const t = Date.now(); while (Date.now() - t < 500) {} return msg;', 1, [['res']]),
        { id: 'res', type: 'http response', z: 'tab1', wires: [] }
    ];
    fs.writeFileSync(path.join(dir, 'flows.json'), JSON.stringify(flows, null, 1));
    return dir;
}

async function startEdge() {
    const broker = await Aedes.createBroker();
    const server = net.createServer(broker.handle.bind(broker));
    await new Promise((r) => server.listen(PORTS.mqtt, '127.0.0.1', r));
    const edge = mqtt.connect('mqtt://127.0.0.1:' + PORTS.mqtt, { clientId: 'edge-sim' });
    await new Promise((r) => edge.on('connect', r));
    let seq = 0, tick = 0;
    const birth = () => {
        edge.publish('spBv1.0/G/NBIRTH/E1', sp.encodePayload({ timestamp: Date.now(), seq: seq = 0, metrics: [{ name: 'bdSeq', type: 'UInt64', value: 0 }] }));
        edge.publish('spBv1.0/G/DBIRTH/E1/D1', sp.encodePayload({ timestamp: Date.now(), seq: ++seq % 256, metrics: [{ name: 'Tick', type: 'Int32', value: tick }] }));
    };
    edge.subscribe('spBv1.0/G/NCMD/E1');
    edge.on('message', (topic, buf) => { if ((sp.decodePayload(buf).metrics || []).some((m) => /Rebirth/.test(m.name))) birth(); });
    birth();
    const timer = setInterval(() => {
        edge.publish('spBv1.0/G/DDATA/E1/D1', sp.encodePayload({ timestamp: Date.now(), seq: ++seq % 256, metrics: [{ name: 'Tick', type: 'Int32', value: ++tick }] }));
    }, 20);
    return { birth, close: () => { clearInterval(timer); edge.end(true); server.close(); broker.close(); } };
}

// wrap WebSocket before the runtime loads: time every binary frame, per socket kind
const INIT = `(function () {
    var W = window.WebSocket;
    window.__io = []; window.__link = [];
    function Wrapped(url, protocols) {
        var ws = protocols ? new W(url, protocols) : new W(url);
        var list = /\\/_io/.test(url) ? window.__io : window.__link;
        ws.addEventListener('message', function (e) { if (typeof e.data !== 'string') list.push(performance.now()); });
        return ws;
    }
    Wrapped.prototype = W.prototype;
    Wrapped.CONNECTING = 0; Wrapped.OPEN = 1; Wrapped.CLOSING = 2; Wrapped.CLOSED = 3;
    window.WebSocket = Wrapped;
})();`;

function gaps(times, from, to) {
    const t = times.filter((x) => x >= from && x <= to);
    const g = [];
    for (let i = 1; i < t.length; i++) g.push(t[i] - t[i - 1]);
    g.sort((a, b) => a - b);
    const pct = (p) => g.length ? Math.round(g[Math.min(g.length - 1, Math.floor(p * g.length))]) : null;
    return { frames: t.length, p50: pct(0.5), p99: pct(0.99), max: g.length ? Math.round(g[g.length - 1]) : null };
}

const portFree = (port) => new Promise((resolve) => { const t = net.createServer().once('error', () => resolve(false)).once('listening', () => t.close(() => resolve(true))).listen(port, '127.0.0.1'); });

(async () => {
    for (const p of Object.values(PORTS)) {
        if (!(await portFree(p))) { console.error('port ' + p + ' is in use (a Node-RED running?) - stop it first'); process.exit(1); }
    }
    const edge = await startEdge();
    const dir = writeFlows();
    const nr = spawn(process.execPath, [RED_JS, '-u', dir], { cwd: path.resolve(RED_JS, '../../..'), stdio: ['ignore', fs.openSync(path.join(S, 'nr.log'), 'w'), fs.openSync(path.join(S, 'nr.err'), 'w')] });
    try {
        for (let i = 0; i < 60; i++) { try { if (await fetch('http://127.0.0.1:' + PORTS.pages + '/nexa/link').then((r) => r.status === 200)) break; } catch (e) { /* not yet */ } await wait(1000); }
        await wait(2500);
        edge.birth();
        const info = await fetch('http://127.0.0.1:' + PORTS.pages + '/nexa/_link-info').then((r) => r.json());
        check('the screen worker knows the link port + gives a token', info.port === PORTS.link && /\./.test(info.token), { port: info.port });

        const r = await withPage('http://127.0.0.1:' + PORTS.pages + '/nexa/link', async ({ js, logs }) => {
            await wait(3000);
            const res = await js('window.__res || []');
            check('Request: 10 000 products from the flow reach the page', res.length >= 1 && res[0].n === 10000 && res[0].last === 'SKU-9999', res[0]);
            check('Request: repeats (inject every 1.5 s)', res.length >= 2, res.length);
            check('no error output', !(await js('window.__err || null')), await js('window.__err || null'));
            const tick = await js('document.querySelector(\'[data-id="st1"] > *\').renderRoot.textContent');
            check('the tag shows on the page', /\d/.test(tick), tick.trim().slice(0, 40));

            // tags alone (on Windows a 20 ms timer fires every ~31 ms: the timer resolution is 15.6 ms)
            const t0 = await js('performance.now()');
            await wait(5000);
            const t1 = await js('performance.now()');
            const base = gaps(await js('window.__io'), t0, t1);
            console.log('     tag frames, link idle:         ' + JSON.stringify(base));
            check('tag frames keep coming (p50 gap <= 40 ms)', base.frames > 100 && base.p50 <= 40, base);

            // 20 MB pushed through the link, 5 times; the tag gaps in those windows together
            const windows = [];
            let all = [];
            for (let round = 1; round <= 5; round++) {
                const b0 = await js('performance.now()');
                const blast = fetch('http://127.0.0.1:' + PORTS.editor + '/blast').then((x) => x.status);
                let big = [];
                for (let i = 0; i < 200 && big.length < round; i++) { await wait(20); big = await js('window.__big || []'); }
                await blast;
                await wait(100);
                const b1 = await js('performance.now()');
                const b = big[round - 1];
                windows.push(b ? Math.round(b.t - b0) : -1);
                if (round === 1) check('From Node-RED: 20 MB reach the page intact', b && b.bytes === 20 * 1024 * 1024 && b.mid === 7, b && { bytes: b.bytes, mid: b.mid });
                const io = await js('window.__io');
                all = all.concat(io.filter((x) => x >= b0 && x <= b1).map((x, i, a) => (i ? x - a[i - 1] : null)).filter((g) => g !== null));
                await wait(500);
            }
            all.sort((a, b) => a - b);
            const during = { gaps: all.length, p50: Math.round(all[Math.floor(all.length / 2)]), p99: Math.round(all[Math.floor(all.length * 0.99)]), max: Math.round(all[all.length - 1]) };
            console.log('     20 MB on the page after (ms):   ' + JSON.stringify(windows));
            console.log('     tag frames, during the 20 MB:  ' + JSON.stringify(during));
            check('20 MB arrive in under 2 s each', windows.every((w) => w > 0 && w < 2000), windows);
            check('tags keep their pace while 20 MB go through the link (worst gap no worse than the idle worst + 50 ms)', during.gaps > 20 && during.max <= base.max + 50, { during: during.max, idle: base.max });

            // a flow that blocks the main thread (reported)
            const k0 = await js('performance.now()');
            await fetch('http://127.0.0.1:' + PORTS.editor + '/block');
            await wait(300);
            const k1 = await js('performance.now()');
            const blocked = gaps(await js('window.__io'), k0, k1);
            console.log('     tag frames, main thread busy 500 ms: ' + JSON.stringify(blocked) + '   <- the tag path still goes through the main thread (next stage)');

            const errs = logs.filter((l) => !/favicon/.test(l));
            check('no page errors', errs.length === 0, errs);
            return true;
        }, { width: 800, height: 600, ready: 'document.readyState === "complete"', readyTries: 100, initScript: INIT });
        if (r === null) console.log('SKIP: no Chrome');
    } finally {
        nr.kill();
        edge.close();
        await wait(500);
        try { fs.rmSync(S, { recursive: true, force: true }); } catch (e) { /* still held */ }
    }
    console.log(failures ? 'FAILED: ' + failures : 'ALL OK');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
