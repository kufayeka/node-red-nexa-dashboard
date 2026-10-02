// Worker-thread entry hosting Nexa Dashboard's DEPLOYED-SCREEN HTTP server —
// deliberately NOT run on Node-RED's main thread, and deliberately its OWN
// dedicated port (not sharing RED.httpNode's Express app), so that neither
// side can starve the other: a CPU-heavy Node-RED flow won't make an open
// dashboard screen stutter, and a burst of dashboard viewers/tag updates
// (many SSE connections, many page loads) won't delay flow execution. This
// is a resource-CONTENTION fix, not a "something was slow" fix — nothing
// here was measured as blocking before the split (see the header comment on
// src/server/plugin.js's route registration this replaced).
//
// Deliberately plain `http` + hand-rolled routing, not Express — only ~6
// routes, and adding a framework dependency here wouldn't remove any actual
// bottleneck (there wasn't one) for a request pattern (HTML pages + SSE)
// that doesn't touch Express's own strengths (JSON schema serialization,
// large route tables) anyway.
//
// Protocol with the main thread (src/server/plugin.js), all via
// parentPort.postMessage/on("message"):
//   main -> worker: {type:"project", project:{screens,templates}, componentScriptSrcs, nodeRedPort}
//                   {type:"sparkplug-delta", serialized}      -- broadcast to SSE clients
//                   {type:"sparkplug-snapshot", snapshot, resync}
//                   {type:"write-result", requestId, ok}
//                   {type:"link-port", port}                 -- where Nexa Link listens (null: not running)
//                   {type:"sparkplug-port", port}            -- a MessagePort to the Sparkplug worker (null: none):
//                        snapshot + deltas come on it, and tag writes go out on it, without the main thread
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
const { IoHub } = require("../io/ioHub");
// Generated from src/model/ by build.js: a project saved before the node tree
// (flat components + layers) is migrated here, so the page only knows the tree.
const { migrateProject, resolveScreenRoute, flowScreenIds } = require("../../../dist/nexa-model.js");
const { renderScreenHtml, safeJsonForScript } = require("../screens/render-html.js");

const RUNTIME_PREFIX = "/nexa";

var project = migrateProject(workerData.project || { screens: [], templates: [] });
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
// image assets (src/server/assets.js): the page gets their names -> files, the files come from here
var assets = require("../assets.js");
var assetStore = workerData.assetsDir ? assets.createAssetStore(workerData.assetsDir) : null;
var templatesJsonCache = { forProject: null, json: null };
// Nexa Link (src/server/link/): a page asks /_link-info where the link worker
// listens and gets a token for it. No CORS header: only a page of this origin can read it.
var linkToken = require("../link/token.js");
var linkSecret = workerData.linkSecret || null;
var linkPort = workerData.linkPort || null;
var sseClients = []; // [{res, keepAlive}]
var pendingWrites = new Map(); // requestId -> {res} (HTTP POST) | {io: {client, id}} (Nexa IO explicit write)
var writeRequestSeq = 0;
// set by the plugin when the Sparkplug worker talks to us directly (see wireSparkplugSubscription)
var sparkplugPort = null;

// a tag write: to the Sparkplug worker directly when we have its port, else through the main thread
function requestWrite(requestId, w) {
    var msg = { requestId: requestId, groupId: w.groupId, edgeNodeId: w.edgeNodeId, deviceId: w.deviceId, metrics: w.metrics };
    if (sparkplugPort) sparkplugPort.postMessage(Object.assign({ type: "write" }, msg));
    else parentPort.postMessage(Object.assign({ type: "write-request" }, msg));
}

function finishWrite(requestId, ok) {
    var pending = pendingWrites.get(requestId);
    if (!pending) return;
    pendingWrites.delete(requestId);
    if (pending.io) {
        pending.io.client.transport.sendText(JSON.stringify({ t: "ack", id: pending.io.id, ok: Boolean(ok), err: ok ? undefined : "not published (Nexa Sparkplug connection not connected?)" }));
    } else {
        sendJson(pending.res, 200, { ok: ok });
    }
}

function applySparkplugDelta(serialized) {
    sseClients.forEach(function (c) { c.res.write("data: " + serialized + "\n\n"); });
    try { ioHub.applyDelta(JSON.parse(serialized)); } catch (e) { /* malformed delta: SSE clients got it verbatim, IO skips it */ }
}

// a new tree (another connection, or the worker's first snapshot): every page starts over from it
function resyncSparkplug(snapshot) {
    sparkplugSnapshot = snapshot || {};
    ioHub.absorbSnapshot(sparkplugSnapshot);
    sseClients.forEach(function (c) { c.res.write("event: resync\ndata: {}\n\n"); });
}

function setSparkplugPort(port) {
    if (sparkplugPort) { try { sparkplugPort.close(); } catch (e) { /* closed already */ } }
    sparkplugPort = port || null;
    if (!sparkplugPort) return;
    sparkplugPort.on("message", function (msg) {
        if (!msg) return;
        if (msg.type === "delta") applySparkplugDelta(msg.serialized);
        else if (msg.type === "snapshot") resyncSparkplug(msg.snapshot);
        else if (msg.type === "write-result") finishWrite(msg.requestId, msg.ok);
    });
}

// Nexa IO (src/shared/io/frame.js): one WebSocket per deployed page at
// RUNTIME_PREFIX + "/_io" — cyclic "implicit" binary frames out, "explicit"
// writes in. The SSE stream + POST write routes below stay as the fallback.
var ioHub = new IoHub({
    // a page needs tags the tree has no value for: its Edge Node may have been
    // born before the connection was (a BIRTH is not retained) -> ask it to rebirth
    onMissing: function (keys) {
        var edges = {};
        keys.forEach(function (k) {
            var p = String(k).split("::");
            if (p.length >= 4 && p[0] && p[1]) edges[p[0] + "::" + p[1]] = [p[0], p[1]];
        });
        var list = Object.keys(edges).map(function (e) { return edges[e]; });
        if (list.length) parentPort.postMessage({ type: "need-rebirth", edges: list });
    },
    onWrite: function (client, msg) {
        var metrics = Array.isArray(msg.m) ? msg.m : [];
        if (!msg.g || !msg.e || !metrics.length) {
            client.transport.sendText(JSON.stringify({ t: "ack", id: msg.id, ok: false, err: "g, e and at least one metric are required" }));
            return;
        }
        var requestId = "w" + (++writeRequestSeq);
        pendingWrites.set(requestId, { io: { client: client, id: msg.id } });
        requestWrite(requestId, {
            groupId: String(msg.g), edgeNodeId: String(msg.e), deviceId: msg.d ? String(msg.d) : null,
            metrics: metrics.map(function (m) { return { name: String(m.n), value: m.v }; })
        });
    }
});
function syncSharedVarsFromProject(p) {
    if (!p || !Array.isArray(p.sharedVariables)) return;
    p.sharedVariables.forEach(function (v) {
        if (v && v.name && !ioHub.cache.has("@shared::" + v.name)) {
            ioHub.setSharedVar(v.name, v.defaultValue, v.type);
        }
    });
}
ioHub.absorbSnapshot(sparkplugSnapshot);
syncSharedVarsFromProject(project);

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

// project.templates as a script literal, once per deployed project (every page embeds it)
function getCachedTemplatesJson() {
    if (templatesJsonCache.forProject !== project) {
        templatesJsonCache.forProject = project;
        templatesJsonCache.json = safeJsonForScript(project.templates || []);
    }
    return templatesJsonCache.json;
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
        requestWrite(requestId, {
            groupId: String(body.groupId), edgeNodeId: String(body.edgeNodeId), deviceId: body.deviceId ? String(body.deviceId) : null,
            metrics: metrics.map(function (m) { return { name: String(m.name), value: m.value }; })
        });
    });
}

// GET /nexa/<flow>[/<screen>]: resolve the route (src/model/routes.js), then render the page
function handleScreenRequest(req, res, subPath, url) {
    var route = resolveScreenRoute(project, subPath, { prefix: RUNTIME_PREFIX, search: url.search });
    (route.warnings || []).forEach(function (w) { console.warn("[screen-worker] " + w); });
    if (route.kind === "redirect") { res.writeHead(302, { "Location": route.location }); res.end(); return; }
    if (route.kind !== "screen") { sendText(res, 404, route.text); return; }
    var allowed = route.flow ? flowScreenIds(route.flow, project.screens) : null;
    var rawIp = req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "";
    var html = renderScreenHtml({
        project: project,
        screen: route.screen,
        flow: route.flow,
        flowScreens: (project.screens || []).filter(function (s) { return !allowed || allowed.indexOf(s.id) !== -1; }),
        params: route.params,
        query: Object.fromEntries(url.searchParams),
        hostname: (req.headers.host || "localhost").split(":")[0],
        clientIp: String(rawIp).split(",")[0].trim(),
        prefix: RUNTIME_PREFIX,
        componentScriptSrcs: componentScriptSrcs,
        nodeRedPort: nodeRedPort,
        templatesJson: getCachedTemplatesJson(),
        assets: assetStore ? assetStore.list() : []
    });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
    res.end(html);
}

var server = http.createServer(function (req, res) {
    var url = new URL(req.url, "http://localhost");
    var pathname = url.pathname;

    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_registry.js") {
        sendFile(res, path.join(__dirname, "..", "..", "..", "dist", "nexa-registry-client.js"), "application/javascript"); return;
    }
    // the node tree model (frames / auto layout CSS), window.NexaModel — see build.js
    if (req.method === "GET" && pathname.indexOf(RUNTIME_PREFIX + "/_assets/") === 0) {
        var assetFile = pathname.slice((RUNTIME_PREFIX + "/_assets/").length);
        var assetPath = assetStore && assetStore.filePath(assetFile);
        if (!assetPath || !fs.existsSync(assetPath)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, assets.assetHeaders(assetFile));
        fs.createReadStream(assetPath).pipe(res);
        return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_model.js") {
        sendFile(res, path.join(__dirname, "..", "..", "..", "dist", "nexa-model-client.js"), "application/javascript"); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_runtime.js") {
        sendFile(res, path.join(__dirname, "..", "..", "..", "dist", "nexa-runtime.bundle.js"), "application/javascript"); return;
    }
    // Lit + the component SDK (see build.js); "_lit-vendor.js" = its pre-SDK name.
    if (req.method === "GET" && (pathname === RUNTIME_PREFIX + "/_sdk.js" || pathname === RUNTIME_PREFIX + "/_lit-vendor.js")) {
        sendFile(res, path.join(__dirname, "..", "..", "..", "dist", "nexa-sdk.bundle.js"), "application/javascript"); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_sparkplug-snapshot") {
        sendJson(res, 200, sparkplugSnapshot); return;
    }
    // Deliberately UNAUTHENTICATED for now — same tradeoff/flag as the route
    // this replaced in src/server/plugin.js; see that file's own comment.
    if (req.method === "POST" && pathname === RUNTIME_PREFIX + "/_sparkplug-write") {
        handleSparkplugWrite(req, res); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_link-info") {
        var info = linkPort && linkSecret ? { port: linkPort, token: linkToken.issueToken(linkSecret) } : { port: null };
        var infoBody = JSON.stringify(info);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(infoBody) });
        res.end(infoBody);
        return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_screens") {
        sendJson(res, 200, project.screens || []); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_sparkplug-stream") {
        handleSparkplugStream(req, res); return;
    }
    if (req.method === "GET" && (pathname === "/" || pathname === RUNTIME_PREFIX || pathname === RUNTIME_PREFIX + "/")) {
        handleScreenRequest(req, res, "/", url); return;
    }
    if (req.method === "GET" && pathname.indexOf(RUNTIME_PREFIX + "/") === 0) {
        handleScreenRequest(req, res, pathname.slice(RUNTIME_PREFIX.length), url); return;
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
        project = migrateProject(msg.project || { screens: [], templates: [] });
        syncSharedVarsFromProject(project);
        componentScriptSrcs = msg.componentScriptSrcs || [];
        if (msg.nodeRedPort) nodeRedPort = msg.nodeRedPort;
        return;
    }
    if (msg.type === "link-port") {
        linkPort = msg.port || null;
        return;
    }
    if (msg.type === "sparkplug-port") { setSparkplugPort(msg.port); return; }
    if (msg.type === "sparkplug-delta") { applySparkplugDelta(msg.serialized); return; }
    if (msg.type === "sparkplug-snapshot") {
        // resync = a new connection node with a different tree; otherwise it only keeps the GET snapshot fresh
        if (msg.resync) resyncSparkplug(msg.snapshot);
        else sparkplugSnapshot = msg.snapshot || {};
        return;
    }
    if (msg.type === "write-result") { finishWrite(msg.requestId, msg.ok); return; }
    if (msg.type === "close") {
        sseClients.forEach(function (c) { c.res.end(); });
        ioHub.close();
        wss.clients.forEach(function (ws) { ws.terminate(); });
        server.close(function () { parentPort.postMessage({ type: "closed" }); });
    }
});
