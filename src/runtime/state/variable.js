// Nexa Variable Mutations & Expressions
// Reading, writing, persisting, and watching variable changes.

import { state, PERSIST_PREFIX } from "../state.js";
import { storeFor, resolveScope, refreshScope } from "./scope.js";
import { ioSendSharedVar } from "../io/client.js";
import { applyColorMode } from "../features/theme.js";
import { runLogicGraph } from "../logic/runner.js";

export const WHOLE_BINDING_RE = /^\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)\}$/;
export const INTERPOLATION_RE = /\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)\}/g;

export function cloneMsg(m) {
    if (m === null || m === undefined || typeof m !== "object") return m;
    try {
        return JSON.parse(JSON.stringify(m));
    } catch (e) {
        return m;
    }
}

export function cloneValue(v) {
    return v !== null && typeof v === "object" ? cloneMsg(v) : v;
}

export function sameValue(a, b) {
    if (a === b) return true;
    try {
        return a !== null && b !== null && typeof a === "object" && JSON.stringify(a) === JSON.stringify(b);
    } catch (e) {
        return false;
    }
}

export function applyOp(op, old, value) {
    switch (op) {
        case "merge":
            return Object.assign({}, old && typeof old === "object" && !Array.isArray(old) ? old : {}, value && typeof value === "object" ? value : {});
        case "append":
            return (Array.isArray(old) ? old.slice() : []).concat([value]);
        case "remove":
            if (Array.isArray(old)) return old.filter(function (x) { return !sameValue(x, value); });
            if (old && typeof old === "object") {
                const o = Object.assign({}, old);
                delete o[value];
                return o;
            }
            return old;
        case "toggle":
            return !old;
        case "increment": {
            const by = typeof value === "number" ? value : (typeof value === "string" && value.trim() !== "" && isFinite(Number(value)) ? Number(value) : 1);
            return (Number(old) || 0) + by;
        }
        default:
            return value;
    }
}

export function writeVariable(screen, scope, name, value, op) {
    if (!scope || typeof name !== "string" || !name) return false;
    const old = scope[name];
    let next = applyOp(op || "set", old, value);

    if (scope === state.currentAppScope && name === "$colorMode") {
        next = applyColorMode(screen, next, true);
    }
    scope[name] = next;

    if (scope.__persist && scope.__persist[name]) {
        try {
            storeFor(scope.__persist[name]).setItem(PERSIST_PREFIX + name, JSON.stringify(next));
        } catch (e) {
            console.warn("[nexa] persist failed", name, e);
        }
    }

    if (scope === state.currentSharedScope || scope.__isSharedScope) {
        ioSendSharedVar(name, next);
    }

    refreshScope(screen, scope);
    if (!sameValue(old, next)) {
        notifyWatchers(screen, scope, name, next, old);
    }
    return true;
}

export function notifyWatchers(screen, scope, name, next, old) {
    (screen.__varWatchers || []).slice().forEach(function (w) {
        if (w.scope === scope && w.name === name) {
            try { w.fn(next, old); } catch (e) { console.warn("[nexa] watcher failed", name, e); }
        }
    });

    (screen.logic && screen.logic.nodes || []).forEach(function (n) {
        if (n.type !== "on-variable-change") return;
        let matched = false;
        if (Array.isArray(n.variables) && n.variables.length > 0) {
            matched = n.variables.some(function (v) {
                return v && v.name === name && resolveScope(screen, v.scope, n.id) === scope;
            });
        } else if (n.name === name && resolveScope(screen, n.scope, n.id) === scope) {
            matched = true;
        }
        if (!matched) return;
        runLogicGraph(screen, n, {
            payload: cloneValue(next),
            previous: cloneValue(old),
            variable: name,
            scope: scope
        });
    });
}

export function cleanMsgPath(path) {
    let p = String(path || "payload").trim();
    if (p.startsWith("msg.")) p = p.slice(4).trim();
    return p || "payload";
}

export function resolvePath(root, path) {
    const segments = path.match(/[^.[\]]+/g) || [];
    let cur = root;
    for (let i = 0; i < segments.length; i++) {
        if (cur === null || cur === undefined) return undefined;
        cur = cur[segments[i]];
    }
    return cur;
}

export function valueFromMsg(node, msg) {
    if (!node) return undefined;
    if (node.valueSource === "static") return cloneValue(node.value);
    if (node.valueSource === "msg") return resolvePath(msg, cleanMsgPath(node.msgPath || "payload"));
    return msg && msg.payload;
}

export function setMsgPath(msg, path, value) {
    const segs = cleanMsgPath(path || "payload").match(/[^.[\]]+/g) || ["payload"];
    let cur = msg;
    for (let i = 0; i < segs.length - 1; i++) {
        if (cur[segs[i]] === null || typeof cur[segs[i]] !== "object") cur[segs[i]] = {};
        cur = cur[segs[i]];
    }
    cur[segs[segs.length - 1]] = value;
}

export function isMsgPath(path) {
    return path === "msg" || path.indexOf("msg.") === 0 || path.indexOf("msg[") === 0;
}

export function resolveBindableValue(raw, scope) {
    if (typeof raw !== "string" || !scope) return raw;
    const whole = WHOLE_BINDING_RE.exec(raw.trim());
    if (whole) {
        const resolved = resolvePath(scope, whole[1]);
        if (resolved === undefined) return isMsgPath(whole[1]) ? "" : raw;
        if (resolved && typeof resolved.__nexaBinding === "string") return resolved.__nexaBinding;
        return resolved;
    }
    if (raw.indexOf("{") === -1) return raw;
    return raw.replace(INTERPOLATION_RE, function (wholeMatch, path) {
        const resolved = resolvePath(scope, path);
        if (resolved === undefined) return isMsgPath(path) ? "" : wholeMatch;
        if (resolved && typeof resolved.__nexaBinding === "string") return resolved.__nexaBinding;
        return resolved !== null && typeof resolved === "object" ? JSON.stringify(resolved) : String(resolved);
    });
}
