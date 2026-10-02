// The HTML of a deployed screen: the artboard, the scripts, and the project data the
// runtime reads from window.__NEXA_*__. Pure string building: the screen worker passes
// everything in.
"use strict";

function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

// JSON inside <script>: "</script>" in a value must not end the tag
function safeJsonForScript(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

// A plugin's script: a src string (classic) or {src, module: true} (an SDK plugin, an ES module).
// Root-relative ones are served by Node-RED's own port, not this worker's: point them there,
// on the hostname the browser used. (Cross-origin modules need CORS; the SDK's package helper sends it.)
function scriptTag(entry, hostname, nodeRedPort) {
    const src = typeof entry === "string" ? entry : (entry && entry.src) || "";
    const isModule = !!(entry && typeof entry === "object" && entry.module);
    const url = src.charAt(0) === "/" ? "http://" + hostname + ":" + nodeRedPort + src : src;
    return "<script " + (isModule ? 'type="module" crossorigin ' : "") + 'src="' + escapeHtml(url) + '"></script>';
}

function artboardStyle(screen) {
    if ((screen.displayMode || "fixed") !== "fill") return "width:" + screen.width + "px;height:" + screen.height + "px;";
    const sf = Number(screen.scaleFactor) || 1;
    if (sf === 1) return "width:100vw;height:100vh;margin:0;box-shadow:none;";
    return "width:" + (100 / sf) + "vw;height:" + (100 / sf) + "vh;transform-origin:0 0;transform:scale(" + sf + ");margin:0;box-shadow:none;";
}

/**
 * @param {object} o
 *   project, screen, flow (or null), flowScreens (the screens this page may show), params, query,
 *   hostname, clientIp, prefix ("/nexa"), componentScriptSrcs, nodeRedPort,
 *   templatesJson (project.templates, already through safeJsonForScript: cached by the caller),
 *   assets [{name, file, type, w, h}]
 */
function renderScreenHtml(o) {
    const p = o.project;
    const screen = o.screen;
    const prefix = o.prefix;
    const app = { variables: p.variables || [], sharedVariables: p.sharedVariables || [], types: p.types || [], breakpoints: p.breakpoints || [], theme: p.theme || null };
    const assets = (o.assets || []).map(function (a) { return { name: a.name, url: prefix + "/_assets/" + a.file, type: a.type, w: a.w, h: a.h }; });
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
        "<title>" + escapeHtml(screen.name || (o.flow && o.flow.name) || "Nexa Dashboard") + "</title>" +
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
        "<style>html,body{margin:0;padding:0;background:#ccc;}" +
        "#nexa-runtime-artboard{position:relative;background:var(--nexa-colors-bg,#fff);margin:20px auto;" +
        "box-shadow:0 4px 12px rgba(0,0,0,0.2);}" +
        "body.nexa-mode-fill #nexa-runtime-artboard{margin:0;box-shadow:none;}" +
        "body.nexa-mode-fill{overflow:hidden;}" +
        "</style>" +
        "</head><body class=\"nexa-mode-" + (screen.displayMode || "fixed") + "\">" +
        '<div id="nexa-runtime-artboard" style="' + artboardStyle(screen) + '"></div>' +
        '<script src="' + prefix + '/_registry.js"></script>' +
        '<script src="' + prefix + '/_sdk.js"></script>' +
        (o.componentScriptSrcs || []).map(function (e) { return scriptTag(e, o.hostname, o.nodeRedPort); }).join("") +
        "<script>window.__NEXA_SCREEN__ = " + safeJsonForScript(screen) + ";" +
        "window.__NEXA_SCREENS__ = " + safeJsonForScript(o.flowScreens) + ";" +
        "window.__NEXA_FLOWS__ = " + safeJsonForScript(p.flows || []) + ";" +
        "window.__NEXA_CURRENT_FLOW__ = " + safeJsonForScript(o.flow ? o.flow.id : null) + ";" +
        "window.__NEXA_CLIENT_IP__ = " + safeJsonForScript(o.clientIp || "") + ";" +
        "window.__NEXA_TEMPLATES__ = " + o.templatesJson + ";" +
        "window.__NEXA_APP__ = " + safeJsonForScript(app) + ";" +
        "window.__NEXA_ASSETS__ = " + safeJsonForScript(assets) + ";" +
        "window.__NEXA_PARAMS__ = " + safeJsonForScript(o.params) + ";" +
        "window.__NEXA_QUERY__ = " + safeJsonForScript(o.query) + ";" +
        "window.__NEXA_RUNTIME_PREFIX__ = " + safeJsonForScript(prefix) + ";</script>" +
        '<script src="' + prefix + '/_model.js"></script>' +
        '<script src="' + prefix + '/_runtime.js"></script>' +
        "</body></html>";
}

module.exports = { renderScreenHtml, safeJsonForScript, escapeHtml };
