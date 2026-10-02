// Nexa IO wire protocol — deployed screen <-> screen worker, one WebSocket per
// page at RUNTIME_PREFIX + "/_io". Modelled on EtherNet/IP:
//
//   "Forward_Open"  client -> server text  {"t":"open","rpi":20,"keys":[...]}
//                   (keys = "group::edge::device::metric", only the tags this
//                   screen actually uses; "*" = every tag). Re-send {"t":"sub",
//                   "keys":[...]} whenever the screen's tag set changes.
//                   server -> client text  {"t":"opened","rpi":20,"hb":1000}
//   Layout          server -> client text  {"t":"layout","add":[[idx,key,type,engUnit,properties,metadata],...]}
//                   always sent BEFORE the first data frame that uses those indexes;
//                   re-sent for an index whenever its type/engUnit/properties/metadata change.
//   Implicit data   server -> client BINARY, every RPI, only tags that changed since
//                   the last frame this client actually received, LATEST VALUE WINS:
//                   a client whose socket is backed up simply skips cycles (no
//                   backlog, like a dropped UDP datagram) and gets the newest
//                   values on the next cycle it can take. An empty frame every
//                   `hb` ms is the heartbeat/watchdog feed.
//   Explicit write  client -> server text  {"t":"w","id":7,"g":..,"e":..,"d":..,"m":[{"n":name,"v":value}]}
//                   server -> client text  {"t":"ack","id":7,"ok":true|false,"err":"..."}
//
// Binary data frame (little-endian):
//   u8  kind      = 1
//   u8  flags     bit0 = FULL (every subscribed tag included — first frame / resync)
//   u16 count
//   f64 baseTs    ms epoch; entry timestamps are i32 offsets from this
//   count x entry:
//     u16 idx
//     u8  vtype   low 7 bits = value type (below), bit7 = timestamp follows
//     [i32 tsOffset]                 if bit7
//     value                          per type:
//       0 OFFLINE (no value; device/node dead or never seen)   —
//       1 NULL (isNull)                                        —
//       2 FALSE / 3 TRUE                                       —
//       4 INT32                                                i32
//       5 FLOAT64                                              f64
//       6 STRING                                               u16 len + utf8
//       7 JSON (arrays/objects/anything else)                  u32 len + utf8
//
// A Sparkplug number that is not a safe int32 goes as FLOAT64; Int64/UInt64 values
// that arrive as strings stay STRING — exactly what the page already displays.

const KIND_DATA = 1;
const FLAG_FULL = 1;
const HEADER_BYTES = 12;

const V = { OFFLINE: 0, NULL: 1, FALSE: 2, TRUE: 3, INT32: 4, FLOAT64: 5, STRING: 6, JSON: 7 };
const HAS_TS = 0x80;
const MAX_STRING = 0xFFFF;

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
        const buf = Buffer.from(v, "utf8");
        if (buf.length <= MAX_STRING) return { t: V.STRING, buf };
        return { t: V.JSON, buf: Buffer.from(JSON.stringify(v), "utf8") };
    }
    return { t: V.JSON, buf: Buffer.from(JSON.stringify(v), "utf8") };
}

/**
 * @param {Array<{idx:number, entry:object}>} items - entry = {value,isNull,online,timestamp}
 * @param {{full?: boolean, now?: number}} [opts]
 * @returns {Buffer}
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
        else if (c.t === V.STRING) bytes += 2 + c.buf.length;
        else if (c.t === V.JSON) bytes += 4 + c.buf.length;
        parts.push({ idx: it.idx, c, tsOff, bytes });
        size += bytes;
    }
    const out = Buffer.allocUnsafe(size);
    out.writeUInt8(KIND_DATA, 0);
    out.writeUInt8(opts.full ? FLAG_FULL : 0, 1);
    out.writeUInt16LE(parts.length, 2);
    out.writeDoubleLE(baseTs, 4);
    let o = HEADER_BYTES;
    for (const p of parts) {
        out.writeUInt16LE(p.idx, o); o += 2;
        out.writeUInt8(p.c.t | (p.tsOff !== null ? HAS_TS : 0), o); o += 1;
        if (p.tsOff !== null) { out.writeInt32LE(p.tsOff, o); o += 4; }
        switch (p.c.t) {
            case V.INT32: out.writeInt32LE(p.c.v, o); o += 4; break;
            case V.FLOAT64: out.writeDoubleLE(p.c.v, o); o += 8; break;
            case V.STRING: out.writeUInt16LE(p.c.buf.length, o); o += 2; p.c.buf.copy(out, o); o += p.c.buf.length; break;
            case V.JSON: out.writeUInt32LE(p.c.buf.length, o); o += 4; p.c.buf.copy(out, o); o += p.c.buf.length; break;
            default: break;
        }
    }
    return out;
}

/** Reference decoder (the browser has its own copy in nexa-runtime-client.js). */
function decodeDataFrame(buf) {
    if (buf.readUInt8(0) !== KIND_DATA) throw new Error("not a data frame");
    const flags = buf.readUInt8(1);
    const count = buf.readUInt16LE(2);
    const baseTs = buf.readDoubleLE(4);
    let o = HEADER_BYTES;
    const entries = [];
    for (let i = 0; i < count; i++) {
        const idx = buf.readUInt16LE(o); o += 2;
        const tb = buf.readUInt8(o); o += 1;
        const t = tb & 0x7F;
        let timestamp;
        if (tb & HAS_TS) { timestamp = baseTs + buf.readInt32LE(o); o += 4; }
        const e = { idx, online: t !== V.OFFLINE, isNull: t === V.NULL, value: null, timestamp };
        switch (t) {
            case V.FALSE: e.value = false; break;
            case V.TRUE: e.value = true; break;
            case V.INT32: e.value = buf.readInt32LE(o); o += 4; break;
            case V.FLOAT64: e.value = buf.readDoubleLE(o); o += 8; break;
            case V.STRING: { const n = buf.readUInt16LE(o); o += 2; e.value = buf.toString("utf8", o, o + n); o += n; break; }
            case V.JSON: { const n = buf.readUInt32LE(o); o += 4; e.value = JSON.parse(buf.toString("utf8", o, o + n)); o += n; break; }
            default: break;
        }
        entries.push(e);
    }
    return { full: Boolean(flags & FLAG_FULL), baseTs, entries };
}

module.exports = { encodeDataFrame, decodeDataFrame, V, KIND_DATA, FLAG_FULL, HEADER_BYTES };
