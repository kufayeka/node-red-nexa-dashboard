// The page's Logic engine: runs a node, then passes its message on along the wires.
// What each node type does lives in src/features/logic/<family>/runtime.js (the registry);
// this file only walks the graph, guards against loops, and fires the sources.

import { LOGIC_MAX_STEPS } from "../state.js";
import { cloneMsg, logicTrace, varsFor } from "./context.js";
import { cloneValue, resolveBindableValue, writeVariable } from "../state/variable.js";
import { makeRoute, ownerOf, resolveScope } from "../state/scope.js";
import { findLogicNode, isStructural } from "../mounting/slots.js";
import { refreshComponentRender, propsMention } from "../mounting/render.js";
import { sendSparkplugWrite } from "../io/client.js";
import { parseSparkplugBindingPath } from "../io/sparkplug.js";
import { logicRuntime, hasLogicType, onLogicTypesChange } from "../../features/logic/registry.js";
import "../../features/logic/runtime.js";

/**
 * What a node's run(node, msg, ctx) gets. For every node, plugins included (docs/SDK.md):
 *   next(msg)            pass msg on through output 1 (later, for an async node)
 *   nextPort(port, msg)  pass msg on through output `port` (0-based)
 *   resolve(text, msg)   a field's bindings filled in: {variable}, {msg.payload.id}, {$route.params.id}
 *   vars                 vars.get(name, scope?) / vars.set(name, value, scope?, op?)
 *   log(...)             to the console, tagged with the node
 * Built-in nodes also use: screen, budget, continuePropagation / runLogicGraph (the engine itself).
 */
function runCtx(screen, node, budget) {
    return {
        screen: screen,
        budget: budget,
        next: function (m) { continuePropagation(screen, node, m, budget); },
        nextPort: function (port, m) { continueFromPort(screen, node, m, port, budget); },
        resolve: function (text, m) {
            if (typeof text !== "string" || text.indexOf("{") === -1) return text;
            var scope = Object.create(resolveScope(screen, "", node.id) || null);
            scope.msg = m || {};
            return resolveBindableValue(text, scope);
        },
        vars: varsFor(screen, node),
        log: function () { console.log.apply(console, ["[nexa-logic " + node.type + " " + node.id + "]"].concat(Array.prototype.slice.call(arguments))); },
        continuePropagation: continuePropagation,
        runLogicGraph: runLogicGraph
    };
}

// A plugin's Logic node: its module loads after the page started, so a chain can reach the node
// before its type is registered. Wait for it (a while), then run; never run it as something else.
var PLUGIN_WAIT_MS = 10000;
function whenRegistered(screen, node, msg, budget) {
    var done = false;
    var stop = onLogicTypesChange(function (type) {
        if (done || type !== node.type || !logicRuntime(type)) return;
        done = true;
        stop();
        clearTimeout(timer);
        runLogicGraph(screen, node, msg, budget);
    });
    var timer = setTimeout(function () {
        if (done) return;
        done = true;
        stop();
        console.error("[nexa-logic] no Logic node type \"" + node.type + "\" (node " + node.id + "): is the plugin that defines it installed?");
    }, PLUGIN_WAIT_MS);
}

export function runLogicGraph(screen, node, msg, budget) {
    budget = budget || { steps: 0 };
    if (!node) {
        logicTrace("runLogicGraph: a wire points at a node that no longer exists");
        return;
    }
    if (++budget.steps > LOGIC_MAX_STEPS) {
        console.error("[nexa-logic] stopped after " + LOGIC_MAX_STEPS + " steps - this looks like an unbounded loop in the wiring");
        return;
    }
    logicTrace("running", node.type, node.id, "with msg =", msg);
    var rt = logicRuntime(node.type);
    if (!rt) {
        if (!hasLogicType(node.type)) { whenRegistered(screen, node, msg, budget); return; }
        continuePropagation(screen, node, msg, budget); // known but nothing to do on the page: pass it on
        return;
    }
    var out;
    try {
        out = rt.run(node, msg, runCtx(screen, node, budget));
    } catch (e) {
        console.error("[nexa-logic] " + node.type + " node " + node.id + " threw:", e);
        return;
    }
    if (out !== undefined && out !== null) continuePropagation(screen, node, out, budget);
}

export function continuePropagation(screen, sourceNode, msg, budget) {
    if (msg === null || msg === undefined) {
        logicTrace("dropped at", sourceNode.id);
        return;
    }
    var rawWires = (screen.logic && screen.logic.wires) || [];
    var wires = [];
    if (Array.isArray(rawWires)) {
        wires = rawWires.filter(function (w) { return w && w.from === sourceNode.id; });
    } else if (typeof rawWires === "object") {
        wires = (rawWires[sourceNode.id] || []).map(function (targetId) { return { to: targetId }; });
    }
    logicTrace("propagating from", sourceNode.type, sourceNode.id, "via", wires.length, "wire(s)");
    var targets = wires.map(function (w) { return findLogicNode(screen, w.to); }).filter(Boolean);
    var msgs = targets.map(function (_t, i) { return i === 0 ? msg : cloneMsg(msg); });
    targets.forEach(function (targetNode, i) {
        runLogicGraph(screen, targetNode, msgs[i], budget);
    });
}

/** Like continuePropagation, for a node with several outputs: only the wires leaving output `port` (0-based). */
export function continueFromPort(screen, sourceNode, msg, port, budget) {
    if (msg === null || msg === undefined) return;
    var rawWires = (screen.logic && screen.logic.wires) || [];
    var wires = Array.isArray(rawWires) ? rawWires.filter(function (w) { return w && w.from === sourceNode.id && (w.fromPort || 0) === port; }) : [];
    var targets = wires.map(function (w) { return findLogicNode(screen, w.to); }).filter(Boolean);
    targets.forEach(function (targetNode, i) {
        runLogicGraph(screen, targetNode, i === 0 ? msg : cloneMsg(msg), budget);
    });
}

export function fireLifecycle(screen, type, msg) {
    if (!screen || !screen.logic) {
        logicTrace("fireLifecycle(" + type + "): no logic graph on this screen");
        return;
    }
    var matches = (screen.logic.nodes || []).filter(function (n) { return n.type === type; });
    logicTrace("fireLifecycle(" + type + "): " + matches.length + " matching node(s)");
    var baseMsg = (msg && typeof msg === "object") ? msg : { payload: null };
    matches.forEach(function (n) { runLogicGraph(screen, n, cloneMsg(baseMsg)); });
}

// target ({ list, id }): an event of one item of a target list (a series): only its own nodes fire
export function fireUiEvent(screen, compId, eventName, payload, target) {
    if (!screen || !screen.logic) {
        logicTrace("fireUiEvent: no logic graph on this screen");
        return;
    }
    var matches = (screen.logic.nodes || []).filter(function (n) {
        if (n.type !== "ui-event" || n.props.compId !== compId || n.props.event !== eventName) return false;
        var it = n.props.item;
        return target ? !!(it && it.list === target.list && it.id === target.id) : !it;
    });
    logicTrace("fireUiEvent(" + eventName + ") for component " + compId + ": " + matches.length + " matching node(s)");
    matches.forEach(function (n) {
        var initialPayload = (payload !== undefined && payload !== null && typeof payload === "object") ? cloneMsg(payload) : payload;
        var initialMsg = { event: eventName, payload: initialPayload };
        if (target) initialMsg.target = { list: target.list, id: target.id };
        var cut = compId.lastIndexOf("::");
        var owner = cut !== -1 && screen.__paramStates && screen.__paramStates[compId.slice(0, cut)];
        if (owner && Object.prototype.hasOwnProperty.call(owner, "item") && Object.prototype.hasOwnProperty.call(owner, "index")) {
            initialMsg.item = cloneValue(owner.item);
            initialMsg.index = owner.index;
        }
        if (payload && typeof payload === "object") {
            if (payload.value !== undefined) initialMsg.value = cloneValue(payload.value);
            if (payload.tag !== undefined) initialMsg.tag = payload.tag;
            if (payload.timestamp !== undefined) initialMsg.timestamp = payload.timestamp;
            if (payload.index !== undefined) initialMsg.index = payload.index;
            if (payload.item !== undefined) initialMsg.item = cloneValue(payload.item);
        }
        runLogicGraph(screen, n, initialMsg);
    });
}

export function makeCtx(screen, comp) {
    return {
        namespace: comp.id,
        mode: "runtime",
        screen: screen,
        emit: function (eventName, payload, target) {
            fireUiEvent(screen, comp.id, eventName, payload, target);
        },
        setBindableValue: function (name, value) {
            comp.props = comp.props || {};
            comp.props[name] = value;
        },
        getRawProps: function () {
            return comp.props || {};
        },
        writeTag: function (propKey, value) {
            var raw = (comp.props || {})[propKey];
            var local = writeLocalTarget(screen, comp, raw, value);
            if (local) return local;
            if (typeof raw === "string" && comp.__paramState) raw = resolveBindableValue(raw, comp.__paramState);
            var sref = parseSparkplugBindingPath(raw);
            if (sref) return sendSparkplugWrite(sref.groupId, sref.edgeNodeId, sref.deviceId, [{ name: sref.metricName, value: value }]);
            var sdk = window.NexaSDK;
            var t = sdk && sdk.parseTag(raw);
            if (!t) return Promise.reject(new Error("props." + propKey + " is not a tag: " + JSON.stringify(raw)));
            var provider = sdk.getTagProvider(t.provider);
            if (provider && typeof provider.write === "function") return Promise.resolve(provider.write(t.ref, value, t));
            return Promise.reject(new Error("tag provider \"" + t.provider + "\" can't write on a deployed page"));
        },
        writeSparkplugProp: function (propKey, value) {
            var raw = (comp.props || {})[propKey];
            if (typeof raw === "string" && comp.__paramState) raw = resolveBindableValue(raw, comp.__paramState);
            var ref = parseSparkplugBindingPath(raw);
            if (!ref) return Promise.reject(new Error("props." + propKey + " is not a valid {sparkplug:...} binding: " + JSON.stringify(raw)));
            return sendSparkplugWrite(ref.groupId, ref.edgeNodeId, ref.deviceId, [{ name: ref.metricName, value: value }]);
        }
    };
}

var LOCAL_TARGET_RE = /^\{(\$route\.query\.([A-Za-z_$][\w$]*)|([A-Za-z_][\w$]*)((?:\.[A-Za-z_$][\w$]*)*))\}$/;

export function writeLocalTarget(screen, comp, raw, value) {
    if (typeof raw !== "string") return null;
    var m = LOCAL_TARGET_RE.exec(raw.trim());
    if (!m || m[3] === "msg") return null;
    if (m[2]) {
        setRouteQuery(screen, m[2], value);
        return Promise.resolve({ ok: true, target: "route" });
    }
    var name = m[3], rest = m[4] ? m[4].slice(1).split(".") : [];
    var owner = ownerOf(comp.__paramState || (screen.__scopes || {})[""], name);
    if (!owner) return Promise.reject(new Error("{" + name + "} is not a variable around this component"));
    var inst = owner[name];
    if (rest.length && inst && typeof inst === "object" && inst.__type && window.NexaModel) {
        return writeInstanceMember(screen, owner, name, inst, rest, value);
    }
    var next = value;
    if (rest.length) {
        next = cloneValue(owner[name]);
        if (next === null || typeof next !== "object") next = {};
        var cur = next;
        for (var i = 0; i < rest.length - 1; i++) {
            if (cur[rest[i]] === null || typeof cur[rest[i]] !== "object") cur[rest[i]] = {};
            cur = cur[rest[i]];
        }
        cur[rest[rest.length - 1]] = value;
    }
    writeVariable(screen, owner, name, next, "set");
    return Promise.resolve({ ok: true, target: "variable" });
}

export function writeInstanceMember(screen, owner, name, inst, path, value) {
    var M = window.NexaModel;
    var member = M && M.memberAt(inst, path);
    if (!member) return Promise.reject(new Error("{" + name + "." + path.join(".") + "}: no such member"));
    if (member.access !== "readwrite") return Promise.reject(new Error("{" + name + "." + path.join(".") + "} is read-only"));
    var cur = inst;
    for (var i = 0; i < path.length - 1; i++) cur = cur && cur[path[i]];
    var leaf = cur && cur[path[path.length - 1]];
    if (leaf && typeof leaf.__nexaBinding === "string") {
        var ref = parseSparkplugBindingPath(leaf.__nexaBinding);
        if (ref) return sendSparkplugWrite(ref.groupId, ref.edgeNodeId, ref.deviceId, [{ name: ref.metricName, value: value }]);
        var sdk = window.NexaSDK, t = sdk && sdk.parseTag(leaf.__nexaBinding);
        var provider = t && sdk.getTagProvider(t.provider);
        if (provider && typeof provider.write === "function") return Promise.resolve(provider.write(t.ref, value, t));
        return Promise.reject(new Error("can't write " + leaf.__nexaBinding));
    }
    function copyOf(o) {
        var c = Object.assign({}, o);
        if (o && o.__type) Object.defineProperty(c, "__type", { value: o.__type, enumerable: false });
        return c;
    }
    var top = copyOf(inst), at = top;
    for (var j = 0; j < path.length - 1; j++) { at[path[j]] = copyOf(at[path[j]]); at = at[path[j]]; }
    at[path[path.length - 1]] = value;
    writeVariable(screen, owner, name, top, "set");
    return Promise.resolve({ ok: true, target: "member" });
}

export function setRouteQuery(screen, key, value) {
    var app = (screen.__scopes || {})["@app"];
    var root = app && Object.getPrototypeOf(app);
    try {
        var url = new URL(window.location.href);
        if (value === undefined || value === null || value === "") url.searchParams.delete(key);
        else url.searchParams.set(key, String(value));
        window.history.replaceState(window.history.state, "", url.toString());
    } catch (e) { /* test environment URL shim */ }
    if (root && root.$route) {
        var q = Object.assign({}, root.$route.query || {});
        if (value === undefined || value === null || value === "") delete q[key]; else q[key] = String(value);
        root.$route = Object.assign({}, root.$route, { query: q });
        screen.components.forEach(function (c) {
            if (isStructural(c) || c.type === "@template") return;
            if (propsMention(c.props, "$route")) refreshComponentRender(screen, c);
        });
    }
}
