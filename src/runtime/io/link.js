// Nexa Link client: the page side of the Request / To Node-RED / From Node-RED
// Logic nodes. Its own WebSocket to the link worker's own port (never /_io, the
// tags), opened only when a screen uses a link. Wire format: src/shared/link/frame.js.
//
// Connect: GET <prefix>/_link-info -> {port, token}, then ws://<host>:<port>/nexa/_link?t=<token>.
// A payload is JSON, or binary (an ArrayBuffer / typed array -> the flow gets a Buffer,
// a Buffer from the flow -> msg.payload is an ArrayBuffer). Compressed answers
// (channel compression "auto") are inflated by the browser itself (DecompressionStream).

import * as F from "../../shared/link/frame.js";

const SAFETY_MS = 2000;          // on top of the channel timeout: the server answers a timeout itself
const DEFAULT_TIMEOUT_MS = 10000;

const link = {
    ws: null,
    ready: null,          // Promise, resolved on "welcome"
    channels: {},         // id -> {name, timeout, maxBytes}
    pending: new Map(),   // request msgId -> {resolve, reject, timer}
    subs: [],             // channel ids this page listens to
    nextId: 0,
    reassembler: null,
    rxChain: Promise.resolve(),
    onPush: null,         // fn(channelId, payload, meta)
    backoff: 1000,
    reconnectTimer: null
};

function canInflate() {
    try { return typeof DecompressionStream === "function" && !!new DecompressionStream("deflate-raw"); } catch (e) { return false; }
}

function prefix() { return window.__NEXA_RUNTIME_PREFIX__ || "/nexa"; }

function getInfo() {
    return fetch(prefix() + "/_link-info", { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("Nexa Link info: HTTP " + r.status);
        return r.json();
    });
}

function rejectAll(reason) {
    link.pending.forEach(function (p) { clearTimeout(p.timer); p.reject(new Error(reason)); });
    link.pending.clear();
}

function scheduleReconnect() {
    if (link.reconnectTimer || !link.subs.length) return;
    link.reconnectTimer = setTimeout(function () {
        link.reconnectTimer = null;
        linkConnect().catch(function () { scheduleReconnect(); });
    }, link.backoff);
    link.backoff = Math.min(link.backoff * 2, 15000);
}

/** Opens the link (once); resolves when the worker has welcomed this page. */
export function linkConnect() {
    if (link.ready) return link.ready;
    link.ready = getInfo().then(function (info) {
        if (!info || !info.port) throw new Error("Nexa Link is not running: deploy a flow with a Nexa channel (from Nexa / to Nexa node)");
        return new Promise(function (resolve, reject) {
            const loc = window.location || {};
            const url = (loc.protocol === "https:" ? "wss:" : "ws:") + "//" + (loc.hostname || "localhost") + ":" + info.port +
                "/nexa/_link?t=" + encodeURIComponent(info.token) + (canInflate() ? "&z=1" : "");
            const ws = new window.WebSocket(url);
            ws.binaryType = "arraybuffer";
            link.ws = ws;
            link.reassembler = new F.Reassembler(function () { return 1 << 30; }, { maxPendingBytes: 1 << 30 });
            let welcomed = false;
            ws.onmessage = function (evt) {
                if (typeof evt.data === "string") {
                    let msg;
                    try { msg = JSON.parse(evt.data); } catch (e) { return; }
                    if (msg.t === "welcome" || msg.t === "channels") link.channels = msg.channels || {};
                    if (msg.t === "welcome" && !welcomed) {
                        welcomed = true;
                        link.backoff = 1000;
                        if (link.subs.length) ws.send(JSON.stringify({ t: "sub", ch: link.subs }));
                        resolve(ws);
                    } else if (msg.t === "error") {
                        console.warn("[nexa-link] the server refused message " + msg.re + ": " + msg.err);
                    } else if (msg.t === "gap") {
                        console.warn("[nexa-link] channel " + msg.ch + ": messages dropped (this page could not keep up)");
                    }
                    return;
                }
                let got;
                try { got = link.reassembler.push(new Uint8Array(evt.data)); } catch (e) { return; }
                if (got && !got.error) receive(got);
            };
            ws.onclose = function () {
                if (link.ws !== ws) return;
                link.ws = null;
                link.ready = null;
                rejectAll("Nexa Link connection lost");
                if (!welcomed) reject(new Error("Nexa Link: could not connect to port " + info.port));
                scheduleReconnect();
            };
            ws.onerror = function () { /* onclose follows */ };
        });
    });
    link.ready.catch(function () { link.ready = null; });
    return link.ready;
}

function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
}

function payloadOf(flags, bytes) {
    if (flags & F.F_BINARY) return bytes.buffer.byteLength === bytes.length && bytes.byteOffset === 0 ? bytes.buffer : bytes.slice().buffer;
    if (!bytes.length) return null;
    return JSON.parse(F.fromUtf8(bytes));
}

// In arrival order, even while one of them is being inflated.
function receive(got) {
    link.rxChain = link.rxChain.then(function () {
        return (got.flags & F.F_DEFLATE) ? inflate(got.bytes) : got.bytes;
    }).then(function (bytes) {
        const meta = got.meta || {};
        if (meta.t === "res") {
            const p = link.pending.get(meta.re);
            if (!p) return;
            link.pending.delete(meta.re);
            clearTimeout(p.timer);
            if (meta.err) p.reject(new Error(meta.err));
            else {
                let value;
                try { value = payloadOf(got.flags, bytes); } catch (e) { p.reject(new Error("invalid JSON in the answer")); return; }
                p.resolve(value);
            }
        } else if (meta.t === "push" && typeof link.onPush === "function") {
            let value;
            try { value = payloadOf(got.flags, bytes); } catch (e) { console.warn("[nexa-link] invalid JSON pushed on " + meta.ch); return; }
            link.onPush(meta.ch, value, meta);
        }
    }).catch(function (e) { console.error("[nexa-link] could not read a message:", e); });
}

function encode(payload) {
    if (payload instanceof ArrayBuffer) return { bytes: new Uint8Array(payload), flags: F.F_BINARY };
    if (ArrayBuffer.isView(payload)) return { bytes: new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), flags: F.F_BINARY };
    return { bytes: F.utf8(JSON.stringify(payload === undefined ? null : payload)), flags: 0 };
}

function sendMessage(ws, meta, payload) {
    const id = ++link.nextId;
    const enc = encode(payload);
    const ch = link.channels[meta.ch];
    if (ch && enc.bytes.length > ch.maxBytes) throw new Error("payload is " + enc.bytes.length + " bytes, channel \"" + ch.name + "\" allows " + ch.maxBytes);
    F.encodeMessage(id, meta, enc.bytes, enc.flags).forEach(function (fr) { ws.send(fr); });
    return id;
}

/** Request node: resolves with the flow's answer, rejects on an error answer / timeout / lost link. */
export function linkRequest(channelId, payload, screenId) {
    return linkConnect().then(function (ws) {
        return new Promise(function (resolve, reject) {
            if (!link.channels[channelId]) { reject(new Error("channel " + channelId + " is not deployed")); return; }
            const id = sendMessage(ws, { t: "req", ch: channelId, screen: screenId || "" }, payload);
            const timeout = (link.channels[channelId].timeout || DEFAULT_TIMEOUT_MS) + SAFETY_MS;
            const timer = setTimeout(function () {
                if (link.pending.delete(id)) reject(new Error("timeout: no answer within " + timeout + " ms"));
            }, timeout);
            link.pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        });
    });
}

/** To Node-RED node: fire and forget (resolves once it is on the wire). */
export function linkSend(channelId, payload, screenId) {
    return linkConnect().then(function (ws) {
        if (!link.channels[channelId]) throw new Error("channel " + channelId + " is not deployed");
        sendMessage(ws, { t: "send", ch: channelId, screen: screenId || "" }, payload);
    });
}

/** From Node-RED nodes: the channels the open screen listens to (the whole list, replaces the previous one). */
export function linkSetSubscriptions(channelIds, onPush) {
    const list = Array.from(new Set((channelIds || []).filter(Boolean))).sort();
    if (onPush) link.onPush = onPush;
    const same = list.join("\n") === link.subs.join("\n");
    link.subs = list;
    if (same) return;
    if (link.ws && link.ws.readyState === 1) link.ws.send(JSON.stringify({ t: "sub", ch: list }));
    else if (list.length) linkConnect().catch(function (e) { console.warn("[nexa-link] " + e.message); scheduleReconnect(); });
}

export function _linkStateForTests() { return link; }
