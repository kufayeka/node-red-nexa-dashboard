// Data & Network Logic Nodes Handlers
// Implementations for http-request, storage, and cookie nodes.

import { BROWSER_API, cloneMsg } from "../../../runtime/logic/context.js";
import { resolveScope } from "../../../runtime/state/scope.js";
import { resolveBindableValue, setMsgPath } from "../../../runtime/state/variable.js";

export function bindText(screen, node, msg, text) {
    if (typeof text !== "string" || text.indexOf("{") === -1) return text;
    const scope = Object.create(resolveScope(screen, "", node.id) || null);
    scope.msg = msg || {};
    return resolveBindableValue(text, scope);
}

export function parseHeaders(raw, screen, node, msg) {
    const h = {};
    if (!raw) return h;
    let obj = raw;
    if (typeof raw === "string") {
        try { obj = JSON.parse(raw); } catch (e) { return h; }
    }
    Object.keys(obj || {}).forEach(function (k) {
        h[k] = String(bindText(screen, node, msg, String(obj[k])));
    });
    return h;
}

export function runHttpNode(screen, node, msg, done) {
    const method = String((msg && msg.method) || node.method || "GET").toUpperCase();
    const url = bindText(screen, node, msg, (msg && typeof msg.url === "string" && msg.url) || node.url || "");
    const headers = Object.assign(parseHeaders(node.headers, screen, node, msg), (msg && msg.headers && typeof msg.headers === "object") ? msg.headers : {});
    const body = node.body === "none" || method === "GET" || method === "HEAD" ? undefined
        : node.body === "binding" ? bindText(screen, node, msg, node.bodyText || "")
        : (msg ? msg.payload : undefined);
    const out = cloneMsg(msg || {});
    if (!url) {
        out.error = "no URL";
        out.ok = false;
        done(out);
        return;
    }
    BROWSER_API.http.request(method, String(url), body, {
        headers: headers,
        timeout: Number(node.timeout) || 0,
        credentials: node.credentials || undefined
    }).then(function (res) {
        out.payload = res.data;
        out.statusCode = res.status;
        out.headers = res.headers;
        out.ok = res.ok;
        if (!res.ok) out.error = "HTTP " + res.status;
        else delete out.error;
    }, function (e) {
        out.ok = false;
        out.statusCode = 0;
        out.error = (e && e.name === "AbortError") ? "timeout" : String((e && e.message) || e);
    }).then(function () {
        done(out);
    });
}

export function runStorageNode(screen, node, msg) {
    const store = BROWSER_API.storage[node.store === "session" ? "session" : "local"];
    const key = String(bindText(screen, node, msg, node.key || ""));
    const out = cloneMsg(msg || {});
    if (!key) return out;
    if (node.action === "set") store.set(key, node.valueSource === "static" ? node.value : (msg && msg.payload));
    else if (node.action === "remove") store.remove(key);
    else setMsgPath(out, node.target || "payload", store.get(key));
    return out;
}

export function runCookieNode(screen, node, msg) {
    const name = String(bindText(screen, node, msg, node.name || ""));
    const out = cloneMsg(msg || {});
    if (!name) return out;
    const opts = { path: node.path || "/", sameSite: node.sameSite || "Lax", secure: !!node.secure };
    if (node.days !== undefined && node.days !== "" && node.days !== null) opts.days = Number(node.days);
    if (node.action === "set") BROWSER_API.cookies.set(name, node.valueSource === "static" ? node.value : (msg && msg.payload), opts);
    else if (node.action === "remove") BROWSER_API.cookies.remove(name, opts);
    else setMsgPath(out, node.target || "payload", BROWSER_API.cookies.get(name));
    return out;
}
