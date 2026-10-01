// Function Node Execution Context & Browser APIs
// Context object passed to Function nodes ($route, storage, cookies, http, vars).

import { resolveScope, ownerOf, storeFor } from "../state/scope.js";
import { writeVariable, cloneValue } from "../state/variable.js";

export function cloneMsg(msg, seen) {
    if (msg === null || typeof msg !== "object") return msg;
    try {
        if (typeof structuredClone === "function") {
            return structuredClone(msg);
        }
    } catch (e) { /* fallback */ }
    try {
        return JSON.parse(JSON.stringify(msg));
    } catch (e) { /* fallback */ }

    seen = seen || new WeakMap();
    if (seen.has(msg)) return seen.get(msg);
    const copy = Array.isArray(msg) ? [] : {};
    seen.set(msg, copy);
    for (const key in msg) {
        if (Object.prototype.hasOwnProperty.call(msg, key)) {
            const val = msg[key];
            copy[key] = (val && typeof val === "object") ? cloneMsg(val, seen) : val;
        }
    }
    return copy;
}

export function makeBrowserApi() {
    function jsonStore(kind) {
        return {
            get: function (k) {
                try {
                    const r = storeFor(kind).getItem(k);
                    return r === null ? undefined : JSON.parse(r);
                } catch (e) {
                    try { return storeFor(kind).getItem(k); } catch (e2) { return undefined; }
                }
            },
            set: function (k, v) {
                try { storeFor(kind).setItem(k, JSON.stringify(v)); } catch (e) { /* blocked */ }
            },
            remove: function (k) {
                try { storeFor(kind).removeItem(k); } catch (e) { /* blocked */ }
            }
        };
    }

    const cookies = {
        get: function (name) {
            const parts = (document.cookie || "").split(/;\s*/);
            for (let i = 0; i < parts.length; i++) {
                const eq = parts[i].indexOf("=");
                if (eq !== -1 && decodeURIComponent(parts[i].slice(0, eq)) === name) {
                    return decodeURIComponent(parts[i].slice(eq + 1));
                }
            }
            return undefined;
        },
        set: function (name, value, opts) {
            opts = opts || {};
            let c = encodeURIComponent(name) + "=" + encodeURIComponent(value === undefined || value === null ? "" : String(value));
            if (opts.maxAge !== undefined) c += "; Max-Age=" + Number(opts.maxAge);
            else if (opts.days !== undefined) c += "; Expires=" + new Date(Date.now() + Number(opts.days) * 864e5).toUTCString();
            c += "; Path=" + (opts.path || "/");
            if (opts.domain) c += "; Domain=" + opts.domain;
            c += "; SameSite=" + (opts.sameSite || "Lax");
            if (opts.secure) c += "; Secure";
            document.cookie = c;
        },
        remove: function (name, opts) {
            cookies.set(name, "", Object.assign({}, opts || {}, { maxAge: 0 }));
        }
    };

    function request(method, url, body, opts) {
        opts = opts || {};
        const headers = Object.assign({}, opts.headers || {});
        const init = { method: method, headers: headers, credentials: opts.credentials || "same-origin" };
        if (body !== undefined && body !== null && method !== "GET" && method !== "HEAD") {
            if (typeof body === "string" || (typeof FormData !== "undefined" && body instanceof FormData)) init.body = body;
            else {
                init.body = JSON.stringify(body);
                if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
            }
        }
        const ctrl = typeof AbortController === "function" ? new AbortController() : null;
        if (ctrl) init.signal = ctrl.signal;
        const timer = ctrl && opts.timeout ? setTimeout(function () { ctrl.abort(); }, opts.timeout) : null;
        return fetch(url, init).then(function (res) {
            const hdrs = {};
            if (res.headers && res.headers.forEach) res.headers.forEach(function (v, k) { hdrs[k] = v; });
            const type = (hdrs["content-type"] || "");
            return (type.indexOf("json") !== -1 ? res.json() : res.text()).catch(function () { return null; }).then(function (data) {
                return { ok: res.ok, status: res.status, data: data, headers: hdrs };
            });
        }).finally(function () { if (timer) clearTimeout(timer); });
    }

    const http = { request: request };
    ["get", "delete", "head"].forEach(function (m) {
        http[m] = function (url, opts) { return request(m.toUpperCase(), url, undefined, opts); };
    });
    ["post", "put", "patch"].forEach(function (m) {
        http[m] = function (url, body, opts) { return request(m.toUpperCase(), url, body, opts); };
    });

    return { storage: { local: jsonStore("local"), session: jsonStore("session") }, cookies: cookies, http: http };
}

export const BROWSER_API = makeBrowserApi();

export function varsFor(screen, node) {
    const root = function () { return resolveScope(screen, "", node.id); };
    return {
        get: function (name, scopeId) {
            const sc = scopeId !== undefined ? resolveScope(screen, scopeId, node.id) : root();
            return sc ? cloneValue(sc[name]) : undefined;
        },
        set: function (name, value, scopeId, op) {
            const sc = scopeId !== undefined ? resolveScope(screen, scopeId, node.id) : (ownerOf(root(), name) || root());
            return writeVariable(screen, sc, name, value, op);
        },
        update: function (name, op, value, scopeId) {
            return this.set(name, value, scopeId, op);
        }
    };
}
