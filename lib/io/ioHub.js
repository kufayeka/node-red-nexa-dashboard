// Nexa IO hub — the server side of lib/io/ioProtocol.js, independent of the
// actual socket (lib/screen-worker.js plugs WebSocket connections in; tests
// plug in fakes). Holds the latest value of every Sparkplug metric the Nexa
// connection knows, and runs one cyclic "implicit" producer per connected
// screen:
//   - each client subscribes to just the keys it uses (or "*"), at its own RPI
//   - a delta only marks keys dirty; the value is read from the cache when the
//     frame is BUILT, so N changes of a tag between two cycles cost one entry
//   - if a client's socket still has more than `highWater` bytes queued, that
//     cycle is skipped entirely (dirty keys stay dirty) — a slow link gets
//     fewer, always-current frames instead of an ever-growing backlog
//   - an empty frame every `hbMs` keeps the client's watchdog fed
"use strict";

const { encodeDataFrame } = require("./ioProtocol");

const MAX_INDEX = 0xFFFF;

function keyOf(groupId, edgeNodeId, deviceId, name) {
    return groupId + "::" + edgeNodeId + "::" + (deviceId || "") + "::" + name;
}

function metaSig(m) {
    return JSON.stringify([m.type || null, m.engUnit || null, m.properties || null, m.metadata || null]);
}

class IoHub {
    /**
     * @param {object} [opts]
     * @param {number} [opts.hbMs=1000]        heartbeat (empty frame) interval
     * @param {number} [opts.highWater=65536]  skip a cycle while this many bytes are still queued
     * @param {number} [opts.defaultRpi=20]
     * @param {number} [opts.minRpi=5]
     * @param {number} [opts.maxRpi=5000]
     * @param {function} [opts.onWrite]        (client, writeMsg) => void — explicit write requests
     */
    constructor(opts) {
        opts = opts || {};
        this.hbMs = opts.hbMs || 1000;
        this.highWater = opts.highWater || 64 * 1024;
        this.defaultRpi = opts.defaultRpi || 20;
        this.minRpi = opts.minRpi || 5;
        this.maxRpi = opts.maxRpi || 5000;
        this.onWrite = opts.onWrite || function () {};
        this.cache = new Map();      // key -> {value,isNull,online,timestamp,type,engUnit,properties,metadata,metaVer,sig}
        this.clients = new Set();
        this.keyClients = new Map(); // key -> Set(client) — explicit subscribers
        this.allClients = new Set(); // "*" subscribers
    }

    // --- data in ------------------------------------------------------------

    _setMetric(key, m, online) {
        const prev = this.cache.get(key);
        const sig = metaSig(m);
        const metaVer = prev ? (prev.sig === sig ? prev.metaVer : prev.metaVer + 1) : 1;
        this.cache.set(key, {
            value: m.value, isNull: Boolean(m.isNull), online: online,
            timestamp: typeof m.timestamp === "number" ? m.timestamp : (m.timestamp ? Number(m.timestamp) : undefined),
            type: m.type || null, engUnit: m.engUnit || null,
            properties: m.properties || null, metadata: m.metadata || null,
            sig, metaVer
        });
    }

    _markDirty(key) {
        const subs = this.keyClients.get(key);
        if (subs) subs.forEach((c) => c.dirty.add(key));
        this.allClients.forEach((c) => c.dirty.add(key));
    }

    /** Full tree (nodes/nexa-sparkplug.js getSnapshot()) — replaces the cache. */
    absorbSnapshot(tree) {
        this.cache = new Map();
        Object.keys(tree || {}).forEach((g) => {
            Object.keys(tree[g] || {}).forEach((e) => {
                const edge = tree[g][e] || {};
                Object.keys(edge.nodeMetrics || {}).forEach((name) => {
                    this._setMetric(keyOf(g, e, null, name), edge.nodeMetrics[name], edge.online !== false);
                });
                Object.keys(edge.devices || {}).forEach((d) => {
                    const dev = edge.devices[d] || {};
                    Object.keys(dev.metrics || {}).forEach((name) => {
                        this._setMetric(keyOf(g, e, d, name), dev.metrics[name], edge.online !== false && dev.online !== false);
                    });
                });
            });
        });
        this.clients.forEach((c) => { c.full = true; });
    }

    /** One tree delta ({type:"birth"|"data"|"death", groupId, edgeNodeId, deviceId, metrics}). */
    applyDelta(delta) {
        if (!delta || !delta.groupId || !delta.edgeNodeId) return;
        if (delta.type === "death") {
            const prefix = delta.groupId + "::" + delta.edgeNodeId + "::" + (delta.deviceId ? delta.deviceId + "::" : "");
            this.cache.forEach((entry, key) => {
                if (key.indexOf(prefix) === 0 && entry.online) {
                    entry.online = false;
                    this._markDirty(key);
                }
            });
            return;
        }
        (delta.metrics || []).forEach((m) => {
            if (!m || m.name === undefined) return;
            const key = keyOf(delta.groupId, delta.edgeNodeId, delta.deviceId, m.name);
            this._setMetric(key, m, true);
            this._markDirty(key);
        });
    }

    // --- clients --------------------------------------------------------------

    /**
     * @param {{sendText: function(string), sendBinary: function(Buffer), bufferedAmount: function(): number}} transport
     */
    addClient(transport) {
        const client = {
            transport,
            opened: false,
            rpi: this.defaultRpi,
            keys: new Set(),
            all: false,
            indexOf: new Map(),   // key -> idx
            sentMetaVer: new Map(), // key -> metaVer the client has
            nextIdx: 0,
            dirty: new Set(),
            full: true,
            lastSent: 0,
            timer: null,
            framesSent: 0,
            cyclesSkipped: 0
        };
        this.clients.add(client);
        return client;
    }

    removeClient(client) {
        if (client.timer) clearInterval(client.timer);
        client.timer = null;
        this._unsubscribe(client);
        this.clients.delete(client);
    }

    _unsubscribe(client) {
        client.keys.forEach((k) => {
            const s = this.keyClients.get(k);
            if (s) { s.delete(client); if (!s.size) this.keyClients.delete(k); }
        });
        client.keys = new Set();
        this.allClients.delete(client);
        client.all = false;
    }

    _subscribe(client, keys) {
        const previous = client.keys;
        this._unsubscribe(client);
        if (keys === "*") {
            client.all = true;
            this.allClients.add(client);
            client.full = true;
            return;
        }
        (Array.isArray(keys) ? keys : []).forEach((k) => {
            if (typeof k !== "string" || !k) return;
            client.keys.add(k);
            if (!this.keyClients.has(k)) this.keyClients.set(k, new Set());
            this.keyClients.get(k).add(client);
            if (!previous.has(k)) client.dirty.add(k); // newly subscribed: send its current value
        });
    }

    /** A parsed text (JSON) message from the client. */
    handleText(client, msg) {
        if (!msg || typeof msg !== "object") return;
        if (msg.t === "open") {
            const rpi = Math.max(this.minRpi, Math.min(this.maxRpi, Number(msg.rpi) || this.defaultRpi));
            client.rpi = rpi;
            client.opened = true;
            client.full = true;
            this._subscribe(client, msg.keys);
            client.transport.sendText(JSON.stringify({ t: "opened", rpi, hb: this.hbMs }));
            if (client.timer) clearInterval(client.timer);
            client.timer = setInterval(() => this.tick(client), rpi);
            this.tick(client); // first (full) frame right away, not one RPI later
            return;
        }
        if (msg.t === "sub") {
            this._subscribe(client, msg.keys);
            return;
        }
        if (msg.t === "w") {
            this.onWrite(client, msg);
        }
    }

    /** One producer cycle for one client. Exposed for tests. */
    tick(client) {
        if (!client.opened) return;
        if (client.transport.bufferedAmount() > this.highWater) { client.cyclesSkipped++; return; }
        const now = Date.now();
        if (!client.full && client.dirty.size === 0 && now - client.lastSent < this.hbMs) return;

        let keys;
        if (client.full) keys = client.all ? Array.from(this.cache.keys()) : Array.from(client.keys);
        else keys = Array.from(client.dirty);

        const layoutAdd = [];
        const items = [];
        for (const key of keys) {
            const entry = this.cache.get(key);
            let idx = client.indexOf.get(key);
            if (idx === undefined) {
                if (client.nextIdx > MAX_INDEX) continue;
                idx = client.nextIdx++;
                client.indexOf.set(key, idx);
            }
            const ver = entry ? entry.metaVer : 0;
            if (client.sentMetaVer.get(key) !== ver) {
                client.sentMetaVer.set(key, ver);
                layoutAdd.push([idx, key, entry ? entry.type : null, entry ? entry.engUnit : null,
                    entry ? entry.properties : null, entry ? entry.metadata : null]);
            }
            items.push({ idx, entry });
        }
        const full = client.full;
        client.full = false;
        client.dirty.clear();
        client.lastSent = now;
        if (layoutAdd.length) client.transport.sendText(JSON.stringify({ t: "layout", add: layoutAdd }));
        client.transport.sendBinary(encodeDataFrame(items, { full, now }));
        client.framesSent++;
    }

    close() {
        Array.from(this.clients).forEach((c) => this.removeClient(c));
    }
}

module.exports = { IoHub, keyOf };
