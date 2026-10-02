// Nexa Link wire format — the page <-> link worker (src/server/workers/link-worker.js),
// one WebSocket per page at "/nexa/_link" on the link worker's OWN port. Kept
// apart from Nexa IO (/_io, the tags) on purpose: its own TCP connection and its
// own thread, so a 20 MB response can never hold back a tag frame.
//
// CommonJS so the link worker require()s it and the browser bundle imports it
// (esbuild converts it) — ONE copy of the format for both sides.
//
// Every logical message (a request, a response, a push, a send) is cut into
// binary frames of at most CHUNK_BYTES payload each; frames of different
// messages may interleave (round robin), frames of one message arrive in order
// (one WebSocket = one ordered stream).
//
// Frame (little-endian):
//   u8  version    = 1
//   u8  flags      FIRST | LAST | BINARY (payload is raw bytes, else UTF-8 JSON) | DEFLATE
//   u16 metaLen    only on the FIRST frame, else 0
//   u32 msgId      per sender, per connection
//   u32 offset     where this chunk goes in the payload
//   u32 totalLen   payload length (after compression, when DEFLATE)
//   meta           metaLen bytes, UTF-8 JSON: {t, ch, ...} — FIRST frame only
//   chunk          the rest of the frame
//
// Control messages (subscribe, welcome, errors that carry no payload) are text
// frames: JSON {t: ...}. See docs/LINK.md.
"use strict";

const VERSION = 1;
const F_FIRST = 1;
const F_LAST = 2;
const F_BINARY = 4;
const F_DEFLATE = 8;
const HEADER_BYTES = 16;
const CHUNK_BYTES = 64 * 1024;
const MAX_META_BYTES = 4096;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

function utf8(str) { return enc.encode(str); }
function fromUtf8(bytes) { return dec.decode(bytes); }

function encodeFrame(msgId, flags, offset, totalLen, metaBytes, chunk) {
    const metaLen = metaBytes ? metaBytes.length : 0;
    const chunkLen = chunk ? chunk.length : 0;
    const out = new Uint8Array(HEADER_BYTES + metaLen + chunkLen);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, VERSION);
    dv.setUint8(1, flags);
    dv.setUint16(2, metaLen, true);
    dv.setUint32(4, msgId >>> 0, true);
    dv.setUint32(8, offset >>> 0, true);
    dv.setUint32(12, totalLen >>> 0, true);
    if (metaLen) out.set(metaBytes, HEADER_BYTES);
    if (chunkLen) out.set(chunk, HEADER_BYTES + metaLen);
    return out;
}

/** A frame as bytes -> its parts. `chunk` is a view into `u8`, not a copy. Throws on a malformed frame. */
function decodeFrame(u8) {
    if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
    if (u8.length < HEADER_BYTES) throw new Error("link frame too short");
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint8(0) !== VERSION) throw new Error("unknown link frame version " + dv.getUint8(0));
    const flags = dv.getUint8(1);
    const metaLen = dv.getUint16(2, true);
    if (metaLen > MAX_META_BYTES || HEADER_BYTES + metaLen > u8.length) throw new Error("bad link frame meta length");
    if (metaLen && !(flags & F_FIRST)) throw new Error("meta on a non-first link frame");
    let meta = null;
    if (metaLen) meta = JSON.parse(fromUtf8(u8.subarray(HEADER_BYTES, HEADER_BYTES + metaLen)));
    return {
        flags: flags,
        msgId: dv.getUint32(4, true),
        offset: dv.getUint32(8, true),
        totalLen: dv.getUint32(12, true),
        meta: meta,
        chunk: u8.subarray(HEADER_BYTES + metaLen)
    };
}

/**
 * One outgoing message, sent a chunk at a time: next() returns the next frame
 * until `done`. `bytes` is the (already encoded / compressed) payload.
 */
class OutMessage {
    constructor(msgId, meta, bytes, flags) {
        this.msgId = msgId;
        this.meta = meta;
        this.metaBytes = utf8(JSON.stringify(meta));
        if (this.metaBytes.length > MAX_META_BYTES) throw new Error("link message meta larger than " + MAX_META_BYTES + " bytes");
        this.bytes = bytes || new Uint8Array(0);
        this.flags = flags & (F_BINARY | F_DEFLATE);
        this.offset = 0;
        this.started = false;
        this.done = false;
    }
    get remaining() { return this.bytes.length - this.offset; }
    next(chunkBytes) {
        const size = Math.min(chunkBytes || CHUNK_BYTES, this.remaining);
        const first = !this.started;
        const last = this.offset + size >= this.bytes.length;
        const flags = this.flags | (first ? F_FIRST : 0) | (last ? F_LAST : 0);
        const frame = encodeFrame(this.msgId, flags, this.offset, this.bytes.length,
            first ? this.metaBytes : null, this.bytes.subarray(this.offset, this.offset + size));
        this.started = true;
        this.offset += size;
        if (last) this.done = true;
        return frame;
    }
}

/** Every frame of one message, at once (the browser sends its few uploads this way). */
function encodeMessage(msgId, meta, bytes, flags, chunkBytes) {
    const m = new OutMessage(msgId, meta, bytes, flags);
    const frames = [];
    while (!m.done) frames.push(m.next(chunkBytes));
    return frames;
}

/**
 * Puts the frames of interleaved messages back together.
 *   limitFor(meta) -> max payload bytes for that message (0 = refuse it)
 *   opts.maxPendingBytes  sum of all half-received messages' sizes
 * push(frame) returns null (more to come), {msgId, meta, flags, bytes} (complete;
 * `bytes` is a fresh Uint8Array that owns its ArrayBuffer — transferable), or
 * {msgId, meta, error} (refused; later frames of that msgId are dropped quietly).
 */
class Reassembler {
    constructor(limitFor, opts) {
        this.limitFor = limitFor || function () { return 32 * 1024 * 1024; };
        this.maxPendingBytes = (opts && opts.maxPendingBytes) || 64 * 1024 * 1024;
        this.pending = new Map(); // msgId -> {meta, flags, buf, received}
        this.refused = new Set();
        this.pendingBytes = 0;
    }
    push(u8) {
        const f = decodeFrame(u8);
        if (f.flags & F_FIRST) {
            this.refused.delete(f.msgId);
            if (this.pending.has(f.msgId)) this._drop(f.msgId);
            const limit = this.limitFor(f.meta || {});
            let error = null;
            if (!limit) error = "unknown channel";
            else if (f.totalLen > limit) error = "message is " + f.totalLen + " bytes, the channel allows " + limit;
            else if (this.pendingBytes + f.totalLen > this.maxPendingBytes) error = "too much data in flight";
            if (error) {
                if (!(f.flags & F_LAST)) this.refused.add(f.msgId);
                return { msgId: f.msgId, meta: f.meta, error: error };
            }
            if (f.flags & F_LAST && f.offset === 0 && f.chunk.length === f.totalLen) {
                return { msgId: f.msgId, meta: f.meta, flags: f.flags, bytes: f.chunk.slice() };
            }
            this.pending.set(f.msgId, { meta: f.meta, flags: f.flags, buf: new Uint8Array(f.totalLen), received: 0 });
            this.pendingBytes += f.totalLen;
        }
        if (this.refused.has(f.msgId)) {
            if (f.flags & F_LAST) this.refused.delete(f.msgId);
            return null;
        }
        const p = this.pending.get(f.msgId);
        if (!p) return null; // its start was dropped (cancel / reset): ignore the rest
        if (f.offset !== p.received || p.received + f.chunk.length > p.buf.length) {
            this._drop(f.msgId);
            return { msgId: f.msgId, meta: p.meta, error: "link frames out of order" };
        }
        p.buf.set(f.chunk, p.received);
        p.received += f.chunk.length;
        if (f.flags & F_LAST) {
            this._drop(f.msgId);
            if (p.received !== p.buf.length) return { msgId: f.msgId, meta: p.meta, error: "link message truncated" };
            return { msgId: f.msgId, meta: p.meta, flags: p.flags, bytes: p.buf };
        }
        return null;
    }
    _drop(msgId) {
        const p = this.pending.get(msgId);
        if (!p) return;
        this.pending.delete(msgId);
        this.pendingBytes -= p.buf.length;
    }
    clear() { this.pending.clear(); this.refused.clear(); this.pendingBytes = 0; }
}

module.exports = {
    VERSION, F_FIRST, F_LAST, F_BINARY, F_DEFLATE, HEADER_BYTES, CHUNK_BYTES, MAX_META_BYTES,
    utf8, fromUtf8, encodeFrame, decodeFrame, encodeMessage, OutMessage, Reassembler
};
