// Sparkplug Live Binding & Cache
// Manages Sparkplug tag bindings, dirty marking, and targeted component re-renders.

import { state } from "../state.js";
import { resolveBindableValue } from "../state/variable.js";
import { ioSyncSubscription } from "./client.js";
import { refreshComponentRender } from "../mounting/render.js";
import { fireUiEvent } from "../logic/runner.js";

export const SPARKPLUG_BINDING_PREFIX = "sparkplug:";
export const EMBEDDED_TAG_RE = /\{sparkplug:[^{}]+\}/g;

export function parseSparkplugBindingPath(raw) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (trimmed.charAt(0) !== "{" || trimmed.charAt(trimmed.length - 1) !== "}") return null;
    const inner = trimmed.slice(1, -1);
    if (inner.indexOf(SPARKPLUG_BINDING_PREFIX) !== 0) return null;
    const parts = inner.slice(SPARKPLUG_BINDING_PREFIX.length).split("::");
    if (parts.length < 4) return null;
    const metricName = parts.slice(3).join("::");
    if (!parts[0] || !parts[1] || !metricName) return null;
    return { groupId: parts[0], edgeNodeId: parts[1], deviceId: parts[2] || null, metricName: metricName };
}

export function sparkplugRefKey(ref) {
    return ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "") + "::" + ref.metricName;
}

export function formatSparkplugValue(ref) {
    if (state.sparkplugConnectionLost) return "???";
    const entry = state.sparkplugCache[sparkplugRefKey(ref)];
    if (!entry || !entry.online || entry.isNull || entry.value === undefined || entry.value === null) return "???";
    return String(entry.value);
}

export function resolveSparkplugProps(props) {
    let out = null;
    const keys = Object.keys(props || {});
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = props[k];
        if (Array.isArray(v)) {
            if (!v.some(function (x) { return parseSparkplugBindingPath(x); })) continue;
            if (!out) out = Object.assign({}, props);
            out[k] = v.map(function (x) {
                const r = parseSparkplugBindingPath(x);
                return r ? formatSparkplugValue(r) : x;
            });
            continue;
        }
        if (typeof v !== "string") continue;
        const ref = parseSparkplugBindingPath(v);
        if (ref) {
            if (!out) out = Object.assign({}, props);
            out[k] = formatSparkplugValue(ref);
            continue;
        }
        if (v.indexOf("{" + SPARKPLUG_BINDING_PREFIX) === -1) continue;
        const replaced = v.replace(EMBEDDED_TAG_RE, function (whole) {
            const r = parseSparkplugBindingPath(whole);
            if (!r) return whole;
            const val = formatSparkplugValue(r);
            return val === null || val === undefined ? "" : String(val);
        });
        if (replaced !== v) {
            if (!out) out = Object.assign({}, props);
            out[k] = replaced;
        }
    }
    return out || props;
}

export function tagRefsIn(text) {
    if (typeof text !== "string") return [];
    const whole = parseSparkplugBindingPath(text);
    if (whole) return [whole];
    return (text.match(EMBEDDED_TAG_RE) || []).map(parseSparkplugBindingPath).filter(Boolean);
}

let sparkplugIndexPending = null;

export function batchSparkplugIndex(fn) {
    state.sparkplugIndexBatch++;
    try {
        return fn();
    } finally {
        if (--state.sparkplugIndexBatch === 0 && sparkplugIndexPending) {
            const pending = sparkplugIndexPending;
            sparkplugIndexPending = null;
            registerSparkplugBoundComponentsFrom(pending);
        }
    }
}

export function registerSparkplugBoundComponentsFrom(effectiveScreen) {
    if (state.sparkplugIndexBatch) {
        sparkplugIndexPending = effectiveScreen;
        return;
    }
    state.sparkplugBoundComponents = [];
    state.sparkplugBindingIndex = {};
    (effectiveScreen.components || []).forEach(function (comp) {
        let isBound = false;
        const candidates = [];
        if (comp.sparkplugBinding && typeof comp.sparkplugBinding === "string") {
            candidates.push(comp.sparkplugBinding);
        }
        const props = comp.props || {};
        Object.keys(props).forEach(function (k) {
            const v = props[k];
            if (typeof v === "string") candidates.push(v);
            else if (Array.isArray(v)) v.forEach(function (x) { if (typeof x === "string") candidates.push(x); });
        });
        candidates.forEach(function (v) {
            const resolved = resolveBindableValue(v, comp.__paramState);
            tagRefsIn(resolved).forEach(function (ref) {
                isBound = true;
                const key = sparkplugRefKey(ref);
                if (!state.sparkplugBindingIndex[key]) state.sparkplugBindingIndex[key] = [];
                const already = state.sparkplugBindingIndex[key].some(function (e) { return e.comp.id === comp.id; });
                if (!already) {
                    state.sparkplugBindingIndex[key].push({ screen: effectiveScreen, comp: comp, ref: ref });
                }
            });
        });
        if (isBound) state.sparkplugBoundComponents.push({ screen: effectiveScreen, comp: comp });
    });
    ioSyncSubscription();
}

export function refreshAllSparkplugBoundComponents() {
    (state.sparkplugBoundComponents || []).forEach(function (entry) {
        refreshComponentRender(entry.screen, entry.comp);
    });
}

export function flushDirtySparkplugComponents() {
    state.sparkplugFlushScheduled = false;
    const keys = state.sparkplugDirtyKeys;
    state.sparkplugDirtyKeys = null;
    if (!keys) return;
    const refreshedIds = {};
    Object.keys(keys).forEach(function (key) {
        (state.sparkplugBindingIndex[key] || []).forEach(function (entry) {
            if (!refreshedIds[entry.comp.id]) {
                refreshedIds[entry.comp.id] = true;
                refreshComponentRender(entry.screen, entry.comp);
            }
            const cached = state.sparkplugCache[key];
            const payload = {
                value: cached ? cached.value : undefined,
                type: cached ? cached.type : undefined,
                isNull: cached ? cached.isNull : false,
                timestamp: cached ? cached.timestamp : undefined,
                tag: key,
                metric: entry.ref ? entry.ref.metricName : (key.split("::")[3] || key),
                groupId: entry.ref ? entry.ref.groupId : (key.split("::")[0] || ""),
                edgeNodeId: entry.ref ? entry.ref.edgeNodeId : (key.split("::")[1] || ""),
                deviceId: (entry.ref && entry.ref.deviceId) || (key.split("::")[2] || null),
                properties: cached ? (cached.properties || null) : null,
                metadata: cached ? (cached.metadata || null) : null
            };
            fireUiEvent(entry.screen, entry.comp.id, "sparkplug-change", payload);
        });
    });
}

export function markSparkplugKeysDirty(keys) {
    if (!keys || !keys.length) return;
    if (!state.sparkplugDirtyKeys) state.sparkplugDirtyKeys = {};
    keys.forEach(function (key) { state.sparkplugDirtyKeys[key] = true; });
    if (state.sparkplugFlushScheduled) return;
    state.sparkplugFlushScheduled = true;
    const raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(flushDirtySparkplugComponents);
}

export function applySparkplugDelta(delta) {
    if (!delta) return;
    const changedKeys = [];
    if (delta.type === "death") {
        const nodePrefix = delta.groupId + "::" + delta.edgeNodeId + "::";
        const devicePrefix = delta.deviceId ? nodePrefix + delta.deviceId + "::" : null;
        Object.keys(state.sparkplugCache).forEach(function (key) {
            if (devicePrefix ? key.indexOf(devicePrefix) !== 0 : key.indexOf(nodePrefix) !== 0) return;
            if (state.sparkplugCache[key].online) {
                state.sparkplugCache[key].online = false;
                changedKeys.push(key);
            }
        });
    } else {
        (delta.metrics || []).forEach(function (m) {
            const key = delta.groupId + "::" + delta.edgeNodeId + "::" + (delta.deviceId || "") + "::" + m.name;
            state.sparkplugCache[key] = {
                value: m.value,
                type: m.type,
                isNull: m.isNull,
                online: true,
                timestamp: m.timestamp,
                properties: m.properties || null,
                metadata: m.metadata || null,
                engUnit: m.engUnit || null
            };
            changedKeys.push(key);
        });
    }
    markSparkplugKeysDirty(changedKeys);
}

export function absorbSparkplugSnapshot(tree) {
    state.sparkplugCache = {};
    Object.keys(tree || {}).forEach(function (groupId) {
        Object.keys(tree[groupId]).forEach(function (edgeNodeId) {
            const edgeNode = tree[groupId][edgeNodeId];
            Object.keys(edgeNode.nodeMetrics || {}).forEach(function (name) {
                const m = edgeNode.nodeMetrics[name];
                state.sparkplugCache[groupId + "::" + edgeNodeId + "::" + "::" + name] = {
                    value: m.value,
                    type: m.type,
                    isNull: m.isNull,
                    online: edgeNode.online,
                    timestamp: m.timestamp,
                    properties: m.properties || null,
                    metadata: m.metadata || null,
                    engUnit: m.engUnit || null
                };
            });
            Object.keys(edgeNode.devices || {}).forEach(function (deviceId) {
                const device = edgeNode.devices[deviceId];
                Object.keys(device.metrics || {}).forEach(function (name) {
                    const m = device.metrics[name];
                    state.sparkplugCache[groupId + "::" + edgeNodeId + "::" + deviceId + "::" + name] = {
                        value: m.value,
                        type: m.type,
                        isNull: m.isNull,
                        online: edgeNode.online && device.online,
                        timestamp: m.timestamp,
                        properties: m.properties || null,
                        metadata: m.metadata || null,
                        engUnit: m.engUnit || null
                    };
                });
            });
        });
    });
}
