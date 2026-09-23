// Worker-thread entry hosting Nexa Dashboard's DEPLOYED-SCREEN HTTP server —
// deliberately NOT run on Node-RED's main thread, and deliberately its OWN
// dedicated port (not sharing RED.httpNode's Express app), so that neither
// side can starve the other: a CPU-heavy Node-RED flow won't make an open
// dashboard screen stutter, and a burst of dashboard viewers/tag updates
// (many SSE connections, many page loads) won't delay flow execution. This
// is a resource-CONTENTION fix, not a "something was slow" fix — nothing
// here was measured as blocking before the split (see the header comment on
// lib/nexa-plugin.js's route registration this replaced).
//
// Deliberately plain `http` + hand-rolled routing, not Express — only ~6
// routes, and adding a framework dependency here wouldn't remove any actual
// bottleneck (there wasn't one) for a request pattern (HTML pages + SSE)
// that doesn't touch Express's own strengths (JSON schema serialization,
// large route tables) anyway.
//
// Protocol with the main thread (lib/nexa-plugin.js), all via
// parentPort.postMessage/on("message"):
//   main -> worker: {type:"project", project:{screens,templates}, componentScriptSrcs, nodeRedPort}
//                   {type:"sparkplug-delta", serialized}      -- broadcast to SSE clients
//                   {type:"sparkplug-snapshot", snapshot, resync}
//                   {type:"write-result", requestId, ok}
//   worker -> main: {type:"listening", port}
//                   {type:"write-request", requestId, groupId, edgeNodeId, deviceId, metrics}
//
// Initial state (project/componentScriptSrcs/nodeRedPort/snapshot/port)
// arrives via `workerData` at construction — the messages above are for
// updates after that.
const { parentPort, workerData } = require("worker_threads");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const { IoHub } = require("./io/ioHub");

const RUNTIME_PREFIX = "/nexa";

var project = workerData.project || { screens: [], templates: [] };
var componentScriptSrcs = workerData.componentScriptSrcs || [];
// Third-party "nexa-ui-component-package" plugins (e.g.
// @kufayeka/nexa-component-basic-shapes) still serve their own
// runtimeScripts from Node-RED's real httpNode/httpAdmin server, not this
// worker's dedicated port — a root-relative <script src> for those would
// resolve against THIS server (which has no such route) and 404 silently,
// which is exactly what produced the reported "(unknown component: ...)"
// text: the script never loaded, so it never called
// window.NEXA.registerComponent(). renderScreenHtml() rewrites any
// componentScriptSrcs entry into an absolute URL pointing back at Node-RED's
// real port instead, using whatever hostname the browser already used to
// reach THIS worker (from the request's own Host header) — see
// handleScreenRequest.
var nodeRedPort = workerData.nodeRedPort || 1880;
var sparkplugSnapshot = workerData.sparkplugSnapshot || {};
var templatesJsonCache = { forProject: null, json: null };
var sseClients = []; // [{res, keepAlive}]
var pendingWrites = new Map(); // requestId -> {res} (HTTP POST) | {io: {client, id}} (Nexa IO explicit write)
var writeRequestSeq = 0;

// Nexa IO (lib/io/ioProtocol.js): one WebSocket per deployed page at
// RUNTIME_PREFIX + "/_io" — cyclic "implicit" binary frames out, "explicit"
// writes in. The SSE stream + POST write routes below stay as the fallback.
var ioHub = new IoHub({
    onWrite: function (client, msg) {
        var metrics = Array.isArray(msg.m) ? msg.m : [];
        if (!msg.g || !msg.e || !metrics.length) {
            client.transport.sendText(JSON.stringify({ t: "ack", id: msg.id, ok: false, err: "g, e and at least one metric are required" }));
            return;
        }
        var requestId = "w" + (++writeRequestSeq);
        pendingWrites.set(requestId, { io: { client: client, id: msg.id } });
        parentPort.postMessage({
            type: "write-request", requestId: requestId,
            groupId: String(msg.g), edgeNodeId: String(msg.e),
            deviceId: msg.d ? String(msg.d) : null,
            metrics: metrics.map(function (m) { return { name: String(m.n), value: m.v }; })
        });
    }
});
ioHub.absorbSnapshot(sparkplugSnapshot);

var IO_PATH = RUNTIME_PREFIX + "/_io";
var IO_PING_MS = 15000;
var wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
wss.on("connection", function (ws) {
    var client = ioHub.addClient({
        sendText: function (s) { if (ws.readyState === 1) ws.send(s); },
        sendBinary: function (b) { if (ws.readyState === 1) ws.send(b, { binary: true }); },
        bufferedAmount: function () { return ws.bufferedAmount; }
    });
    // Dead-peer detection for half-open TCP (a tablet that walked out of WiFi
    // range never sends a FIN): no pong within one ping interval -> drop it.
    var alive = true;
    ws.on("pong", function () { alive = true; });
    var pinger = setInterval(function () {
        if (!alive) { ws.terminate(); return; }
        alive = false;
        try { ws.ping(); } catch (e) { /* closing */ }
    }, IO_PING_MS);
    ws.on("message", function (data, isBinary) {
        if (isBinary) return;
        var msg;
        try { msg = JSON.parse(data.toString("utf8")); } catch (e) { return; }
        ioHub.handleText(client, msg);
    });
    ws.on("close", function () {
        clearInterval(pinger);
        ioHub.removeClient(client);
    });
    ws.on("error", function () { /* "close" follows */ });
});

// --- Copied verbatim from lib/nexa-plugin.js (the code this worker took
// over) — see that file's own comments for why each of these looks the way
// it does; not reproduced here to keep this file scannable.
function matchScreenPath(pattern, actualPath) {
    var patternParts = pattern.split("/").filter(Boolean);
    var actualParts = actualPath.split("/").filter(Boolean);
    if (patternParts.length !== actualParts.length) return null;
    var params = {};
    for (var i = 0; i < patternParts.length; i++) {
        if (patternParts[i].charAt(0) === ":") {
            params[patternParts[i].slice(1)] = decodeURIComponent(actualParts[i]);
        } else if (patternParts[i] !== actualParts[i]) {
            return null;
        }
    }
    return params;
}
function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}
function safeJsonForScript(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}
function getCachedTemplatesJson() {
    if (templatesJsonCache.forProject !== project) {
        templatesJsonCache.forProject = project;
        templatesJsonCache.json = safeJsonForScript(project.templates || []);
    }
    return templatesJsonCache.json;
}
function renderScreenHtml(screen, params, query, requestHostname) {
    var componentScripts = componentScriptSrcs.map(function (src) {
        // Root-relative ("/foo/bar.js") -> rewrite to Node-RED's real port,
        // same hostname the browser used to reach this worker. Anything
        // already absolute (an http(s):// URL a package chose to declare
        // itself) is left untouched.
        var resolvedSrc = src.charAt(0) === "/" ? "http://" + requestHostname + ":" + nodeRedPort + src : src;
        return '<script src="' + escapeHtml(resolvedSrc) + '"></script>';
    });
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
        "<title>" + escapeHtml(screen.name) + "</title>" +
        "<style>html,body{margin:0;padding:0;background:#ccc;}" +
        "#nexa-runtime-artboard{position:relative;background:#fff;margin:20px auto;" +
        "box-shadow:0 4px 12px rgba(0,0,0,0.2);}</style>" +
        "</head><body>" +
        '<div id="nexa-runtime-artboard" style="width:' + screen.width + "px;height:" + screen.height + 'px;"></div>' +
        '<script src="' + RUNTIME_PREFIX + '/_registry.js"></script>' +
        '<script src="' + RUNTIME_PREFIX + '/_lit-vendor.js"></script>' +
        componentScripts.join("") +
        "<script>window.__NEXA_SCREEN__ = " + safeJsonForScript(screen) + ";" +
        "window.__NEXA_TEMPLATES__ = " + getCachedTemplatesJson() + ";" +
        "window.__NEXA_PARAMS__ = " + safeJsonForScript(params) + ";" +
        "window.__NEXA_QUERY__ = " + safeJsonForScript(query) + ";" +
        "window.__NEXA_RUNTIME_PREFIX__ = " + safeJsonForScript(RUNTIME_PREFIX) + ";</script>" +
        '<script src="' + RUNTIME_PREFIX + '/_runtime.js"></script>' +
        "</body></html>";
}

function sendJson(res, status, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
}
function sendFile(res, filePath, contentType) {
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
}
function sendText(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain" });
    res.end(text);
}
function readJsonBody(req, cb) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("error", function () { cb(new Error("Request body read error.")); });
    req.on("end", function () {
        try {
            cb(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch (e) {
            cb(e);
        }
    });
}

function handleSparkplugStream(req, res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    });
    res.write(": connected\n\n");
    var client = { res: res };
    sseClients.push(client);
    var keepAlive = setInterval(function () { res.write(": ping\n\n"); }, 25000);
    req.on("close", function () {
        clearInterval(keepAlive);
        var idx = sseClients.indexOf(client);
        if (idx !== -1) sseClients.splice(idx, 1);
    });
}

function handleSparkplugWrite(req, res) {
    readJsonBody(req, function (err, body) {
        if (err) { sendJson(res, 400, { error: "Invalid JSON body." }); return; }
        var metrics = Array.isArray(body.metrics) ? body.metrics : [];
        if (!body.groupId || !body.edgeNodeId || !metrics.length) {
            sendJson(res, 400, { error: "groupId, edgeNodeId, and at least one metric are required." });
            return;
        }
        var requestId = "w" + (++writeRequestSeq);
        pendingWrites.set(requestId, { res: res });
        parentPort.postMessage({
            type: "write-request", requestId: requestId,
            groupId: String(body.groupId), edgeNodeId: String(body.edgeNodeId),
            deviceId: body.deviceId ? String(body.deviceId) : null,
            metrics: metrics.map(function (m) { return { name: String(m.name), value: m.value }; })
        });
    });
}

function handleScreenRequest(req, res, subPath, query) {
    var matchedScreen = null, matchedParams = null;
    for (var i = 0; i < (project.screens || []).length; i++) {
        var screen = project.screens[i];
        var m = matchScreenPath(screen.path, subPath);
        if (m) { matchedScreen = screen; matchedParams = m; break; }
    }
    if (!matchedScreen) { sendText(res, 404, "No Nexa screen found for path: " + subPath); return; }
    if (matchedScreen.disabled) { sendText(res, 404, "Nexa screen is disabled: " + subPath); return; }
    // Host header is "hostname:port" (or just "hostname") — strip whatever
    // port the browser used to reach THIS worker; component scripts need
    // Node-RED's own port instead (see renderScreenHtml).
    var hostHeader = req.headers.host || "localhost";
    var requestHostname = hostHeader.split(":")[0];
    var html = renderScreenHtml(matchedScreen, matchedParams, query, requestHostname);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
    res.end(html);
}

var server = http.createServer(function (req, res) {
    var url = new URL(req.url, "http://localhost");
    var pathname = url.pathname;

    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_registry.js") {
        sendFile(res, path.join(__dirname, "nexa-registry-client.js"), "application/javascript"); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_runtime.js") {
        sendFile(res, path.join(__dirname, "nexa-runtime-client.js"), "application/javascript"); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_lit-vendor.js") {
        sendFile(res, path.join(__dirname, "..", "dist", "nexa-lit-vendor.bundle.js"), "application/javascript"); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_sparkplug-snapshot") {
        sendJson(res, 200, sparkplugSnapshot); return;
    }
    // Deliberately UNAUTHENTICATED for now — same tradeoff/flag as the route
    // this replaced in lib/nexa-plugin.js; see that file's own comment.
    if (req.method === "POST" && pathname === RUNTIME_PREFIX + "/_sparkplug-write") {
        handleSparkplugWrite(req, res); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_sparkplug-stream") {
        handleSparkplugStream(req, res); return;
    }
    if (req.method === "GET" && pathname.indexOf(RUNTIME_PREFIX + "/") === 0) {
        handleScreenRequest(req, res, pathname.slice(RUNTIME_PREFIX.length), Object.fromEntries(url.searchParams)); return;
    }
    sendText(res, 404, "Not found.");
});

server.on("upgrade", function (req, socket, head) {
    var pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname !== IO_PATH) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, function (ws) { wss.emit("connection", ws, req); });
});

server.listen(workerData.port, function () {
    // Report the ACTUALLY bound port, not just workerData.port echoed back
    // — if workerData.port is 0 (used by tests), the OS assigns a free one.
    parentPort.postMessage({ type: "listening", port: server.address().port });
});

parentPort.on("message", function (msg) {
    if (!msg) return;
    if (msg.type === "project") {
        project = msg.project || { screens: [], templates: [] };
        componentScriptSrcs = msg.componentScriptSrcs || [];
        if (msg.nodeRedPort) nodeRedPort = msg.nodeRedPort;
        return;
    }
    if (msg.type === "sparkplug-delta") {
        sseClients.forEach(function (c) { c.res.write("data: " + msg.serialized + "\n\n"); });
        try { ioHub.applyDelta(JSON.parse(msg.serialized)); } catch (e) { /* malformed delta: SSE clients got it verbatim, IO skips it */ }
        return;
    }
    if (msg.type === "sparkplug-snapshot") {
        sparkplugSnapshot = msg.snapshot || {};
        // The periodic (non-resync) refresh only keeps the GET snapshot fresh; the IO
        // cache is already current from every delta. A resync = new connection node
        // with a different tree -> rebuild, and every IO client gets a full frame.
        if (msg.resync) ioHub.absorbSnapshot(sparkplugSnapshot);
        if (msg.resync) {
            sseClients.forEach(function (c) { c.res.write("event: resync\ndata: {}\n\n"); });
        }
        return;
    }
    if (msg.type === "write-result") {
        var pending = pendingWrites.get(msg.requestId);
        if (pending) {
            pendingWrites.delete(msg.requestId);
            if (pending.io) {
                pending.io.client.transport.sendText(JSON.stringify({ t: "ack", id: pending.io.id, ok: Boolean(msg.ok), err: msg.ok ? undefined : "not published (Nexa Sparkplug connection not connected?)" }));
            } else {
                sendJson(pending.res, 200, { ok: msg.ok });
            }
        }
        return;
    }
    if (msg.type === "close") {
        sseClients.forEach(function (c) { c.res.end(); });
        ioHub.close();
        wss.clients.forEach(function (ws) { ws.terminate(); });
        server.close(function () { parentPort.postMessage({ type: "closed" }); });
    }
});
