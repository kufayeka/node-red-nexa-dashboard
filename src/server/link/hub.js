// Nexa Link hub — the link worker's state, transport-agnostic (tests drive it
// with fake transports, like IoHub). Wire format: src/shared/link/frame.js.
//
// Clients: one per page WebSocket. Channels: the deployed kufayeka-nexa-channel
// config nodes, by id. Message kinds (meta.t):
//   page -> hub   "req"  {ch, screen}   a Request node: the flow answers with a "to Nexa" node
//                 "send" {ch, screen}   a To Node-RED node: fire and forget
//   hub -> page   "res"  {re, err?}     the answer to request `re` (err: it failed)
//                 "push" {ch}           a "to Nexa" node, to every subscriber or one client
//   text          {t:"sub", ch:[ids]}   the channels this page listens to (replaces the list)
//                 {t:"welcome", id, channels} / {t:"channels", channels} / {t:"error", re, err} / {t:"gap", ch}
//
// Sending is paced per client: frames go out only while the socket has less than
// `highWater` bytes queued, round robin between messages, so one big response
// doesn't hold back a small one behind it. Each frame's write callback pumps again.
"use strict";

const { OutMessage, Reassembler, F_BINARY, F_DEFLATE, CHUNK_BYTES } = require("../../shared/link/frame.js");

const DEFAULTS = {
    chunkBytes: CHUNK_BYTES,
    highWater: 256 * 1024,
    maxQueueBytes: 64 * 1024 * 1024,
    maxInflight: 8,
    maxSubs: 256,
    compressMinBytes: 16 * 1024
};

function channelView(ch) {
    return { name: ch.name, timeout: ch.timeout, maxBytes: ch.maxBytes };
}

class LinkHub {
    /**
     * @param {object} opts
     * @param {function(object)} opts.onFromNexa  {kind:"req"|"send", ch, rid?, client, screen, ip, binary, bytes:Uint8Array}
     * @param {function(Uint8Array):Promise<Uint8Array>} [opts.compress]  deflate-raw; absent = never compress
     */
    constructor(opts) {
        opts = opts || {};
        Object.keys(DEFAULTS).forEach((k) => { this[k] = opts[k] || DEFAULTS[k]; });
        this.onFromNexa = opts.onFromNexa || function () {};
        this.compress = opts.compress || null;
        this.channels = new Map(); // id -> {id, name, maxBytes, timeout, delivery, retain, compress}
        this.retained = new Map(); // channel id -> prepared payload
        this.chains = new Map();   // channel id -> promise: keeps a channel's messages in order while compressing
        this.clients = new Set();
        this.byId = new Map();
        this.pending = new Map();  // rid -> {client, re, timer}
        this.nextClient = 0;
        this.nextRid = 0;
        this.stats = { framesOut: 0, bytesOut: 0, messagesIn: 0, dropped: 0 };
    }

    // ---- channels (from the main thread) ----

    setChannel(ch) {
        const prev = this.channels.get(ch.id);
        const clean = {
            id: String(ch.id),
            name: String(ch.name || ch.id),
            maxBytes: Math.max(1024, Number(ch.maxBytes) || 32 * 1024 * 1024),
            timeout: Math.max(100, Number(ch.timeout) || 10000),
            delivery: ch.delivery === "latest" ? "latest" : "queue",
            retain: !!ch.retain,
            compress: ch.compress === "auto" ? "auto" : "off"
        };
        this.channels.set(clean.id, clean);
        if (!clean.retain) this.retained.delete(clean.id);
        if (!prev || prev.name !== clean.name || prev.timeout !== clean.timeout || prev.maxBytes !== clean.maxBytes) this._broadcastChannels();
    }

    removeChannel(id) {
        if (!this.channels.delete(id)) return;
        this.retained.delete(id);
        this._broadcastChannels();
    }

    _channelsView() {
        const out = {};
        this.channels.forEach((ch, id) => { out[id] = channelView(ch); });
        return out;
    }

    _broadcastChannels() {
        const text = JSON.stringify({ t: "channels", channels: this._channelsView() });
        this.clients.forEach((c) => c.transport.sendText(text));
    }

    // ---- clients ----

    /**
     * @param {{sendText:function(string), sendBinary:function(Uint8Array, function()), bufferedAmount:function():number}} transport
     * @param {{ip?:string, deflate?:boolean}} [info]
     */
    addClient(transport, info) {
        info = info || {};
        const client = {
            id: "c" + (++this.nextClient),
            transport: transport,
            ip: info.ip || "",
            deflate: !!info.deflate,
            subs: new Set(),
            queue: [],
            queuedBytes: 0,
            rr: 0,
            pumping: false,
            nextMsg: 0,
            inflight: 0,
            reassembler: null
        };
        client.reassembler = new Reassembler((meta) => {
            const ch = this.channels.get(meta && meta.ch);
            return ch ? ch.maxBytes : 0;
        });
        this.clients.add(client);
        this.byId.set(client.id, client);
        transport.sendText(JSON.stringify({ t: "welcome", id: client.id, channels: this._channelsView() }));
        return client;
    }

    removeClient(client) {
        if (!this.clients.delete(client)) return;
        this.byId.delete(client.id);
        client.queue = [];
        client.queuedBytes = 0;
        client.reassembler.clear();
        this.pending.forEach((p, rid) => {
            if (p.client === client) { clearTimeout(p.timer); this.pending.delete(rid); }
        });
    }

    handleText(client, msg) {
        if (!msg || typeof msg !== "object") return;
        if (msg.t === "sub") {
            const list = Array.isArray(msg.ch) ? msg.ch.filter((c) => typeof c === "string" && c).slice(0, this.maxSubs) : [];
            const before = client.subs;
            client.subs = new Set(list);
            client.subs.forEach((id) => {
                if (before.has(id)) return;
                const r = this.retained.get(id);
                if (r) this._enqueue(client, { t: "push", ch: id, retained: true }, r, id);
            });
        }
    }

    handleBinary(client, u8) {
        let got;
        try { got = client.reassembler.push(u8); } catch (e) { return; } // malformed frame: ignore it
        if (!got) return;
        const meta = got.meta || {};
        if (got.error) { this._refuse(client, got.msgId, meta, got.error); return; }
        this.stats.messagesIn++;
        const ch = this.channels.get(meta.ch);
        if (!ch) { this._refuse(client, got.msgId, meta, "unknown channel"); return; }
        if (got.flags & F_DEFLATE) { this._refuse(client, got.msgId, meta, "compressed uploads are not supported"); return; }
        const base = {
            ch: ch.id, client: client.id, ip: client.ip,
            screen: typeof meta.screen === "string" ? meta.screen : "",
            binary: !!(got.flags & F_BINARY), bytes: got.bytes
        };
        if (meta.t === "req") {
            if (client.inflight >= this.maxInflight) { this._refuse(client, got.msgId, meta, "too many requests in flight (max " + this.maxInflight + ")"); return; }
            const rid = ++this.nextRid;
            client.inflight++;
            const timer = setTimeout(() => {
                if (!this.pending.has(rid)) return;
                this.pending.delete(rid);
                client.inflight--;
                this._enqueue(client, { t: "res", re: got.msgId, err: "timeout: no answer from the flow within " + ch.timeout + " ms" }, null, null);
            }, ch.timeout);
            if (timer.unref) timer.unref();
            this.pending.set(rid, { client: client, re: got.msgId, timer: timer });
            this.onFromNexa(Object.assign({ kind: "req", rid: rid }, base));
        } else if (meta.t === "send") {
            this.onFromNexa(Object.assign({ kind: "send" }, base));
        } else {
            this._refuse(client, got.msgId, meta, "unknown message type " + JSON.stringify(meta.t));
        }
    }

    _refuse(client, msgId, meta, err) {
        if (meta && meta.t === "req") this._enqueue(client, { t: "res", re: msgId, err: err }, null, null);
        else client.transport.sendText(JSON.stringify({ t: "error", re: msgId, err: err }));
    }

    // ---- to Nexa (from the main thread) ----

    /**
     * @param {object} m  {target:"reply"|"all"|"client", ch?, rid?, client?, error?, binary, bytes:Uint8Array}
     * @returns {{ok:boolean, error?:string, delivered?:number}}
     */
    toNexa(m) {
        if (m.target === "reply") {
            const p = this.pending.get(m.rid);
            if (!p) return { ok: false, error: "the request is no longer waiting (answered already, timed out or the page left)" };
            this.pending.delete(m.rid);
            clearTimeout(p.timer);
            p.client.inflight--;
            if (!this.clients.has(p.client)) return { ok: false, error: "the page left" };
            const meta = m.error ? { t: "res", re: p.re, err: String(m.error) } : { t: "res", re: p.re };
            const ch = this.channels.get(m.ch) || null;
            this._send(ch, [p.client], meta, m.error ? null : m);
            return { ok: true, delivered: 1 };
        }
        const ch = this.channels.get(m.ch);
        if (!ch) return { ok: false, error: "unknown channel" };
        let targets;
        if (m.target === "client") {
            const c = this.byId.get(m.client);
            targets = c ? [c] : [];
        } else {
            targets = [];
            this.clients.forEach((c) => { if (c.subs.has(ch.id)) targets.push(c); });
        }
        const prepared = this._send(ch, targets, { t: "push", ch: ch.id }, m);
        if (ch.retain && m.target !== "client") prepared.then((p) => { if (this.channels.get(ch.id) === ch) this.retained.set(ch.id, p); });
        return { ok: true, delivered: targets.length };
    }

    // Prepare a payload once (compress once, whatever the number of clients), then queue it per client, in channel order.
    _send(ch, clients, meta, m) {
        const raw = m ? { bytes: m.bytes || new Uint8Array(0), flags: m.binary ? F_BINARY : 0 } : { bytes: new Uint8Array(0), flags: 0 };
        const prepared = { raw: raw, deflated: null };
        const wantDeflate = ch && ch.compress === "auto" && this.compress && raw.bytes.length >= this.compressMinBytes &&
            clients.some((c) => c.deflate);
        const key = ch ? ch.id : "";
        const prev = this.chains.get(key) || Promise.resolve();
        const ready = prev.then(() => {
            if (!wantDeflate) return prepared;
            return this.compress(raw.bytes).then((z) => {
                if (z && z.length < raw.bytes.length) prepared.deflated = { bytes: z, flags: raw.flags | F_DEFLATE };
                return prepared;
            }, () => prepared);
        });
        const done = ready.then((p) => {
            clients.forEach((c) => { if (this.clients.has(c)) this._enqueue(c, meta, p, key); });
            return p;
        });
        this.chains.set(key, done.then(() => {}, () => {}));
        return done;
    }

    _enqueue(client, meta, prepared, chId) {
        const body = prepared ? ((client.deflate && prepared.deflated) || prepared.raw) : { bytes: new Uint8Array(0), flags: 0 };
        const ch = chId ? this.channels.get(chId) : null;
        if (meta.t === "push" && ch && ch.delivery === "latest") {
            for (let i = 0; i < client.queue.length; i++) {
                const q = client.queue[i];
                if (!q.started && q.meta.t === "push" && q.meta.ch === meta.ch) {
                    client.queuedBytes -= q.bytes.length;
                    client.queue.splice(i, 1);
                    if (client.rr > i) client.rr--;
                    break;
                }
            }
        }
        if (client.queuedBytes + body.bytes.length > this.maxQueueBytes) {
            this.stats.dropped++;
            if (meta.t === "res") meta = { t: "res", re: meta.re, err: "the page is too slow to take this answer" };
            else { client.transport.sendText(JSON.stringify({ t: "gap", ch: meta.ch })); return; }
            this._push(client, new OutMessage(++client.nextMsg, meta, null, 0));
            return;
        }
        this._push(client, new OutMessage(++client.nextMsg, meta, body.bytes, body.flags));
    }

    _push(client, out) {
        client.queue.push(out);
        client.queuedBytes += out.bytes.length;
        this.pump(client);
    }

    pump(client) {
        if (client.pumping || !this.clients.has(client)) return;
        client.pumping = true;
        try {
            while (client.queue.length && client.transport.bufferedAmount() < this.highWater) {
                if (client.rr >= client.queue.length) client.rr = 0;
                const m = client.queue[client.rr];
                const before = m.remaining;
                const frame = m.next(this.chunkBytes);
                client.queuedBytes -= before - m.remaining;
                this.stats.framesOut++;
                this.stats.bytesOut += frame.length;
                client.transport.sendBinary(frame, () => this.pump(client));
                if (m.done) client.queue.splice(client.rr, 1);
                else client.rr++;
            }
        } finally {
            client.pumping = false;
        }
    }

    close() {
        Array.from(this.clients).forEach((c) => this.removeClient(c));
    }
}

module.exports = { LinkHub, DEFAULTS };
