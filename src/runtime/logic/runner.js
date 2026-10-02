/**
 * @file src/runtime/logic/runner.js
 * @description Event-driven visual Logic execution engine for Nexa runtime.
 * Evaluates function nodes, switches, state transitions, HTTP requests, and tag writes.
 */

import { LOGIC_MAX_STEPS, activeScreenTimers } from "../state.js";
import { cloneMsg, logicTrace, varsFor, BROWSER_API } from "./context.js";
import { cloneValue, setMsgPath, valueFromMsg, resolveBindableValue, writeVariable } from "../state/variable.js";
import { makeRoute, resolveScope, ownerOf } from "../state/scope.js";
import { findLogicNode, isStructural } from "../mounting/slots.js";
import { updateInstanceParam, applyLayerControlUpdates, refreshComponentRender, propsMention, runUiUpdateNode } from "../mounting/render.js";
import { setVariable, setVariablesMulti, getVariablesMulti } from "./nodes/variable-nodes.js";
import { runSwitchNode } from "./nodes/control-nodes.js";
import { runHttpNode, runStorageNode, runCookieNode } from "./nodes/data-nodes.js";
import { sendSparkplugWrite } from "../io/client.js";
import { parseSparkplugBindingPath } from "../io/sparkplug.js";
import { runPopulate, sendToHost, elById } from "./widgets/populate.js";
import { teleportHome, teleportEl, teleportTarget } from "../features/teleport.js";
import { openOverlay, closeOverlay, overlayForNode } from "../features/overlays.js";
import { navigateToScreen, findScreenInProject, getActiveRenderScreen, getActiveFlowScreen, setActiveRenderScreen } from "../features/navigation.js";

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
    var outMsg = msg;

    if (node.type === "function") {
        try {
            var fnInput = cloneMsg(msg);
            var fnVars = varsFor(screen, node);
            var result = new Function("msg", "vars", "route", "storage", "cookies", "http", "getVariable", "setVariable",
                "return (async function(){ " + (node.code || "return msg;") + " })();")(
                fnInput, fnVars, cloneValue(((screen.__scopes || {})["@app"] || {}).$route || makeRoute()),
                BROWSER_API.storage, BROWSER_API.cookies, BROWSER_API.http,
                function (name, scopeId) { return fnVars.get(name, scopeId); },
                function (name, value, scopeId, op) { return fnVars.set(name, value, scopeId, op); });
            result.then(function (resolved) {
                continuePropagation(screen, node, resolved, budget);
            }).catch(function (e) {
                console.error("[nexa-logic] function node " + node.id + " rejected:", e);
            });
            return;
        } catch (e) {
            console.error("[nexa-logic] function node " + node.id + " threw:", e);
            return;
        }
    } else if (node.type === "ui-update") {
        runUiUpdateNode(screen, node, msg);
    } else if (node.type === "set-template-param") {
        updateInstanceParam(screen, node.instanceId, node.paramName, msg && msg.payload);
    } else if (node.type === "set-variable") {
        setVariable(screen, node, msg);
    } else if (node.type === "set-variable-multi") {
        setVariablesMulti(screen, node, msg);
    } else if (node.type === "teleport") {
        var cutT = node.id.lastIndexOf("::");
        var tEl = elById((cutT === -1 ? "" : node.id.slice(0, cutT + 2)) + node.node);
        var to = node.toSource === "payload" ? (msg && msg.payload) : node.to;
        to = to === undefined || to === null ? "" : String(to).trim();
        if (!tEl) logicTrace("teleport: no such node", node.node);
        else if (!to || to === "home") teleportHome(tEl);
        else if (!teleportEl(tEl, teleportTarget(to), to)) logicTrace("teleport: no target", to);
    } else if (node.type === "overlay-open") {
        var cutO = node.id.lastIndexOf("::");
        var oNs = (cutO === -1 ? "" : node.id.slice(0, cutO + 2)) + node.overlay;
        if (!openOverlay(screen, oNs, msg, function (res) { continuePropagation(screen, node, res, budget); })) {
            logicTrace("overlay-open: no overlay", oNs);
        }
    } else if (node.type === "overlay-close") {
        closeOverlay(overlayForNode(node), node.valueSource === "none" ? undefined : msg && msg.payload, "node");
        outMsg = null;
    } else if (node.type === "switch") {
        runSwitchNode(screen, node, msg, budget, continuePropagation);
        return;
    } else if (node.type === "route-trigger" || node.type === "route-not-found") {
        continuePropagation(screen, node, outMsg, budget);
        return;
    } else if (node.type === "http-request") {
        runHttpNode(screen, node, msg, function (res) { continuePropagation(screen, node, res, budget); });
        return;
    } else if (node.type === "populate") {
        if (node.container) runPopulate(screen, node, msg);
        else {
            outMsg = Object.assign({}, msg || {});
            var job = { template: node.template, itemParam: node.itemParam, mode: node.mode, key: node.key, fill: node.fill, virtualize: node.virtualize, items: valueFromMsg(node, msg) };
            var before = msg && msg.populate ? [].concat(msg.populate).filter(function (j) { return j && typeof j === "object"; }) : [];
            outMsg.populate = before.length ? before.concat([job]) : job;
        }
    } else if (node.type === "layout") {
        if (msg && msg.populate && typeof msg.populate === "object") {
            [].concat(msg.populate).forEach(function (job) {
                if (!job || typeof job !== "object") return;
                runPopulate(screen, {
                    id: node.id, container: node.container, template: job.template, itemParam: job.itemParam, mode: job.mode,
                    key: job.key, fill: job.fill, virtualize: job.virtualize, valueSource: "static", value: job.items
                }, msg);
            });
        }
        outMsg = null;
    } else if (node.type === "template-output") {
        sendToHost(screen, node, msg, budget);
        outMsg = null;
    } else if (node.type === "storage") {
        outMsg = runStorageNode(screen, node, msg);
    } else if (node.type === "cookie") {
        outMsg = runCookieNode(screen, node, msg);
    } else if (node.type === "get-variable") {
        var gScope = resolveScope(screen, node.scope, node.id);
        outMsg = cloneMsg(msg || {});
        setMsgPath(outMsg, node.target || "payload", gScope ? cloneValue(gScope[node.name]) : undefined);
    } else if (node.type === "get-variable-multi") {
        outMsg = getVariablesMulti(screen, node, msg);
    } else if (node.type === "debug") {
        console.log("[nexa-logic debug]", msg);
    } else if (node.type === "reload") {
        window.location.reload();
    } else if (node.type === "open-url") {
        var rawTarget = (msg && typeof msg.payload === "string" && msg.payload) || (msg && (msg.url || msg.endpoint)) || node.url;
        var navMode = (msg && msg.mode) || node.mode || "replace";
        var newTab = (msg && typeof msg.newTab === "boolean") ? msg.newTab : node.newTab;
        if (rawTarget) {
            var target = String(rawTarget).trim();
            var finalUrl = target;
            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(target) || /^\/\//.test(target)) {
                finalUrl = target;
            } else if (/^(localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/.*)?$/i.test(target)) {
                finalUrl = "http://" + target;
            } else if (/^www\./i.test(target) || /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(target)) {
                finalUrl = "https://" + target;
            } else if (navMode === "endpoint") {
                if (target.charAt(0) === "/") {
                    var base = window.location.pathname.startsWith("/nexa") ? "/nexa" : "";
                    var sub = target.startsWith("/nexa") ? target.slice(5) : target;
                    finalUrl = base + sub;
                } else {
                    var pathParts = window.location.pathname.split("/").filter(Boolean);
                    if (pathParts.length > 0) pathParts.pop();
                    pathParts.push(target);
                    finalUrl = "/" + pathParts.join("/");
                }
            }
            if (newTab) window.open(finalUrl, "_blank");
            else window.location.href = finalUrl;
        }
    } else if (node.type === "delay") {
        var delayMs = (node.unit === "s" ? Number(node.delay) * 1000 : Number(node.delay));
        if (isNaN(delayMs) || delayMs < 0) delayMs = 500;
        if (msg && typeof msg.delay === "number" && msg.delay >= 0) {
            delayMs = msg.delay;
        }
        var dTimer = setTimeout(function () {
            var idx = activeScreenTimers.indexOf(dTimer);
            if (idx !== -1) activeScreenTimers.splice(idx, 1);
            continuePropagation(screen, node, cloneMsg(msg), budget);
        }, delayMs);
        activeScreenTimers.push(dTimer);
        return;
    } else if (node.type === "render-screen") {
        var targetScreenId = (msg && (msg.screenId || msg.screen)) || node.screenId;
        var fwd = node.forwardPayload !== false;
        var pld = fwd ? (msg && msg.payload) : undefined;
        var match = findScreenInProject(targetScreenId);
        if (!match || !match.screen) {
            console.warn("[nexa-runtime] render-screen: target screen not found:", targetScreenId);
            return;
        }
        setActiveRenderScreen({
            flowScreen: screen,
            flowNode: node,
            screenId: match.screen.id
        });
        navigateToScreen(match.screen.id, pld, false, true, node.id);
        return;
    } else if (node.type === "send-to-flow") {
        var sendMsg = cloneMsg(msg);
        if (node.action) sendMsg.action = node.action;
        var activeRender = getActiveRenderScreen();
        var activeFlow = getActiveFlowScreen();
        if (activeFlow && activeRender && activeRender.flowNode) {
            logicTrace("send-to-flow dispatching to Flow node:", activeRender.flowNode.id);
            continuePropagation(activeFlow, activeRender.flowNode, sendMsg, budget);
        } else {
            console.warn("[nexa-runtime] send-to-flow: no active Render Screen node to receive message in current flow");
        }
        continuePropagation(screen, node, outMsg, budget);
        return;
    } else if (node.type === "navigate") {
        var nMode = (msg && msg.mode) || node.mode || "screen";
        if (nMode === "history") {
            var action = (msg && msg.action) || node.historyAction || "back";
            if (action === "forward") {
                if (typeof window.history !== "undefined" && typeof window.history.forward === "function") window.history.forward();
            } else {
                if (typeof window.history !== "undefined" && typeof window.history.back === "function") window.history.back();
            }
            continuePropagation(screen, node, outMsg, budget);
        } else {
            var targetId = nMode === "url"
                ? ((msg && (msg.url || msg.path || msg.endpoint)) || node.url)
                : ((msg && (msg.screenId || msg.screen)) || node.screenId);
            var fwdNav = node.forwardPayload !== false;
            var pldNav = fwdNav ? (msg && msg.payload) : undefined;
            navigateToScreen(targetId, pldNav, node.replace === true, true);
            continuePropagation(screen, node, outMsg, budget);
        }
        return;
    } else if (node.type === "layer-control") {
        var layerUpdates = (msg && Array.isArray(msg.payload)) ? msg.payload : (node.states || []);
        applyLayerControlUpdates(screen, layerUpdates);
    } else if (node.type === "sparkplug-write") {
        var writeRef = parseSparkplugBindingPath(node.tag);
        if (!writeRef) {
            console.error("[nexa-logic] sparkplug-write node " + node.id + ": \"" + node.tag + "\" is not a valid {sparkplug:...} binding");
            return;
        }
        sendSparkplugWrite(writeRef.groupId, writeRef.edgeNodeId, writeRef.deviceId, [{ name: writeRef.metricName, value: msg && msg.payload }])
            .then(function () { continuePropagation(screen, node, outMsg, budget); })
            .catch(function (e) { console.error("[nexa-logic] sparkplug-write node " + node.id + " failed:", e); });
        return;
    } else if (node.type === "sparkplug-write-multi") {
        var writes = (msg && Array.isArray(msg.writes)) ? msg.writes : [];
        if (!writes.length) {
            console.error("[nexa-logic] sparkplug-write-multi node " + node.id + ": msg.writes must be a non-empty array of {tag, value}");
            return;
        }
        var writeGroups = {};
        var invalidTags = [];
        writes.forEach(function (w) {
            var ref = w && parseSparkplugBindingPath(w.tag);
            if (!ref) { invalidTags.push(w && w.tag); return; }
            var key = ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "");
            if (!writeGroups[key]) writeGroups[key] = { groupId: ref.groupId, edgeNodeId: ref.edgeNodeId, deviceId: ref.deviceId, metrics: [] };
            writeGroups[key].metrics.push({ name: ref.metricName, value: w.value });
        });
        if (invalidTags.length) {
            console.error("[nexa-logic] sparkplug-write-multi node " + node.id + ": ignoring invalid tag(s):", invalidTags);
        }
        var groupKeys = Object.keys(writeGroups);
        if (!groupKeys.length) return;
        Promise.all(groupKeys.map(function (key) {
            var g = writeGroups[key];
            return sendSparkplugWrite(g.groupId, g.edgeNodeId, g.deviceId, g.metrics);
        })).then(function () {
            continuePropagation(screen, node, outMsg, budget);
        }).catch(function (e) {
            console.error("[nexa-logic] sparkplug-write-multi node " + node.id + " failed:", e);
        });
        return;
    }
    continuePropagation(screen, node, outMsg, budget);
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

export function fireUiEvent(screen, compId, eventName, payload) {
    if (!screen || !screen.logic) {
        logicTrace("fireUiEvent: no logic graph on this screen");
        return;
    }
    var matches = (screen.logic.nodes || []).filter(function (n) {
        return n.type === "ui-event" && n.compId === compId && n.event === eventName;
    });
    logicTrace("fireUiEvent(" + eventName + ") for component " + compId + ": " + matches.length + " matching node(s)");
    matches.forEach(function (n) {
        var initialPayload = (payload !== undefined && payload !== null && typeof payload === "object") ? cloneMsg(payload) : payload;
        var initialMsg = { event: eventName, payload: initialPayload };
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
        emit: function (eventName, payload) {
            fireUiEvent(screen, comp.id, eventName, payload);
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
