/**
 * Nexa IO wire protocol — Unified Shared Protocol & Binary Codec.
 * Compatible with both Node.js (Server/IoHub) and Browser (Runtime Client).
 */

export const KIND_DATA = 1;
export const FLAG_FULL = 1;
export const HEADER_BYTES = 12;

export const V = {
    OFFLINE: 0,
    NULL: 1,
    FALSE: 2,
    TRUE: 3,
    INT32: 4,
    FLOAT64: 5,
    STRING: 6,
    JSON: 7
};

export const HAS_TS = 0x80;
export const MAX_STRING = 0xFFFF;

const utf8Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
const utf8Encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function decodeUtf8(bytes) {
    if (utf8Decoder) return utf8Decoder.decode(bytes);
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("utf8");
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (_) { return s; }
}

function encodeUtf8(str) {
    if (utf8Encoder) return utf8Encoder.encode(str);
    if (typeof Buffer !== "undefined") return Buffer.from(str, "utf8");
    const arr = [];
    const encoded = unescape(encodeURIComponent(str));
    for (let i = 0; i < encoded.length; i++) arr.push(encoded.charCodeAt(i));
    return new Uint8Array(arr);
}

/**
 * Universal Binary Frame Decoder.
 * Works on ArrayBuffer, Uint8Array, or Node.js Buffer.
 */
export function decodeDataFrame(buffer) {
    const arrayBuffer = buffer.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;
    const dv = new DataView(arrayBuffer);
    if (dv.getUint8(0) !== KIND_DATA) throw new Error("not a data frame");
    const flags = dv.getUint8(1);
    const count = dv.getUint16(2, true);
    const baseTs = dv.getFloat64(4, true);
    let o = HEADER_BYTES;
    const entries = [];
    const u8 = new Uint8Array(arrayBuffer);

    for (let i = 0; i < count; i++) {
        const idx = dv.getUint16(o, true); o += 2;
        const tb = dv.getUint8(o); o += 1;
        const t = tb & 0x7F;
        let timestamp = null;
        if (tb & HAS_TS) {
            timestamp = baseTs + dv.getInt32(o, true);
            o += 4;
        }
        let value = null;
        switch (t) {
            case V.FALSE: value = false; break;
            case V.TRUE: value = true; break;
            case V.INT32: value = dv.getInt32(o, true); o += 4; break;
            case V.FLOAT64: value = dv.getFloat64(o, true); o += 8; break;
            case V.STRING: {
                const n = dv.getUint16(o, true); o += 2;
                value = decodeUtf8(u8.subarray(o, o + n));
                o += n;
                break;
            }
            case V.JSON: {
                const n = dv.getUint32(o, true); o += 4;
                try {
                    value = JSON.parse(decodeUtf8(u8.subarray(o, o + n)));
                } catch (_) {
                    value = null;
                }
                o += n;
                break;
            }
            default: break;
        }
        entries.push({
            idx,
            online: t !== V.OFFLINE,
            isNull: t === V.NULL,
            value,
            timestamp
        });
    }

    return {
        full: Boolean(flags & FLAG_FULL),
        baseTs,
        entries
    };
}
