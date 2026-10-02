// Worker-thread entry for Nexa Link: the page <-> Node-RED flow messages
// ("from Nexa" / "to Nexa" nodes), on its OWN port and its OWN thread — never
// the screen worker's, so big payloads and their compression can't touch the
// tag channel (/_io). Wire format: src/shared/link/frame.js; state and pacing:
// src/server/link/hub.js; main-thread half: src/server/link/bridge.js.
//
// Protocol with the main thread (parentPort):
//   main -> worker: {type:"channel", ch:{id,name,maxBytes,timeout,delivery,retain,compress}}
//                   {type:"channel-remove", id}
//                   {type:"to-nexa", target, ch, rid?, client?, error?, binary, bytes:ArrayBuffer (transferred)}
//                   {type:"close"}
//   worker -> main: {type:"listening", port} / {type:"listen-error", error}
//                   {type:"from-nexa", kind, ch, rid?, client, screen, ip, binary, bytes:ArrayBuffer (transferred)}
//                   {type:"to-nexa-result", ref, ok, error?, delivered} (when the to-nexa had a ref)
//                   {type:"closed"}
"use strict";
const { parentPort, workerData } = require("worker_threads");
const http = require("http");
const zlib = require("zlib");
const { WebSocketServer } = require("ws");
const { LinkHub } = require("../link/hub.js");
const { verifyToken } = require("../link/token.js");
const { CHUNK_BYTES, HEADER_BYTES, MAX_META_BYTES } = require("../../shared/link/frame.js");

const LINK_PATH = "/nexa/_link";
const PING_MS = 15000;
const secret = workerData.secret;

const hub = new LinkHub({
    onFromNexa: function (m) {
        const bytes = m.bytes;
        parentPort.postMessage({
            type: "from-nexa", kind: m.kind, ch: m.ch, rid: m.rid, client: m.client,
            screen: m.screen, ip: m.ip, binary: m.binary, bytes: bytes.buffer
        }, [bytes.buffer]);
    },
    // libuv's thread pool, not this thread; level 1: JSON still shrinks 5-8x, at a fraction of the time of level 6
    compress: function (u8) {
        return new Promise(function (resolve, reject) {
            zlib.deflateRaw(u8, { level: 1 }, function (err, out) {
                if (err) reject(err); else resolve(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
            });
        });
    }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: CHUNK_BYTES + HEADER_BYTES + MAX_META_BYTES, perMessageDeflate: false });
wss.on("connection", function (ws, req, info) {
    const client = hub.addClient({
        sendText: function (s) { if (ws.readyState === 1) ws.send(s); },
        sendBinary: function (u8, cb) {
            if (ws.readyState !== 1) return;
            ws.send(u8, { binary: true }, function () { cb(); });
        },
        bufferedAmount: function () { return ws.bufferedAmount; }
    }, info);
    let alive = true;
    ws.on("pong", function () { alive = true; });
    const pinger = setInterval(function () {
        if (!alive) { ws.terminate(); return; }
        alive = false;
        try { ws.ping(); } catch (e) { /* closing */ }
    }, PING_MS);
    ws.on("message", function (data, isBinary) {
        if (isBinary) {
            hub.handleBinary(client, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            return;
        }
        let msg;
        try { msg = JSON.parse(data.toString("utf8")); } catch (e) { return; }
        hub.handleText(client, msg);
    });
    ws.on("close", function () { clearInterval(pinger); hub.removeClient(client); });
    ws.on("error", function () { /* "close" follows */ });
});

const server = http.createServer(function (req, res) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Nexa Link: WebSocket only.");
});

server.on("upgrade", function (req, socket, head) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== LINK_PATH || !verifyToken(secret, url.searchParams.get("t"))) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
    }
    // a browser always sends Origin: it must be a page of this same host (another site's page can't connect)
    const origin = req.headers.origin;
    if (origin) {
        let originHost = "";
        try { originHost = new URL(origin).hostname; } catch (e) { /* bad origin */ }
        const host = String(req.headers.host || "").replace(/:\d+$/, "");
        if (originHost !== host) {
            socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
    }
    const ip = String(req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "").split(",")[0].trim();
    const info = { ip: ip, deflate: url.searchParams.get("z") === "1" };
    wss.handleUpgrade(req, socket, head, function (ws) { wss.emit("connection", ws, req, info); });
});

server.on("error", function (err) {
    parentPort.postMessage({ type: "listen-error", error: err && err.message, code: err && err.code });
});

server.listen(workerData.port, workerData.host, function () {
    parentPort.postMessage({ type: "listening", port: server.address().port });
});

parentPort.on("message", function (msg) {
    if (!msg) return;
    if (msg.type === "channel") { hub.setChannel(msg.ch); return; }
    if (msg.type === "channel-remove") { hub.removeChannel(msg.id); return; }
    if (msg.type === "to-nexa") {
        const r = hub.toNexa({
            target: msg.target, ch: msg.ch, rid: msg.rid, client: msg.client, error: msg.error,
            binary: !!msg.binary, bytes: msg.bytes ? new Uint8Array(msg.bytes) : null
        });
        if (msg.ref) parentPort.postMessage({ type: "to-nexa-result", ref: msg.ref, ok: r.ok, error: r.ok ? null : r.error, delivered: r.delivered });
        return;
    }
    if (msg.type === "stats") {
        parentPort.postMessage({ type: "stats", ref: msg.ref, stats: Object.assign({ clients: hub.clients.size, pending: hub.pending.size }, hub.stats) });
        return;
    }
    if (msg.type === "close") {
        hub.close();
        wss.clients.forEach(function (ws) { ws.terminate(); });
        server.close(function () { parentPort.postMessage({ type: "closed" }); });
    }
});
