// Nexa IO wire format: the deployed page <-> the screen worker, one WebSocket per page at
// RUNTIME_PREFIX + "/_io" (the tags). One copy for both sides: the screen worker require()s
// it (src/server/io/ioHub.js), the page bundle imports it (src/runtime/io/frame.js).
// Plain Uint8Array / DataView / TextEncoder, so it runs in Node and in the browser.
//
// Modelled on EtherNet/IP:
//   "Forward_Open"  page -> server text  {"t":"open","rpi":20,"keys":[...]}
//                   (keys = "group::edge::device::metric", only the tags this screen uses;
//                   "*" = every tag). Re-sent as {"t":"sub","keys":[...]} when the set changes.
//                   server -> page text  {"t":"opened","rpi":20,"hb":1000}
//   Layout          server -> page text  {"t":"layout","add":[[idx,key,type,engUnit,properties,metadata],...]}
//                   always BEFORE the first data frame that uses those indexes; re-sent for an
//                   index when its type / engUnit / properties / metadata change.
//   Implicit data   server -> page BINARY, every RPI, only the tags that changed since the last
//                   frame this page took, LATEST VALUE WINS: a page whose socket is backed up
//                   skips cycles (like a dropped UDP datagram) and gets the newest values next.
//                   An empty frame every `hb` ms is the heartbeat / watchdog feed.
//   Explicit write  page -> server text  {"t":"w","id":7,"g":..,"e":..,"d":..,"m":[{"n":name,"v":value}]}
//                   server -> page text  {"t":"ack","id":7,"ok":true|false,"err":"..."}
//
// Binary data frame (little-endian):
//   u8  kind      = 1
//   u8  flags     bit0 = FULL (every subscribed tag included: first frame / resync)
//   u16 count
//   f64 baseTs    ms epoch; entry timestamps are i32 offsets from this
//   count x entry:
//     u16 idx
//     u8  vtype   low 7 bits = value type (V below), bit7 = a timestamp follows
//     [i32 tsOffset]                              if bit7
//     value, per type:
//       0 OFFLINE (no value: device / node dead or never seen)   —
//       1 NULL (isNull)                                          —
//       2 FALSE / 3 TRUE                                         —
//       4 INT32                                                  i32
//       5 FLOAT64                                                f64
//       6 STRING                                                 u16 len + utf8
//       7 JSON (arrays / objects / a string over 64 KB)          u32 len + utf8
//
// A number that isn't a safe int32 goes as FLOAT64; Int64 / UInt64 values that arrive as
// strings stay STRING, exactly what the page displays.
"use strict";

const KIND_DATA = 1;
const FLAG_FULL = 1;
const HEADER_BYTES = 12;
const V = { OFFLINE: 0, NULL: 1, FALSE: 2, TRUE: 3, INT32: 4, FLOAT64: 5, STRING: 6, JSON: 7 };
const HAS_TS = 0x80;
const MAX_STRING = 0xFFFF;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

function classify(entry) {
    if (!entry || !entry.online) return { t: V.OFFLINE };
    if (entry.isNull || entry.value === null || entry.value === undefined) return { t: V.NULL };
    const v = entry.value;
    if (v === true) return { t: V.TRUE };
    if (v === false) return { t: V.FALSE };
    if (typeof v === "number") {
        if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) return { t: V.INT32, v };
        return { t: V.FLOAT64, v };
    }
    if (typeof v === "string") {
        const bytes = enc.encode(v);
        if (bytes.length <= MAX_STRING) return { t: V.STRING, bytes };
    }
    return { t: V.JSON, bytes: enc.encode(JSON.stringify(v)) };
}

/**
 * @param {Array<{idx:number, entry:object}>} items  entry = {value, isNull, online, timestamp}
 * @param {{full?: boolean, now?: number}} [opts]
 * @returns {Uint8Array}
 */
function encodeDataFrame(items, opts) {
    opts = opts || {};
    const baseTs = opts.now || Date.now();
    const parts = [];
    let size = HEADER_BYTES;
    for (const it of items) {
        const c = classify(it.entry);
        const ts = it.entry && typeof it.entry.timestamp === "number" ? it.entry.timestamp : null;
        let tsOff = null;
        if (ts !== null) {
            const d = Math.round(ts - baseTs);
            if (d >= -2147483648 && d <= 2147483647) tsOff = d;
        }
        let bytes = 3 + (tsOff !== null ? 4 : 0);
        if (c.t === V.INT32) bytes += 4;
        else if (c.t === V.FLOAT64) bytes += 8;
        else if (c.t === V.STRING) bytes += 2 + c.bytes.length;
        else if (c.t === V.JSON) bytes += 4 + c.bytes.length;
        parts.push({ idx: it.idx, c, tsOff });
        size += bytes;
    }
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, KIND_DATA);
    dv.setUint8(1, opts.full ? FLAG_FULL : 0);
    dv.setUint16(2, parts.length, true);
    dv.setFloat64(4, baseTs, true);
    let o = HEADER_BYTES;
    for (const p of parts) {
        dv.setUint16(o, p.idx, true); o += 2;
        dv.setUint8(o, p.c.t | (p.tsOff !== null ? HAS_TS : 0)); o += 1;
        if (p.tsOff !== null) { dv.setInt32(o, p.tsOff, true); o += 4; }
        switch (p.c.t) {
            case V.INT32: dv.setInt32(o, p.c.v, true); o += 4; break;
            case V.FLOAT64: dv.setFloat64(o, p.c.v, true); o += 8; break;
            case V.STRING: dv.setUint16(o, p.c.bytes.length, true); o += 2; out.set(p.c.bytes, o); o += p.c.bytes.length; break;
            case V.JSON: dv.setUint32(o, p.c.bytes.length, true); o += 4; out.set(p.c.bytes, o); o += p.c.bytes.length; break;
            default: break;
        }
    }
    return out;
}

/**
 * A frame (ArrayBuffer, Uint8Array or Buffer) -> {full, baseTs, entries: [{idx, online, isNull, value, timestamp}]}.
 * timestamp is null when the entry has none; a JSON value that doesn't parse becomes null.
 */
function decodeDataFrame(frame) {
    const u8 = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint8(0) !== KIND_DATA) throw new Error("not a data frame");
    const flags = dv.getUint8(1);
    const count = dv.getUint16(2, true);
    const baseTs = dv.getFloat64(4, true);
    let o = HEADER_BYTES;
    const entries = [];
    for (let i = 0; i < count; i++) {
        const idx = dv.getUint16(o, true); o += 2;
        const tb = dv.getUint8(o); o += 1;
        const t = tb & 0x7F;
        let timestamp = null;
        if (tb & HAS_TS) { timestamp = baseTs + dv.getInt32(o, true); o += 4; }
        let value = null;
        switch (t) {
            case V.FALSE: value = false; break;
            case V.TRUE: value = true; break;
            case V.INT32: value = dv.getInt32(o, true); o += 4; break;
            case V.FLOAT64: value = dv.getFloat64(o, true); o += 8; break;
            case V.STRING: {
                const n = dv.getUint16(o, true); o += 2;
                value = dec.decode(u8.subarray(o, o + n)); o += n;
                break;
            }
            case V.JSON: {
                const n = dv.getUint32(o, true); o += 4;
                try { value = JSON.parse(dec.decode(u8.subarray(o, o + n))); } catch (e) { value = null; }
                o += n;
                break;
            }
            default: break;
        }
        entries.push({ idx, online: t !== V.OFFLINE, isNull: t === V.NULL, value, timestamp });
    }
    return { full: Boolean(flags & FLAG_FULL), baseTs, entries };
}

module.exports = { encodeDataFrame, decodeDataFrame, V, KIND_DATA, FLAG_FULL, HEADER_BYTES, HAS_TS, MAX_STRING };
