// Component Rendering, Updates, Visibility Reconciler & Injects
// Connects components to DOM, parses props interpolation, handles two-way bindings.

import { state } from "../state.js";
import { cloneMsg, cloneValue } from "../logic/context.js";
import { resolveBindableValue, writeVariable } from "../state/variable.js";
import { ownerOf } from "../state/scope.js";
import { resolveSparkplugProps, parseSparkplugBindingPath, registerSparkplugBoundComponentsFrom } from "../io/sparkplug.js";
import { sendSparkplugWrite } from "../io/client.js";
import { findComponent, isStructural, walkNodes, isSlotHostNode, isContainerNode, findTemplateById } from "./slots.js";
import { combineVisibility, getComponentTransform } from "./box.js";
import { renderLitComponentInstance, coerceLitBindableValue } from "./lit.js";
import { mountAndFlatten } from "../features/navigation.js";
import { runLogicGraph, fireUiEvent } from "../logic/runner.js";
import { THEME } from "../features/theme.js";

export const LOGIC_GEOMETRY_KEYS = { x: 1, y: 1, w: 1, h: 1, rotation: 1, flipH: 1, flipV: 1 };
export const LOCAL_TARGET_RE = /^\{(\$route\.query\.([A-Za-z_$][\w$]*)|([A-Za-z_][\w$]*)((?:\.[A-Za-z_$][\w$]*)*))\}$/;

export function propsMention(props, text) {
    for (const k in props || {}) {
        if (typeof props[k] === "string" && props[k].indexOf(text) !== -1) return true;
    }
    return false;
}

export function interpolateProps(props, paramState, comp) {
    let withTemplateBindings = props;
    if (comp && (comp.__lastMsg || propsMention(props, "{msg"))) {
        const withMsg = Object.create(paramState || null);
        withMsg.msg = comp.__lastMsg || {};
        paramState = withMsg;
    }
    if (paramState) {
        const out = {};
        Object.keys(props || {}).forEach(function (k) {
            const v = props[k];
            out[k] = (typeof v === "string" && v.indexOf("{") !== -1) ? resolveBindableValue(v, paramState) : v;
        });
        withTemplateBindings = out;
    }
    let resolved = resolveSparkplugProps(withTemplateBindings);
    if (window.NexaModel && window.NexaModel.resolveTokenProps && propsMention(resolved, "{token:")) {
        const t = (window.__NEXA_THEME__ && window.__NEXA_THEME__.theme) ? window.__NEXA_THEME__ : THEME;
        resolved = window.NexaModel.resolveTokenProps(resolved, t.theme, t.mode);
    }
    return props && props.__fallback && window.NexaModel && window.NexaModel.applyFallbacks ? window.NexaModel.applyFallbacks(props, resolved) : resolved;
}

export function updateComponentBox(comp) {
    const el = document.querySelector('[data-id="' + comp.id + '"]') || document.querySelector('[data-component-id="' + comp.id + '"]');
    if (!el) return;
    el.style.left = comp.x + "px";
    el.style.top = comp.y + "px";
    el.style.width = comp.w + "px";
    el.style.height = comp.h + "px";
    el.style.transform = getComponentTransform(comp);
}

export function refreshComponentRender(screen, comp) {
    const el = document.querySelector('[data-id="' + comp.id + '"]') || document.querySelector('[data-component-id="' + comp.id + '"]');
    if (!el) return;
    if (comp.type === "@lit-component") {
        renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, comp.__paramState, comp), makeCtx(screen, comp));
        return;
    }
    const typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
    if (!typeDef || typeof typeDef.render !== "function") return;
    try {
        typeDef.render(el, interpolateProps(comp.props || {}, comp.__paramState, comp), makeCtx(screen, comp));
    } catch (e) {
        el.textContent = "(render error: " + e.message + ")";
    }
}

export function applyUiUpdateProp(screen, compId, key, value) {
    const comp = findComponent(screen, compId);
    if (!comp) return;
    if (LOGIC_GEOMETRY_KEYS[key]) {
        comp[key] = value;
        updateComponentBox(comp);
        return;
    }
    comp.props = comp.props || {};
    comp.props[key] = value;

    if (comp.type === "@lit-component") {
        const litEl = document.querySelector('[data-id="' + comp.id + '"]') || document.querySelector('[data-component-id="' + comp.id + '"]');
        const litInstance = litEl && litEl.firstElementChild;
        if (litInstance) {
            const bindableDef = (comp.litBindable || []).filter(function (p) { return p.name === key; })[0];
            litInstance[key] = bindableDef ? coerceLitBindableValue(bindableDef.type, value) : value;
        }
        return;
    }

    const typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
    if (!typeDef) return;
    const el = document.querySelector('[data-id="' + comp.id + '"]') || document.querySelector('[data-component-id="' + comp.id + '"]');
    if (typeDef.onBind && el) {
        try { typeDef.onBind(el, "props." + key, value); } catch (e) { /* ignore component error */ }
        return;
    }
    refreshComponentRender(screen, comp);
}

export function applyUiUpdateMulti(screen, compId, staticConfig, payloadProps, msgProperties) {
    const overrides = {};
    const cfg = staticConfig || {};
    Object.keys(cfg).forEach(function (k) {
        if (cfg[k] !== undefined && cfg[k] !== "") overrides[k] = cfg[k];
    });
    const fromPayload = payloadProps || {};
    Object.keys(fromPayload).forEach(function (k) {
        if (fromPayload[k] !== undefined) overrides[k] = fromPayload[k];
    });
    const live = msgProperties || {};
    Object.keys(live).forEach(function (k) {
        if (live[k] !== undefined) overrides[k] = live[k];
    });
    Object.keys(overrides).forEach(function (k) { applyUiUpdateProp(screen, compId, k, overrides[k]); });
}

export function runComponentAction(screen, compId, action, params) {
    const comp = findComponent(screen, compId);
    const typeDef = comp && window.NEXA && window.NEXA.getComponent(comp.type);
    const el = comp && (document.querySelector('[data-id="' + comp.id + '"]') || document.querySelector('[data-component-id="' + comp.id + '"]'));
    if (!typeDef || typeof typeDef.invoke !== "function" || !el) {
        console.warn("[nexa-logic] action \"" + action + "\": component " + compId + " has no actions");
        return;
    }
    try { typeDef.invoke(el, action, params); } catch (e) { console.error("[nexa-logic] action \"" + action + "\" failed:", e); }
}

export function runUiUpdateNode(screen, node, msg) {
    const act = msg && typeof msg === "object" && typeof msg.action === "string" && msg.action ? msg.action : node.action;
    if (act) {
        const pl = msg && typeof msg === "object" ? msg.payload : msg;
        const noPayload = pl === undefined || pl === null || pl === "" || (!msg.action && typeof pl === "number" && node.actionParams !== undefined);
        runComponentAction(screen, node.compId, act, noPayload ? node.actionParams : pl);
        return;
    }
    let payloadProps = null;
    const comp = findComponent(screen, node.compId);
    const compProps = (comp && comp.props) || {};
    if (comp) comp.__lastMsg = cloneMsg(msg && typeof msg === "object" ? msg : { payload: msg });
    if (propsMention(compProps, "{msg")) {
        const cfg = {};
        Object.keys(node.config || {}).forEach(function (k) {
            const bound = typeof compProps[k] === "string" && compProps[k].indexOf("{msg") !== -1;
            if (!bound) cfg[k] = node.config[k];
        });
        applyUiUpdateMulti(screen, node.compId, cfg, null, msg && msg.properties);
        refreshComponentRender(screen, comp);
        return;
    }

    let rawPayload = msg;
    if (msg && typeof msg === "object" && !Array.isArray(msg) && ("payload" in msg)) {
        rawPayload = msg.payload;
    }

    let guessedKey = null;
    if (rawPayload !== undefined && rawPayload !== null) {
        if (typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
            payloadProps = Object.assign({}, rawPayload);
        } else {
            guessedKey = ("fill" in compProps && !("text" in compProps)) ? "fill" : "text";
            payloadProps = {};
            payloadProps[guessedKey] = rawPayload;
        }
    }

    if (msg && typeof msg === "object") {
        const directPropKeys = ["fill", "stroke", "color", "text", "rotation", "x", "y", "w", "h", "opacity"];
        directPropKeys.forEach(function (k) {
            if (msg[k] !== undefined) {
                payloadProps = payloadProps || {};
                if (payloadProps[k] === undefined || k === guessedKey) payloadProps[k] = msg[k];
            }
        });
    }

    applyUiUpdateMulti(screen, node.compId, node.config, payloadProps, msg && msg.properties);
    if (comp) refreshComponentRender(screen, comp);
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
            const raw = (comp.props || {})[propKey];
            const local = writeLocalTarget(screen, comp, raw, value);
            if (local) return local;
            let resolved = raw;
            if (typeof raw === "string" && comp.__paramState) resolved = resolveBindableValue(raw, comp.__paramState);
            const sref = parseSparkplugBindingPath(resolved);
            if (sref) return sendSparkplugWrite(sref.groupId, sref.edgeNodeId, sref.deviceId, [{ name: sref.metricName, value: value }]);
            const sdk = window.NexaSDK;
            const t = sdk && sdk.parseTag(resolved);
            if (!t) return Promise.reject(new Error("props." + propKey + " is not a tag: " + JSON.stringify(raw)));
            const provider = sdk.getTagProvider(t.provider);
            if (provider && typeof provider.write === "function") return Promise.resolve(provider.write(t.ref, value, t));
            return Promise.reject(new Error("tag provider \"" + t.provider + "\" can't write on a deployed page"));
        },
        writeSparkplugProp: function (propKey, value) {
            let raw = (comp.props || {})[propKey];
            if (typeof raw === "string" && comp.__paramState) raw = resolveBindableValue(raw, comp.__paramState);
            const ref = parseSparkplugBindingPath(raw);
            if (!ref) return Promise.reject(new Error("props." + propKey + " is not a valid {sparkplug:...} binding: " + JSON.stringify(raw)));
            return sendSparkplugWrite(ref.groupId, ref.edgeNodeId, ref.deviceId, [{ name: ref.metricName, value: value }]);
        }
    };
}

export function writeLocalTarget(screen, comp, raw, value) {
    if (typeof raw !== "string") return null;
    const m = LOCAL_TARGET_RE.exec(raw.trim());
    if (!m || m[3] === "msg") return null;
    if (m[2]) { setRouteQuery(screen, m[2], value); return Promise.resolve({ ok: true, target: "route" }); }
    const name = m[3], rest = m[4] ? m[4].slice(1).split(".") : [];
    const owner = ownerOf(comp.__paramState || (screen.__scopes || {})[""], name);
    if (!owner) return Promise.reject(new Error("{" + name + "} is not a variable around this component"));
    const inst = owner[name];
    if (rest.length && inst && typeof inst === "object" && inst.__type && window.NexaModel) return writeInstanceMember(screen, owner, name, inst, rest, value);
    let next = value;
    if (rest.length) {
        next = cloneValue(owner[name]);
        if (next === null || typeof next !== "object") next = {};
        let cur = next;
        for (let i = 0; i < rest.length - 1; i++) {
            if (cur[rest[i]] === null || typeof cur[rest[i]] !== "object") cur[rest[i]] = {};
            cur = cur[rest[i]];
        }
        cur[rest[rest.length - 1]] = value;
    }
    writeVariable(screen, owner, name, next, "set");
    return Promise.resolve({ ok: true, target: "variable" });
}

export function writeInstanceMember(screen, owner, name, inst, path, value) {
    const M = window.NexaModel;
    const member = M.memberAt(inst, path);
    if (!member) return Promise.reject(new Error("{" + name + "." + path.join(".") + "}: no such member"));
    if (member.access !== "readwrite") return Promise.reject(new Error("{" + name + "." + path.join(".") + "} is read-only"));
    let cur = inst;
    for (let i = 0; i < path.length - 1; i++) cur = cur && cur[path[i]];
    const leaf = cur && cur[path[path.length - 1]];
    if (leaf && typeof leaf.__nexaBinding === "string") {
        const ref = parseSparkplugBindingPath(leaf.__nexaBinding);
        if (ref) return sendSparkplugWrite(ref.groupId, ref.edgeNodeId, ref.deviceId, [{ name: ref.metricName, value: value }]);
        const sdk = window.NexaSDK, t = sdk && sdk.parseTag(leaf.__nexaBinding);
        const provider = t && sdk.getTagProvider(t.provider);
        if (provider && typeof provider.write === "function") return Promise.resolve(provider.write(t.ref, value, t));
        return Promise.reject(new Error("can't write " + leaf.__nexaBinding));
    }
    function copyOf(o) {
        const c = Object.assign({}, o);
        if (o && o.__type) Object.defineProperty(c, "__type", { value: o.__type, enumerable: false });
        return c;
    }
    const top = copyOf(inst);
    let at = top;
    for (let j = 0; j < path.length - 1; j++) { at[path[j]] = copyOf(at[path[j]]); at = at[path[j]]; }
    at[path[path.length - 1]] = value;
    writeVariable(screen, owner, name, top, "set");
    return Promise.resolve({ ok: true, target: "member" });
}

export function setRouteQuery(screen, key, value) {
    const app = (screen.__scopes || {})["@app"];
    const root = app && Object.getPrototypeOf(app);
    try {
        const url = new URL(window.location.href);
        if (value === undefined || value === null || value === "") url.searchParams.delete(key);
        else url.searchParams.set(key, String(value));
        window.history.replaceState(window.history.state, "", url.toString());
    } catch (e) { /* test shim */ }
    if (root && root.$route) {
        const q = Object.assign({}, root.$route.query || {});
        if (value === undefined || value === null || value === "") delete q[key]; else q[key] = String(value);
        root.$route = Object.assign({}, root.$route, { query: q });
        screen.components.forEach(function (c) {
            if (isStructural(c) || c.type === "@template") return;
            if (propsMention(c.props, "$route")) refreshComponentRender(screen, c);
        });
    }
}

export function belongsDirectlyToInstance(id, namespacedInstanceId) {
    if (id === namespacedInstanceId) return true;
    const prefix = namespacedInstanceId + "::";
    if (id.indexOf(prefix) !== 0) return false;
    return id.slice(prefix.length).indexOf("::") === -1;
}

export function reapplyInterpolationForInstance(screen, namespacedInstanceId, paramState) {
    screen.components.forEach(function (comp) {
        if (comp.type === "@template") return;
        if (!belongsDirectlyToInstance(comp.id, namespacedInstanceId)) return;
        const el = document.querySelector('[data-id="' + comp.id + '"]') || document.querySelector('[data-component-id="' + comp.id + '"]');
        if (!el) return;
        const scope = comp.__paramState || paramState;
        if (comp.type === "@lit-component") {
            renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, scope, comp), makeCtx(screen, comp));
            return;
        }
        const typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (!typeDef || typeof typeDef.render !== "function") return;
        try {
            typeDef.render(el, interpolateProps(comp.props || {}, scope, comp), makeCtx(screen, comp));
        } catch (e) {
            el.textContent = "(render error: " + e.message + ")";
        }
    });
}

export function fireParamInputForInstance(screen, namespacedInstanceId, paramState) {
    screen.logic.nodes.filter(function (n) {
        return n.type === "param-input" && belongsDirectlyToInstance(n.id, namespacedInstanceId);
    }).forEach(function (n) {
        runLogicGraph(screen, n, cloneMsg({ payload: paramState }));
    });
}

export function updateInstanceParam(screen, namespacedInstanceId, paramName, newValue) {
    const paramState = screen.__paramStates && screen.__paramStates[namespacedInstanceId];
    if (!paramState) return;
    paramState[paramName] = newValue;
    reapplyInterpolationForInstance(screen, namespacedInstanceId, paramState);
    fireParamInputForInstance(screen, namespacedInstanceId, paramState);
    cascadeBoundChildParams(screen, namespacedInstanceId, paramState);
    registerSparkplugBoundComponentsFrom(screen);
}

export function cascadeBoundChildParams(screen, namespacedInstanceId, paramState) {
    const instComp = findComponent(screen, namespacedInstanceId);
    if (!instComp) return;
    const template = findTemplateById(screen.__templates, instComp.templateId);
    if (!template) return;
    walkNodes(template.components, function (childComp) {
        if (childComp.type !== "@template") return;
        const childNamespacedId = namespacedInstanceId + "::" + childComp.id;
        const childParamState = screen.__paramStates && screen.__paramStates[childNamespacedId];
        if (!childParamState) return;
        Object.keys(childComp.paramValues || {}).forEach(function (name) {
            const raw = childComp.paramValues[name];
            if (typeof raw !== "string" || raw.indexOf("{") === -1) return;
            const resolved = resolveBindableValue(raw, paramState);
            if (resolved !== childParamState[name]) {
                updateInstanceParam(screen, childNamespacedId, name, resolved);
            }
        });
    });
}

export function applyLayerControlUpdates(effectiveScreen, updates) {
    const tree = effectiveScreen.__tree;
    if (!tree || !Array.isArray(updates)) return;
    let changed = false;
    updates.forEach(function (u) {
        if (!u || typeof u.name !== "string" || ["show", "hide", "remove"].indexOf(u.state) === -1) return;
        walkNodes(tree.components, function (n) {
            if (n.name !== u.name || (n.visibility || "show") === u.state) return;
            if (u.state === "show") delete n.visibility; else n.visibility = u.state;
            changed = true;
        });
    });
    if (changed) reconcileVisibility(effectiveScreen);
}

export function reconcileVisibility(effectiveScreen) {
    const artboard = document.getElementById("nexa-runtime-artboard");
    if (!artboard) return;
    function elOf(ns) { return document.querySelector('[data-id="' + ns + '"]'); }
    (function visit(list, parentEl, inherited, scope) {
        (list || []).forEach(function (node, i) {
            const vis = combineVisibility(inherited, node);
            const el = elOf(node.id);
            if (vis === "remove") {
                if (el && el.parentNode) el.parentNode.removeChild(el);
                return;
            }
            if (!el) {
                let before = null;
                for (let j = i + 1; j < list.length && !before; j++) before = elOf(list[j].id);
                mountAndFlatten(parentEl, node, inherited, effectiveScreen.__templates, node.id, [], effectiveScreen, scope, before);
                return;
            }
            el.style.display = vis === "show" ? (node.type === "@frame" && window.NexaModel ? window.NexaModel.frameCss(node).display : "") : "none";
            if (isSlotHostNode(node)) {
                if (el.__childHost) visit((node.children || []).filter(function (c) { return !c.slotUnused; }), el.__childHost, vis, scope);
                return;
            }
            if (isContainerNode(node)) visit(node.children, el.__childHost || el, vis, (effectiveScreen.__scopes || {})[node.id] || scope);
        });
    })(effectiveScreen.__tree.components, artboard, "show", (effectiveScreen.__scopes || {})[""]);
}

export function clearActiveScreenTimers() {
    state.activeScreenTimers.forEach(function (id) {
        try { clearInterval(id); } catch (e) {}
        try { clearTimeout(id); } catch (e) {}
    });
    state.activeScreenTimers = [];
}

export function setUpInjectNodes(effectiveScreen, runLogicGraphFn) {
    const runner = runLogicGraphFn || runLogicGraph;
    (effectiveScreen.logic && effectiveScreen.logic.nodes || []).filter(function (n) { return n.type === "inject"; }).forEach(function (n) {
        function getPayload() {
            const ptype = n.payloadType || (n.payload !== undefined ? "str" : "date");
            if (ptype === "json") {
                try { return JSON.parse(n.payload); } catch (e) { return {}; }
            } else if (ptype === "num") {
                return parseFloat(n.payload) || 0;
            } else if (ptype === "str") {
                return n.payload !== undefined ? String(n.payload) : "Hello";
            }
            return Date.now();
        }
        function triggerInject() {
            const p = getPayload();
            const msg = { payload: cloneMsg(p) };
            if (typeof p === "object" && p !== null) {
                if (p.text !== undefined) msg.text = p.text;
            } else {
                msg.text = String(p);
            }
            runner(effectiveScreen, n, cloneMsg(msg));
        }

        let intervalMs = parseInt(n.intervalMs, 10);
        if (isNaN(intervalMs)) intervalMs = 5000;
        if (intervalMs > 0) {
            const tid = setInterval(triggerInject, Math.max(100, intervalMs));
            state.activeScreenTimers.push(tid);
        }
        if (n.once) {
            const oid = setTimeout(triggerInject, Math.max(50, n.onceDelay || 100));
            state.activeScreenTimers.push(oid);
        }
    });
}
