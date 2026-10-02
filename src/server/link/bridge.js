// Nexa Link, main-thread half: owns the link worker (src/server/workers/link-worker.js),
// the deployed channels, and the hand-over between the worker and the "from Nexa" /
// "to Nexa" nodes (nodes/nexa-link.js). One module-level instance, shared by the
// nodes and the plugin (src/server/plugin.js), which forwards the port to the
// screen worker so a page can find the link.
//
// The worker runs only while at least one kufayeka-nexa-channel is deployed: a
// project without links costs nothing. A redeploy closes and recreates every
// channel; the worker is kept for STOP_GRACE_MS so open pages stay connected.
//
// Payloads cross threads as bytes, serialized once here (JSON.stringify or the
// Buffer itself) into an ArrayBuffer of their own and TRANSFERRED (not cloned).
"use strict";
const { EventEmitter } = require("events");
const { Worker } = require("worker_threads");
const path = require("path");
const crypto = require("crypto");

const STOP_GRACE_MS = 3000;
const RESTART_MS = 1000;
const DEFAULT_PORT = 1882;

const bridge = new EventEmitter();
const secret = crypto.randomBytes(32).toString("hex");
const channels = new Map();   // id -> config
const handlers = new Map();   // channel id -> Set(fn(evt))
const pendingResults = new Map(); // ref -> fn(error)
let worker = null;
let port = null;
let wantedPort = DEFAULT_PORT;
let log = console;
let stopTimer = null;
let nextRef = 0;

let workerFactory = function (workerData) {
    return new Worker(path.join(__dirname, "..", "workers", "link-worker.js"), { workerData: workerData });
};

function post(msg, transfer) { if (worker) worker.postMessage(msg, transfer || []); }

function ensureWorker() {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (worker) return;
    const w = workerFactory({ port: wantedPort, secret: secret });
    worker = w;
    channels.forEach(function (ch) { post({ type: "channel", ch: ch }); });
    w.on("message", function (msg) {
        if (!msg || worker !== w) return;
        if (msg.type === "listening") {
            port = msg.port;
            log.info("[kufayeka-nexa-dashboard] Nexa Link on port " + port);
            bridge.emit("port", port);
        } else if (msg.type === "listen-error") {
            log.warn("[kufayeka-nexa-dashboard] Nexa Link can't listen on port " + wantedPort + ": " + msg.error +
                " (set nexaDashboard.linkWorkerPort in settings.js)");
        } else if (msg.type === "from-nexa") {
            deliver(msg);
        } else if (msg.type === "to-nexa-result") {
            const fn = pendingResults.get(msg.ref);
            pendingResults.delete(msg.ref);
            if (fn) fn(msg.error || null, msg.delivered);
        } else if (msg.type === "stats") {
            const fn = pendingResults.get(msg.ref);
            pendingResults.delete(msg.ref);
            if (fn) fn(null, msg.stats);
        }
    });
    w.on("error", function (err) { log.warn("[kufayeka-nexa-dashboard] Nexa Link worker error: " + (err && err.message)); });
    w.on("exit", function () {
        if (worker !== w) return;
        worker = null;
        setPort(null);
        if (channels.size) setTimeout(function () { if (channels.size && !worker) ensureWorker(); }, RESTART_MS);
    });
}

function setPort(p) {
    if (port === p) return;
    port = p;
    bridge.emit("port", p);
}

function stopWorker() {
    const w = worker;
    if (!w) return;
    worker = null;
    setPort(null);
    w.postMessage({ type: "close" });
    const t = setTimeout(function () { w.terminate().catch(function () {}); }, 1000);
    if (t.unref) t.unref();
}

function decode(msg) {
    const buf = Buffer.from(msg.bytes || new ArrayBuffer(0));
    if (msg.binary) return buf;
    if (!buf.length) return null;
    return JSON.parse(buf.toString("utf8"));
}

function deliver(msg) {
    const set = handlers.get(msg.ch);
    const ch = channels.get(msg.ch);
    if (!set || !set.size) {
        if (msg.kind === "req") reply(msg.rid, msg.ch, undefined, "no \"from Nexa\" node is listening on channel " + (ch ? "\"" + ch.name + "\"" : msg.ch));
        return;
    }
    let payload;
    try { payload = decode(msg); } catch (e) {
        if (msg.kind === "req") reply(msg.rid, msg.ch, undefined, "the page sent invalid JSON");
        return;
    }
    const nexa = { channel: msg.ch, client: msg.client, screen: msg.screen, ip: msg.ip };
    if (msg.kind === "req") nexa.reqId = msg.rid;
    let first = true;
    set.forEach(function (fn) {
        // every listening node gets its own copy, like any Node-RED fan-out
        const p = first ? payload : (Buffer.isBuffer(payload) ? Buffer.from(payload) : (payload === null || typeof payload !== "object" ? payload : JSON.parse(JSON.stringify(payload))));
        first = false;
        try { fn({ payload: p, _nexa: Object.assign({}, nexa) }); } catch (e) { log.warn("[kufayeka-nexa-dashboard] a \"from Nexa\" node threw: " + e.message); }
    });
}

/** A payload as bytes in an ArrayBuffer of its own (transferable), serialized once. */
function encodePayload(payload) {
    if (Buffer.isBuffer(payload) || ArrayBuffer.isView(payload)) {
        const src = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
        const ab = new ArrayBuffer(src.length);
        new Uint8Array(ab).set(src);
        return { binary: true, bytes: ab };
    }
    if (payload instanceof ArrayBuffer) return { binary: true, bytes: payload.slice(0) };
    const json = JSON.stringify(payload === undefined ? null : payload);
    const ab = new ArrayBuffer(Buffer.byteLength(json));
    Buffer.from(ab).write(json, "utf8");
    return { binary: false, bytes: ab };
}

function send(opts, done) {
    if (!worker) { if (done) done("Nexa Link is not running"); return false; }
    let enc;
    try { enc = encodePayload(opts.payload); } catch (e) { if (done) done("payload can't be sent: " + e.message); return false; }
    const ch = opts.ch && channels.get(opts.ch);
    if (ch && enc.bytes.byteLength > ch.maxBytes) {
        if (done) done("payload is " + enc.bytes.byteLength + " bytes, channel \"" + ch.name + "\" allows " + ch.maxBytes);
        if (opts.target === "reply") reply(opts.rid, opts.ch, undefined, "the answer is larger than the channel allows (" + ch.maxBytes + " bytes)");
        return false;
    }
    let ref;
    if (done) {
        ref = ++nextRef;
        pendingResults.set(ref, done);
        // the worker always answers; this only covers a worker that died meanwhile
        setTimeout(function () { if (pendingResults.delete(ref)) done("Nexa Link worker did not answer"); }, 10000).unref();
    }
    post({ type: "to-nexa", ref: ref, target: opts.target, ch: opts.ch, rid: opts.rid, client: opts.client, binary: enc.binary, bytes: enc.bytes }, [enc.bytes]);
    return true;
}

function reply(rid, ch, payload, error, done) {
    if (error) { post({ type: "to-nexa", target: "reply", rid: rid, ch: ch, error: String(error) }); if (done) done(null); return true; }
    return send({ target: "reply", rid: rid, ch: ch, payload: payload }, done);
}

bridge.configure = function (opts) {
    if (opts.port !== undefined && opts.port !== null) wantedPort = opts.port;
    if (opts.log) log = opts.log;
};

bridge.registerChannel = function (cfg) {
    channels.set(cfg.id, cfg);
    ensureWorker();
    post({ type: "channel", ch: cfg });
};

bridge.unregisterChannel = function (id) {
    if (!channels.delete(id)) return;
    post({ type: "channel-remove", id: id });
    if (!channels.size && !stopTimer) {
        stopTimer = setTimeout(function () { stopTimer = null; if (!channels.size) stopWorker(); }, STOP_GRACE_MS);
        if (stopTimer.unref) stopTimer.unref();
    }
};

/** A "from Nexa" node listens on a channel: fn({payload, _nexa}). Returns the unsubscribe. */
bridge.listen = function (chId, fn) {
    if (!handlers.has(chId)) handlers.set(chId, new Set());
    handlers.get(chId).add(fn);
    return function () {
        const set = handlers.get(chId);
        if (set) { set.delete(fn); if (!set.size) handlers.delete(chId); }
    };
};

/** Answer a request. done(error|null) */
bridge.reply = function (rid, ch, payload, error, done) { return reply(rid, ch, payload, error, done); };

/** Push to every page listening on the channel, or to one client. done(error|null) */
bridge.push = function (ch, payload, clientId, done) {
    return send({ target: clientId ? "client" : "all", ch: ch, client: clientId || undefined, payload: payload }, done);
};

bridge.getPort = function () { return port; };
bridge.getSecret = function () { return secret; };
bridge.isRunning = function () { return !!worker; };
bridge.channelCount = function () { return channels.size; };
bridge.stats = function (cb) {
    if (!worker) { cb(null, null); return; }
    const ref = ++nextRef;
    pendingResults.set(ref, cb);
    post({ type: "stats", ref: ref });
};
bridge.encodePayload = encodePayload;
bridge._setWorkerFactoryForTests = function (fn) { workerFactory = fn; };
bridge._stopForTests = function () {
    channels.clear();
    handlers.clear();
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    stopWorker();
};

module.exports = bridge;
