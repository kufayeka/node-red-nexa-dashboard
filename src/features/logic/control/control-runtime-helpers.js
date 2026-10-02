// Control Logic Nodes Handlers
// Implementations for switch, delay, navigate, and layer-control.

import { state } from "../../../runtime/state.js";
import { cloneMsg } from "../../../runtime/logic/context.js";
import { varsFor } from "../../../runtime/logic/context.js";
import { findLogicNode } from "../../../runtime/mounting/slots.js";
import { formatSparkplugValue, parseSparkplugBindingPath } from "../../../runtime/io/sparkplug.js";

export function resolveSwitchBindingValue(screen, node, type, val, msg) {
    if (type === "msg") {
        if (!val || val === "payload") return msg ? msg.payload : undefined;
        const path = String(val).replace(/^msg\./, "");
        const parts = path.split(".");
        let curr = msg;
        for (let i = 0; i < parts.length && curr != null; i++) {
            curr = curr[parts[i]];
        }
        return curr;
    }
    if (type === "var") {
        const fnVars = varsFor(screen, node);
        const strVal = String(val || "");
        if (strVal.startsWith("@app.")) {
            return fnVars.get(strVal.slice(5), "@app");
        }
        if (strVal.startsWith("$")) {
            return fnVars.get(strVal.slice(1));
        }
        return fnVars.get(strVal);
    }
    if (type === "tag") {
        const ref = parseSparkplugBindingPath(val);
        return ref ? formatSparkplugValue(ref) : undefined;
    }
    if (type === "num") {
        const n = parseFloat(val);
        return isFinite(n) ? n : 0;
    }
    if (type === "bool") {
        return val === true || val === "true" || val === 1 || val === "1";
    }
    if (type === "json") {
        try { return JSON.parse(val); } catch (e) { return val; }
    }
    return val;
}

export function evaluateSwitchRule(lhs, rule, screen, node, msg) {
    const op = rule.t;
    if (op === "true") return lhs === true || lhs === "true" || lhs === 1;
    if (op === "false") return lhs === false || lhs === "false" || lhs === 0;
    if (op === "null") return lhs === null || lhs === undefined;
    if (op === "nnull") return lhs !== null && lhs !== undefined;
    if (op === "empty") {
        if (lhs === "" || lhs === null || lhs === undefined) return true;
        if (Array.isArray(lhs) && lhs.length === 0) return true;
        if (typeof lhs === "object" && Object.keys(lhs).length === 0) return true;
        return false;
    }
    if (op === "nempty") {
        if (lhs === "" || lhs === null || lhs === undefined) return false;
        if (Array.isArray(lhs) && lhs.length === 0) return false;
        if (typeof lhs === "object" && Object.keys(lhs).length === 0) return false;
        return true;
    }
    if (op === "else") return false;

    const rhs = resolveSwitchBindingValue(screen, node, rule.vt || "str", rule.v, msg);

    if (op === "eq") {
        /* eslint-disable eqeqeq */
        return lhs == rhs;
        /* eslint-enable eqeqeq */
    }
    if (op === "neq") {
        /* eslint-disable eqeqeq */
        return lhs != rhs;
        /* eslint-enable eqeqeq */
    }
    if (op === "lt") {
        return Number(lhs) < Number(rhs);
    }
    if (op === "lte") {
        return Number(lhs) <= Number(rhs);
    }
    if (op === "gt") {
        return Number(lhs) > Number(rhs);
    }
    if (op === "gte") {
        return Number(lhs) >= Number(rhs);
    }
    if (op === "btwn") {
        const rhs2 = resolveSwitchBindingValue(screen, node, rule.v2t || "num", rule.v2, msg);
        const nLhs = Number(lhs);
        const n1 = Number(rhs);
        const n2 = Number(rhs2);
        const min = Math.min(n1, n2);
        const max = Math.max(n1, n2);
        return nLhs >= min && nLhs <= max;
    }
    if (op === "cont") {
        if (typeof lhs === "string") {
            return lhs.indexOf(String(rhs)) !== -1;
        }
        if (Array.isArray(lhs)) {
            return lhs.some(function (el) { return el == rhs; });
        }
        return false;
    }
    return false;
}

export function runSwitchNode(screen, node, msg, budget, continuePropagation, runLogicGraph) {
    const propVal = resolveSwitchBindingValue(screen, node, node.propertyType || "msg", node.property || "payload", msg);
    const rules = (node.rules && node.rules.length) ? node.rules : [{ t: "eq", v: "", vt: "str" }];
    const checkall = node.checkall !== "false";
    const matchedIndices = [];
    let hadPriorMatch = false;

    for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        let isMatch = false;
        if (r.t === "else") {
            isMatch = !hadPriorMatch;
        } else {
            isMatch = evaluateSwitchRule(propVal, r, screen, node, msg);
        }
        if (isMatch) {
            hadPriorMatch = true;
            matchedIndices.push(i);
            if (!checkall) break;
        }
    }

    const rawWires = (screen.logic && screen.logic.wires) || [];
    const outWires = rawWires.filter(function (w) {
        return w && w.from === node.id && matchedIndices.indexOf(w.fromPort || 0) !== -1;
    });

    const targets = outWires.map(function (w) { return findLogicNode(screen, w.to); }).filter(Boolean);
    const msgs = targets.map(function (t, i) { return i === 0 ? msg : cloneMsg(msg); });
    targets.forEach(function (targetNode, i) {
        runLogicGraph(screen, targetNode, msgs[i], budget);
    });
}

export function runDelayNode(screen, node, msg, budget, continuePropagation) {
    let delayMs = (node.unit === "s" ? Number(node.delay) * 1000 : Number(node.delay));
    if (isNaN(delayMs) || delayMs < 0) delayMs = 500;
    if (msg && typeof msg.delay === "number" && msg.delay >= 0) {
        delayMs = msg.delay;
    }
    const dTimer = setTimeout(function () {
        const idx = state.activeScreenTimers.indexOf(dTimer);
        if (idx !== -1) state.activeScreenTimers.splice(idx, 1);
        continuePropagation(screen, node, cloneMsg(msg), budget);
    }, delayMs);
    state.activeScreenTimers.push(dTimer);
}
