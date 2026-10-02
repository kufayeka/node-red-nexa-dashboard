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
const { IoHub } = require("../io/ioHub");
// Generated from src/model/ by build.js: a project saved before the node tree
// (flat components + layers) is migrated here, so the page only knows the tree.
const { migrateProject } = require("../../../dist/nexa-model.js");

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
var sseClients = []; // [{res, keepAlive}]
var pendingWrites = new Map(); // requestId -> {res} (HTTP POST) | {io: {client, id}} (Nexa IO explicit write)
var writeRequestSeq = 0;

// Nexa IO (lib/io/ioProtocol.js): one WebSocket per deployed page at
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
        parentPort.postMessage({
            type: "write-request", requestId: requestId,
            groupId: String(msg.g), edgeNodeId: String(msg.e),
            deviceId: msg.d ? String(msg.d) : null,
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
function getFlowAllowedScreenIds(flow, allScreens) {
    if (!flow || !flow.logic || !Array.isArray(flow.logic.nodes)) return [];
    var screens = allScreens || (project && project.screens) || [];
    var ids = [];

    function addId(id) {
        if (!id) return;
        var sid = String(id).trim();
        if (sid && ids.indexOf(sid) === -1) {
            ids.push(sid);
            // Recursively discover screens reachable via Goto Screen within this screen's logic
            var scr = screens.find(function (s) { return s.id === sid; });
            if (scr && scr.logic && Array.isArray(scr.logic.nodes)) {
                scr.logic.nodes.forEach(function (sn) {
                    if (sn && sn.type === "navigate" && sn.screenId) {
                        addId(sn.screenId);
                    }
                });
            }
        }
    }

    flow.logic.nodes.forEach(function (n) {
        if (!n) return;
        if ((n.type === "render-screen" || n.type === "navigate") && n.screenId) {
            addId(n.screenId);
        }
    });

    return ids;
}

function renderScreenHtml(screen, flow, params, query, requestHostname, clientIp) {
    var allowedIds = flow ? getFlowAllowedScreenIds(flow, project.screens) : [];
    var flowScreens = flow ? (project.screens || []).filter(function (s) {
        return allowedIds.indexOf(s.id) !== -1;
    }) : (project.screens || []);

    var componentScripts = componentScriptSrcs.map(function (entry) {
        // An entry is a src string (classic script) or { src, module: true }
        // (an SDK plugin: an ES module importing nexa-component-sdk.js).
        var src = typeof entry === "string" ? entry : (entry && entry.src) || "";
        var isModule = !!(entry && typeof entry === "object" && entry.module);
        // Root-relative ("/foo/bar.js") -> rewrite to Node-RED's real port,
        // same hostname the browser used to reach this worker. Anything
        // already absolute (an http(s):// URL a package chose to declare
        // itself) is left untouched. (Cross-origin modules need CORS: the
        // SDK's package helper serves plugin files with it.)
        var resolvedSrc = src.charAt(0) === "/" ? "http://" + requestHostname + ":" + nodeRedPort + src : src;
        return '<script ' + (isModule ? 'type="module" crossorigin ' : '') + 'src="' + escapeHtml(resolvedSrc) + '"></script>';
    });
    var displayMode = screen.displayMode || "fixed";
    var bodyClass = "nexa-mode-" + displayMode;
    var artboardStyle = "width:" + screen.width + "px;height:" + screen.height + "px;";
    if (displayMode === "fill") {
        artboardStyle = "width:100vw;height:100vh;margin:0;box-shadow:none;";
    }

    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
        "<title>" + escapeHtml(screen.name || (flow && flow.name) || "Nexa Dashboard") + "</title>" +
        "<style>html,body{margin:0;padding:0;background:#ccc;}" +
        "#nexa-runtime-artboard{position:relative;background:var(--nexa-colors-bg,#fff);margin:20px auto;" +
        "box-shadow:0 4px 12px rgba(0,0,0,0.2);}" +
        "body.nexa-mode-fill #nexa-runtime-artboard{margin:0;box-shadow:none;width:100vw;height:100vh;}" +
        "body.nexa-mode-fill{overflow:hidden;}" +
        "</style>" +
        "</head><body class=\"" + bodyClass + "\">" +
        '<div id="nexa-runtime-artboard" style="' + artboardStyle + '"></div>' +
        '<script src="' + RUNTIME_PREFIX + '/_registry.js"></script>' +
        '<script src="' + RUNTIME_PREFIX + '/_sdk.js"></script>' +
        componentScripts.join("") +
        "<script>window.__NEXA_SCREEN__ = " + safeJsonForScript(screen) + ";" +
        "window.__NEXA_SCREENS__ = " + safeJsonForScript(flowScreens) + ";" +
        "window.__NEXA_FLOWS__ = " + safeJsonForScript(project.flows || []) + ";" +
        "window.__NEXA_CURRENT_FLOW__ = " + safeJsonForScript(flow ? flow.id : null) + ";" +
        "window.__NEXA_CLIENT_IP__ = " + safeJsonForScript(clientIp || "") + ";" +
        "window.__NEXA_TEMPLATES__ = " + getCachedTemplatesJson() + ";" +
        "window.__NEXA_APP__ = " + safeJsonForScript({ variables: project.variables || [], sharedVariables: project.sharedVariables || [], types: project.types || [], breakpoints: project.breakpoints || [], theme: project.theme || null }) + ";" +
        "window.__NEXA_ASSETS__ = " + safeJsonForScript((assetStore ? assetStore.list() : []).map(function (a) { return { name: a.name, url: RUNTIME_PREFIX + "/_assets/" + a.file, type: a.type, w: a.w, h: a.h }; })) + ";" +
        "window.__NEXA_PARAMS__ = " + safeJsonForScript(params) + ";" +
        "window.__NEXA_QUERY__ = " + safeJsonForScript(query) + ";" +
        "window.__NEXA_RUNTIME_PREFIX__ = " + safeJsonForScript(RUNTIME_PREFIX) + ";</script>" +
        '<script src="' + RUNTIME_PREFIX + '/_model.js"></script>' +
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
    if (!subPath || subPath === "") subPath = "/";
    if (subPath.charAt(0) !== "/") subPath = "/" + subPath;

    var flows = project.flows || [];
    var matchedFlow = null;
    var matchedScreen = null;
    var matchedParams = {};

    // Fallback for legacy standalone projects or integration test fixtures without flows
    if (!flows.length) {
        for (var si = 0; si < (project.screens || []).length; si++) {
            var scr = project.screens[si];
            var sm = matchScreenPath(scr.path || ("/" + scr.id), subPath);
            if (sm) { matchedScreen = scr; matchedParams = sm; break; }
        }
        if (matchedScreen) {
            if (matchedScreen.disabled) { sendText(res, 404, "Nexa screen is disabled: " + subPath); return; }
            var hh = req.headers.host || "localhost";
            var rh = hh.split(":")[0];
            var rip = req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "";
            var cip = String(rip).split(",")[0].trim();
            var h = renderScreenHtml(matchedScreen, null, matchedParams, query, rh, cip);
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(h) });
            res.end(h);
            return;
        }
    }

    // If root path requested, redirect to default flow if available
    if (subPath === "/" || subPath === "") {
        var defaultFlow = flows.find(function (f) { return !f.disabled && f.isDefault; }) ||
                          flows.find(function (f) { return !f.disabled; });
        if (defaultFlow) {
            var defEp = (defaultFlow.endpoint || "").trim();
            if (!defEp) defEp = "/flow1";
            if (defEp.charAt(0) !== "/") defEp = "/" + defEp;
            var redirectUrl = RUNTIME_PREFIX + defEp;
            var queryKeys = Object.keys(query || {});
            if (queryKeys.length) {
                var qs = new URLSearchParams(query).toString();
                if (qs) redirectUrl += "?" + qs;
            }
            res.writeHead(302, { "Location": redirectUrl });
            res.end();
            return;
        }
    }

    // Standalone screens cannot be accessed directly without a Flow gateway!
    // Every valid route must match a Flow endpoint (/nexa/<flow-endpoint> or /nexa/<flow-endpoint>/<screen-path>)
    for (var f = 0; f < flows.length; f++) {
        var flow = flows[f];
        if (flow.disabled) continue;
        var ep = (flow.endpoint || "").trim();
        if (!ep) ep = "/flow" + (f + 1);
        if (ep.charAt(0) !== "/") ep = "/" + ep;
        ep = ep.replace(/\/+$/, "");

        var allowedIds = getFlowAllowedScreenIds(flow, project.screens);

        // 1. Exact match on flow endpoint: e.g. /flow1 or /flow1/
        if (subPath === ep || subPath === ep + "/") {
            matchedFlow = flow;
            matchedParams = {};
            if (allowedIds.length === 0) {
                sendText(res, 404, "No accessible screens defined in Flow: " + (flow.name || flow.id) + ". Please add a 'Render Screen' node to define accessible screens.");
                return;
            }

            // Find the entry screen in the flow logic
            var nodes = (flow.logic && flow.logic.nodes) || [];
            var triggerNode = nodes.find(function (n) { return n.type === "route-trigger"; });
            var entryScreen = null;
            if (triggerNode) {
                var wires = (flow.logic && flow.logic.wires) || [];
                var triggerWires = wires.filter(function (w) { return w.from === triggerNode.id; });
                var directRenderTargets = triggerWires.map(function (w) {
                    return nodes.find(function (n) { return n.id === w.to && (n.type === "render-screen" || n.type === "navigate"); });
                }).filter(Boolean);
                if (directRenderTargets.length > 1) {
                    console.warn("[screen-worker] Route Trigger fan-out warning in Flow '" + (flow.name || flow.id) + "': connected to " + directRenderTargets.length + " render targets. Ambiguous entry screen.");
                }
                var nextWire = triggerWires[0];
                if (nextWire) {
                    var targetNode = nodes.find(function (n) { return n.id === nextWire.to; });
                    if (targetNode && (targetNode.type === "render-screen" || targetNode.type === "navigate") && targetNode.screenId && allowedIds.indexOf(targetNode.screenId) !== -1) {
                        entryScreen = (project.screens || []).find(function (s) { return s.id === targetNode.screenId && !s.disabled; });
                    }
                }
            }
            if (!entryScreen) {
                // Look for any screen referenced in flow render-screen or navigate nodes
                for (var ni = 0; ni < nodes.length; ni++) {
                    if ((nodes[ni].type === "render-screen" || nodes[ni].type === "navigate") && nodes[ni].screenId && allowedIds.indexOf(nodes[ni].screenId) !== -1) {
                        entryScreen = (project.screens || []).find(function (s) { return s.id === nodes[ni].screenId && !s.disabled; });
                        if (entryScreen) break;
                    }
                }
            }
            if (!entryScreen && allowedIds.length > 0) {
                entryScreen = (project.screens || []).find(function (s) { return s.id === allowedIds[0] && !s.disabled; });
            }

            if (!entryScreen) {
                sendText(res, 404, "None of the screens defined in Flow '" + (flow.name || flow.id) + "' are available or enabled.");
                return;
            }

            matchedScreen = entryScreen;
            break;
        }

        // 2. Match on flow sub-path: e.g. /flow1/<screen-path>
        if (subPath.indexOf(ep + "/") === 0) {
            matchedFlow = flow;
            var scrPath = subPath.slice(ep.length); // e.g. "/test", "/overview"
            if (scrPath.charAt(0) !== "/") scrPath = "/" + scrPath;

            var targetScreen = (project.screens || []).find(function (s) {
                if (s.disabled) return false;
                var sp = (s.path || ("/" + s.id)).trim();
                if (sp.charAt(0) !== "/") sp = "/" + sp;
                return sp === scrPath || matchScreenPath(sp, scrPath);
            });

            if (!targetScreen) {
                // Check if flow defines a 'route-not-found' handler
                var nodes = (flow.logic && flow.logic.nodes) || [];
                var notFoundNode = nodes.find(function (n) { return n.type === "route-not-found"; });
                if (notFoundNode) {
                    var wires = (flow.logic && flow.logic.wires) || [];
                    var notFoundScreen = null;
                    var nextWire = wires.find(function (w) { return w.from === notFoundNode.id; });
                    if (nextWire) {
                        var targetNode = nodes.find(function (n) { return n.id === nextWire.to; });
                        if (targetNode && (targetNode.type === "render-screen" || targetNode.type === "navigate") && targetNode.screenId && allowedIds.indexOf(targetNode.screenId) !== -1) {
                            notFoundScreen = (project.screens || []).find(function (s) { return s.id === targetNode.screenId && !s.disabled; });
                        }
                    }
                    if (!notFoundScreen && allowedIds.length > 0) {
                        notFoundScreen = (project.screens || []).find(function (s) { return s.id === allowedIds[0] && !s.disabled; });
                    }
                    if (notFoundScreen) {
                        matchedScreen = notFoundScreen;
                        matchedParams = { path: scrPath, notFound: true };
                        break;
                    }
                }

                sendText(res, 404, "Screen '" + scrPath + "' not found in Flow: " + (flow.name || flow.id));
                return;
            }

            if (allowedIds.indexOf(targetScreen.id) === -1) {
                sendText(res, 404, "Screen '" + scrPath + "' is not accessible in Flow: " + (flow.name || flow.id) + ". Only screens defined via 'Render Screen' or 'Goto Screen' in this flow are accessible.");
                return;
            }

            matchedScreen = targetScreen;
            matchedParams = matchScreenPath(targetScreen.path || ("/" + targetScreen.id), scrPath) || {};
            break;
        }
    }

    if (!matchedFlow || !matchedScreen) {
        sendText(res, 404, "No Nexa flow found for path: " + subPath + ". Direct screen access is disabled — all routes must go through a Flow gateway (e.g. /nexa" + ((flows[0] && flows[0].endpoint) || "/flow1") + ").");
        return;
    }
    if (matchedScreen.disabled) { sendText(res, 404, "Nexa screen is disabled: " + subPath); return; }

    var hostHeader = req.headers.host || "localhost";
    var requestHostname = hostHeader.split(":")[0];
    var rawIp = req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "";
    var clientIp = String(rawIp).split(",")[0].trim();
    var html = renderScreenHtml(matchedScreen, matchedFlow, matchedParams, query, requestHostname, clientIp);
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
    // this replaced in lib/nexa-plugin.js; see that file's own comment.
    if (req.method === "POST" && pathname === RUNTIME_PREFIX + "/_sparkplug-write") {
        handleSparkplugWrite(req, res); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_screens") {
        sendJson(res, 200, project.screens || []); return;
    }
    if (req.method === "GET" && pathname === RUNTIME_PREFIX + "/_sparkplug-stream") {
        handleSparkplugStream(req, res); return;
    }
    if (req.method === "GET" && (pathname === "/" || pathname === RUNTIME_PREFIX || pathname === RUNTIME_PREFIX + "/")) {
        var flows = project.flows || [];
        var defaultFlow = flows.find(function (f) { return !f.disabled && f.isDefault; }) ||
                          flows.find(function (f) { return !f.disabled; });
        if (defaultFlow) {
            var defEp = (defaultFlow.endpoint || "").trim();
            if (!defEp) defEp = "/flow1";
            if (defEp.charAt(0) !== "/") defEp = "/" + defEp;
            var redirectUrl = RUNTIME_PREFIX + defEp;
            var queryStr = url.search || "";
            if (queryStr) redirectUrl += queryStr;
            res.writeHead(302, { "Location": redirectUrl });
            res.end();
            return;
        }
        handleScreenRequest(req, res, "/", Object.fromEntries(url.searchParams)); return;
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
        project = migrateProject(msg.project || { screens: [], templates: [] });
        syncSharedVarsFromProject(project);
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
