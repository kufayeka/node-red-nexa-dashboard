// Nexa IO Client Subsystem
// EtherNet/IP-style implicit cyclic binary data + explicit writes over single WebSocket with SSE fallback.

import { state, IO_WRITE_TIMEOUT_MS } from "../state.js";
import { ioApplyFrame } from "./frame.js";
import { refreshAllSparkplugBoundComponents, absorbSparkplugSnapshot, applySparkplugDelta } from "./sparkplug.js";

export function ioSubscribedKeys() {
    const keys = Object.keys(state.sparkplugBindingIndex);
    const app = window.__NEXA_APP__ || {};
    if (Array.isArray(app.sharedVariables)) {
        app.sharedVariables.forEach(function (v) {
            if (v && v.name) keys.push("@shared::" + v.name);
        });
    }
    return keys.sort();
}

export function ioSyncSubscription() {
    const keys = ioSubscribedKeys();
    const sig = keys.join("\n");
    if (sig === state.io.keysSig) return;
    state.io.keysSig = sig;
    if (state.io.ws && state.io.opened && state.io.ws.readyState === 1) {
        state.io.ws.send(JSON.stringify({ t: "sub", keys: keys }));
    }
}

export function ioRpiMs() {
    const q = window.__NEXA_QUERY__ || {};
    const screen = window.__NEXA_SCREEN__ || {};
    return Number(q.rpi) || Number(screen.ioRpiMs) || 20;
}

export function ioMarkLost() {
    if (!state.sparkplugConnectionLost) {
        state.sparkplugConnectionLost = true;
        refreshAllSparkplugBoundComponents();
    }
}

export function ioRejectPending(reason) {
    Object.keys(state.io.pending).forEach(function (id) {
        const p = state.io.pending[id];
        clearTimeout(p.timer);
        p.reject(new Error(reason));
    });
    state.io.pending = {};
}

export function sendSparkplugWriteIo(groupId, edgeNodeId, deviceId, metrics) {
    return new Promise(function (resolve, reject) {
        const id = state.io.nextId++;
        const timer = setTimeout(function () {
            delete state.io.pending[id];
            reject(new Error("Sparkplug write timed out (no ack within " + IO_WRITE_TIMEOUT_MS + "ms)"));
        }, IO_WRITE_TIMEOUT_MS);
        state.io.pending[id] = { resolve: resolve, reject: reject, timer: timer };
        state.io.ws.send(JSON.stringify({
            t: "w", id: id, g: groupId, e: edgeNodeId, d: deviceId || null,
            m: metrics.map(function (m) { return { n: m.name, v: m.value }; })
        }));
    });
}

export function sendSparkplugWriteHttp(groupId, edgeNodeId, deviceId, metrics) {
    return new Promise(function (resolve, reject) {
        if (typeof window.XMLHttpRequest !== "function") {
            reject(new Error("XMLHttpRequest not available in this environment"));
            return;
        }
        const prefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";
        const xhr = new XMLHttpRequest();
        xhr.open("POST", prefix + "/_sparkplug-write", true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                let parsed = {};
                try { parsed = JSON.parse(xhr.responseText); } catch (e) { /* tolerate non-JSON */ }
                if (parsed && parsed.ok === false) {
                    reject(new Error("Sparkplug write was not published (Nexa Sparkplug connection not connected?)"));
                    return;
                }
                resolve(parsed);
            } else {
                reject(new Error("Sparkplug write failed: HTTP " + xhr.status));
            }
        };
        xhr.onerror = function () { reject(new Error("Sparkplug write request failed (network error)")); };
        xhr.send(JSON.stringify({ groupId: groupId, edgeNodeId: edgeNodeId, deviceId: deviceId || null, metrics: metrics }));
    });
}

export function sendSparkplugWrite(groupId, edgeNodeId, deviceId, metrics) {
    if (state.io.ws && state.io.opened && state.io.ws.readyState === 1) {
        return sendSparkplugWriteIo(groupId, edgeNodeId, deviceId, metrics);
    }
    return sendSparkplugWriteHttp(groupId, edgeNodeId, deviceId, metrics);
}

export function ioSendSharedVar(name, value) {
    if (state.io.ws && state.io.opened && state.io.ws.readyState === 1) {
        state.io.ws.send(JSON.stringify({ t: "set-var", name: name, value: value }));
    }
}

export function ioHandleText(msg) {
    if (msg.t === "opened") {
        state.io.opened = true;
        state.io.hb = Number(msg.hb) || 1000;
    } else if (msg.t === "layout") {
        (msg.add || []).forEach(function (a) {
            state.io.layout[a[0]] = { key: a[1], type: a[2], engUnit: a[3], properties: a[4], metadata: a[5] };
        });
    } else if (msg.t === "ack") {
        const p = state.io.pending[msg.id];
        if (!p) return;
        delete state.io.pending[msg.id];
        clearTimeout(p.timer);
        if (msg.ok) p.resolve({ ok: true });
        else p.reject(new Error("Sparkplug write was not published: " + (msg.err || "unknown error")));
    }
}

export function ioTeardown(reason, onGiveUp, prefix) {
    const ws = state.io.ws;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch (e) { /* already closed */ }
    state.io.ws = null;
    state.io.opened = false;
    if (state.io.watchdog) { clearInterval(state.io.watchdog); state.io.watchdog = null; }
    ioRejectPending("Nexa IO connection lost (" + reason + ")");
    ioMarkLost();
    if (!state.io.everOpened && ++state.io.failures >= 3) { onGiveUp(); return; }
    state.io.reconnectTimer = setTimeout(function () { ioConnect(prefix, onGiveUp); }, state.io.backoff);
    state.io.backoff = Math.min(state.io.backoff * 2, 10000);
}

export function ioConnect(prefix, onGiveUp) {
    if (state.io.ws && (state.io.ws.readyState === 0 || state.io.ws.readyState === 1)) {
        ioSyncSubscription();
        return;
    }
    const loc = window.location || {};
    const url = (loc.protocol === "https:" ? "wss:" : "ws:") + "//" + (loc.host || "localhost") + prefix + "/_io";
    let ws;
    try { ws = new window.WebSocket(url); } catch (e) { onGiveUp(); return; }
    ws.binaryType = "arraybuffer";
    state.io.ws = ws;
    state.io.opened = false;

    ws.onopen = function () {
        state.io.everOpened = true;
        state.io.failures = 0;
        state.io.backoff = 1000;
        state.io.lastRx = Date.now();
        state.io.layout = [];
        const keys = ioSubscribedKeys();
        state.io.keysSig = keys.join("\n");
        ws.send(JSON.stringify({ t: "open", rpi: ioRpiMs(), keys: keys }));

        state.io.lastCheck = Date.now();
        state.io.watchdog = setInterval(function () {
            const now = Date.now();
            if (now - state.io.lastCheck > 1500) state.io.lastRx = now;
            state.io.lastCheck = now;
            if (now - state.io.lastRx > Math.max(3 * state.io.hb, 3000)) ioTeardown("watchdog timeout", onGiveUp, prefix);
        }, 500);
    };

    ws.onmessage = function (evt) {
        state.io.lastRx = Date.now();
        if (typeof evt.data === "string") {
            let msg;
            try { msg = JSON.parse(evt.data); } catch (e) { return; }
            ioHandleText(msg);
        } else {
            try { ioApplyFrame(evt.data); } catch (e) { /* next frame repairs */ }
        }
    };

    ws.onclose = function () { ioTeardown("closed", onGiveUp, prefix); };
    ws.onerror = function () { /* onclose follows */ };
}

export function setUpSparkplugLiveBinding() {
    const ioPrefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";
    const forceSse = ((window.__NEXA_QUERY__ || {}).io === "sse");
    if (typeof window.WebSocket === "function" && !forceSse) {
        ioConnect(ioPrefix, setUpSparkplugSse);
        return;
    }
    setUpSparkplugSse();
}

export function setUpSparkplugSse() {
    if (typeof window.XMLHttpRequest !== "function") return;
    const prefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";

    function fetchSnapshotAndRefresh() {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", prefix + "/_sparkplug-snapshot", true);
        xhr.onload = function () {
            if (xhr.status === 200) {
                try { absorbSparkplugSnapshot(JSON.parse(xhr.responseText)); } catch (e) { /* leave stale */ }
            }
            state.sparkplugConnectionLost = false;
            refreshAllSparkplugBoundComponents();
        };
        xhr.send();
    }

    if (typeof window.EventSource !== "function") {
        fetchSnapshotAndRefresh();
        return;
    }

    const streamUrl = prefix + "/_sparkplug-stream";
    const source = new EventSource(streamUrl);

    source.onopen = function () {
        fetchSnapshotAndRefresh();
    };

    source.onerror = function () {
        ioMarkLost();
    };

    source.onmessage = function (evt) {
        if (!evt.data) return;
        let delta;
        try { delta = JSON.parse(evt.data); } catch (e) { return; }
        applySparkplugDelta(delta);
    };
}
