// Full Sparkplug B payload codec — loads the OFFICIAL sparkplug_b.proto
// schema (verbatim from Eclipse Tahu, see sparkplug_b.proto in this same
// directory) via `protobufjs`, instead of depending on the "sparkplug-payload"
// npm package: that package pulls in a long-unpatched protobufjs (<=7.6.2)
// carrying several open CRITICAL CVEs (prototype pollution, code injection,
// DoS via crafted input — see this package's package.json) with no fix
// available from its maintainer. Since this codec decodes payloads arriving
// over the network (from whatever else publishes onto the Sparkplug MQTT
// bus — not just this repo's own asset engine, but any real Edge Node,
// Ignition included), building on a patched, current protobufjs instead is
// a real security requirement here, not just a preference.
//
// Deliberately its own copy, not a shared dependency on
// @kufayeka/node-red-asset-engine's identical-in-spirit codec (see
// ../../nodes/nexa-sparkplug.js's own header comment on why this package
// keeps no hard dependency on that one) — but kept in sync with it feature
// for feature, since this is a passive listener/tag-browser that has to be
// able to decode whatever ANY Sparkplug participant on the bus publishes,
// not just values this repo's own asset engine produced.
//
// Implements the FULL Sparkplug B DataType matrix (spec §6.4.16, enum 0-34),
// verified against the spec PDF's own §6.4.17 worked byte examples (see
// @kufayeka/node-red-asset-engine's test/lib/sparkplugCodec_spec.js, where
// this same logic was originally verified byte-for-byte) — not just against
// this codec's own round-trip, which can't catch a wrong-but-self-consistent
// encoding.
//
// Two deliberate, documented gaps (both explained where they occur below):
//   1. Int64/UInt64/DateTime precision is bounded by Number.isSafeInteger
//      (2^53-1), not the full 64-bit range — see encodeLongLikeValue's
//      comment. Fine for the values this passive listener actually needs to
//      display (epoch-ms timestamps, ordinary counters).
//   2. PropertySet/PropertySetList (20/21) CANNOT be encoded as a metric's
//      own top-level value at all — the .proto's Payload.Metric.value oneof
//      (lines 200-211) has no propertyset_value/propertysets_value option;
//      those only exist inside PropertyValue (used for a metric's
//      `properties` field, a mechanism this codec doesn't populate). This
//      isn't a shortcut — there is no wire slot to put a value into. (Moot
//      for this file in practice: this node only ever DECODES, see
//      ../../nodes/nexa-sparkplug.js — encodeMetric/encodePayload below are
//      unused here but kept for parity with the asset engine's codec.)
const path = require("path");
const protobuf = require("protobufjs");

const root = protobuf.loadSync(path.join(__dirname, "sparkplug_b.proto"));
const PayloadType = root.lookupType("org.eclipse.tahu.protobuf.Payload");

const DataType = {
  Unknown: 0,
  Int8: 1, Int16: 2, Int32: 3, Int64: 4,
  UInt8: 5, UInt16: 6, UInt32: 7, UInt64: 8,
  Float: 9, Double: 10, Boolean: 11, String: 12, DateTime: 13, Text: 14,
  UUID: 15, DataSet: 16, Bytes: 17, File: 18, Template: 19,
  PropertySet: 20, PropertySetList: 21,
  Int8Array: 22, Int16Array: 23, Int32Array: 24, Int64Array: 25,
  UInt8Array: 26, UInt16Array: 27, UInt32Array: 28, UInt64Array: 29,
  FloatArray: 30, DoubleArray: 31, BooleanArray: 32, StringArray: 33, DateTimeArray: 34
};
const DATA_TYPE_NAME_BY_NUMBER = Object.keys(DataType).reduce(function (acc, name) {
  acc[DataType[name]] = name;
  return acc;
}, {});

// ---------------------------------------------------------------------
// Fixed-width integers (Int8/16/32, UInt8/16/32) — all SIX share exactly
// ONE wire field, `int_value` (a plain protobuf `uint32`), per the .proto
// itself (spec §6.4.17, p.77-78: each one's "Google Protocol Buffer Type"
// is listed as uint32) — the metric's OWN declared datatype is what tells
// a reader how to reinterpret those 32 bits. Two's complement is the only
// sensible, universal convention for the signed ones (matches every real
// Sparkplug implementation, including the Ignition Gateway this codec has
// been verified against).
// ---------------------------------------------------------------------
const INT_BITS = { Int8: 8, Int16: 16, Int32: 32, UInt8: 8, UInt16: 16, UInt32: 32 };
const INT_SIGNED = { Int8: true, Int16: true, Int32: true, UInt8: false, UInt16: false, UInt32: false };

// Wraps `value` into the unsigned representative of its two's-complement
// bit pattern at the given width — e.g. wrapToBits(8, -23) === 233. Used
// both for the scalar int_value wire field AND for each array element
// (Buffer's own writeUInt8/writeUInt16LE/... all expect an unsigned value
// already in range, which this guarantees without ever throwing).
function wrapToBits(bits, value) {
  var mod = Math.pow(2, bits);
  var n = Math.trunc(Number(value)) || 0;
  return ((n % mod) + mod) % mod;
}

function encodeFixedWidthInt(typeName, value) {
  return wrapToBits(INT_BITS[typeName], value) >>> 0;
}

function decodeFixedWidthInt(typeName, wireValue) {
  var bits = INT_BITS[typeName];
  var n = (wireValue >>> 0);
  if (!INT_SIGNED[typeName]) return n; // UInt8/16/32: the wire value already IS the value
  if (bits === 32) return n | 0; // reinterpret as signed 32-bit directly
  var signBit = 1 << (bits - 1);
  return (n ^ signBit) - signBit; // sign-extend an 8/16-bit pattern
}

// ---------------------------------------------------------------------
// 64-bit-ish integers (Int64, UInt64, DateTime) — share ONE wire field,
// `long_value` (a plain protobuf `uint64`). BigInt gives an exact two's-
// complement wire pattern regardless of the JS Number's own precision.
//
// Decode is intentionally simpler (plain Number arithmetic, not BigInt):
// decodePayload's PayloadType.toObject(..., {longs: Number}) has ALREADY
// converted the raw uint64 into a plain JS Number before decodeMetric ever
// sees it, so full 64-bit fidelity is already off the table by that point
// for values outside Number.isSafeInteger (2^53-1) — re-parsing with BigInt
// at this stage couldn't recover precision that step already discarded.
// Fine for the values this passive listener actually needs to display
// (epoch-ms timestamps, ordinary counters).
// ---------------------------------------------------------------------
const LONG_SIGNED = { Int64: true, UInt64: false, DateTime: false };
const TWO_POW_64 = 18446744073709551616; // 2^64

function encodeLongLikeValue(typeName, value) {
  var n;
  try {
    n = BigInt(Math.trunc(Number(value)) || 0);
  } catch (e) {
    n = 0n;
  }
  if (LONG_SIGNED[typeName] && n < 0n) n += 1n << 64n; // two's-complement wrap into the unsigned wire pattern
  n &= (1n << 64n) - 1n;
  // PayloadType.verify() rejects a plain decimal STRING for a uint64 field
  // ("integer|Long expected") even though create()/encode() would silently
  // accept one — protobufjs's own bundled `long` package gives a real Long
  // instance that both verify() and encode() accept, with full 64-bit
  // precision preserved via the string round-trip through BigInt above.
  return protobuf.util.Long.fromString(n.toString(), true);
}

function decodeLongLikeValue(typeName, wireValue) {
  // Prefer the RAW (pre-toObject) Long instance when the caller has one —
  // see decodePayload, which passes this for every TOP-LEVEL metric.
  // `.toSigned()` reinterprets the exact 64-bit bit pattern correctly
  // (e.g. the unsigned wire pattern for -42 -> exactly -42), THEN converts
  // to a Number — the only correct order. Converting to a lossy Number
  // FIRST (the fallback path below) and trying to fix the sign up
  // afterward doesn't work: a small negative Int64's wire pattern is a
  // huge near-2^64 unsigned value, and a plain JS float64 can't represent
  // integers that large exactly, so the "subtract 2^64" correction would
  // itself be applied to an already-corrupted number.
  if (wireValue && typeof wireValue === "object" && typeof wireValue.toSigned === "function") {
    return LONG_SIGNED[typeName] ? wireValue.toSigned().toNumber() : wireValue.toUnsigned().toNumber();
  }
  // Fallback: already collapsed to a plain Number (e.g. by
  // {longs: Number}) — precision for a value very close to the 64-bit
  // boundary may already be unrecoverable by this point (see this
  // function's own header comment); fine for every realistic value this
  // listener actually needs to display.
  var n = Number(wireValue);
  if (LONG_SIGNED[typeName] && n > 9223372036854775807) n -= TWO_POW_64;
  return n;
}

// ---------------------------------------------------------------------
// Bytes / File — plain byte blobs. Accepts a Buffer/Uint8Array/plain byte
// array directly, or a base64 string (the friendliest JSON-safe shape for
// a value coming out of e.g. a calculation script).
// ---------------------------------------------------------------------
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value.map(function (b) { return (Number(b) || 0) & 0xFF; }));
  if (typeof value === "string") {
    try { return Buffer.from(value, "base64"); } catch (e) { return Buffer.from(value, "utf8"); }
  }
  return Buffer.alloc(0);
}

// ---------------------------------------------------------------------
// Array types (22-34) — spec §6.4.17 (p.80-81): "All array types use the
// bytes_value field of the Metric value field. They are simply little-
// endian packed byte arrays" — there is NO native repeated/array field in
// the .proto for these; bytes_value is the only place they can go.
// Byte-for-byte verified against the spec's own worked examples (see
// @kufayeka/node-red-asset-engine's test/lib/sparkplugCodec_spec.js).
// ---------------------------------------------------------------------
function packArray(typeName, values) {
  values = Array.isArray(values) ? values : [];
  switch (typeName) {
    case "Int8Array": case "UInt8Array": {
      var b1 = Buffer.alloc(values.length);
      values.forEach(function (v, i) { b1.writeUInt8(wrapToBits(8, v), i); });
      return b1;
    }
    case "Int16Array": case "UInt16Array": {
      var b2 = Buffer.alloc(values.length * 2);
      values.forEach(function (v, i) { b2.writeUInt16LE(wrapToBits(16, v), i * 2); });
      return b2;
    }
    case "Int32Array": case "UInt32Array": {
      var b3 = Buffer.alloc(values.length * 4);
      values.forEach(function (v, i) { b3.writeUInt32LE(wrapToBits(32, v), i * 4); });
      return b3;
    }
    case "Int64Array": case "UInt64Array": case "DateTimeArray": {
      var b4 = Buffer.alloc(values.length * 8);
      values.forEach(function (v, i) {
        var big;
        // Accepts a BigInt or numeric string element directly, not just a
        // plain Number — needed for full 64-bit precision beyond
        // Number.isSafeInteger (2^53-1), which a plain JS float can't
        // represent exactly.
        try { big = typeof v === "bigint" ? v : BigInt(typeof v === "string" ? v : (Math.trunc(Number(v)) || 0)); } catch (e) { big = 0n; }
        if (big < 0n) big += 1n << 64n;
        big &= (1n << 64n) - 1n;
        b4.writeBigUInt64LE(big, i * 8);
      });
      return b4;
    }
    case "FloatArray": {
      var b5 = Buffer.alloc(values.length * 4);
      values.forEach(function (v, i) { b5.writeFloatLE(Number(v) || 0, i * 4); });
      return b5;
    }
    case "DoubleArray": {
      var b6 = Buffer.alloc(values.length * 8);
      values.forEach(function (v, i) { b6.writeDoubleLE(Number(v) || 0, i * 8); });
      return b6;
    }
    case "BooleanArray": {
      // [spec §6.4.17, p.81]: a 4-byte little-endian count, followed by
      // MSB-first bit-packed bytes.
      var count = values.length;
      var b7 = Buffer.alloc(4 + Math.ceil(count / 8));
      b7.writeUInt32LE(count, 0);
      for (var i7 = 0; i7 < count; i7++) {
        if (values[i7]) {
          var byteIndex = 4 + Math.floor(i7 / 8);
          var bitInByte = 7 - (i7 % 8); // MSB-first within each byte
          b7[byteIndex] |= (1 << bitInByte);
        }
      }
      return b7;
    }
    case "StringArray": {
      // [spec §6.4.17, p.81]: "an array of null terminated strings".
      return Buffer.concat(values.map(function (v) {
        return Buffer.concat([Buffer.from(v === undefined || v === null ? "" : String(v), "utf8"), Buffer.from([0])]);
      }));
    }
    default:
      return Buffer.alloc(0);
  }
}

function unpackArray(typeName, buf) {
  buf = buf || Buffer.alloc(0);
  var out, i;
  switch (typeName) {
    case "Int8Array":
      out = []; for (i = 0; i < buf.length; i++) out.push(buf.readInt8(i)); return out;
    case "UInt8Array":
      out = []; for (i = 0; i < buf.length; i++) out.push(buf.readUInt8(i)); return out;
    case "Int16Array":
      out = []; for (i = 0; i + 2 <= buf.length; i += 2) out.push(buf.readInt16LE(i)); return out;
    case "UInt16Array":
      out = []; for (i = 0; i + 2 <= buf.length; i += 2) out.push(buf.readUInt16LE(i)); return out;
    case "Int32Array":
      out = []; for (i = 0; i + 4 <= buf.length; i += 4) out.push(buf.readInt32LE(i)); return out;
    case "UInt32Array":
      out = []; for (i = 0; i + 4 <= buf.length; i += 4) out.push(buf.readUInt32LE(i)); return out;
    case "Int64Array":
      out = []; for (i = 0; i + 8 <= buf.length; i += 8) out.push(Number(buf.readBigInt64LE(i))); return out;
    case "UInt64Array": case "DateTimeArray":
      out = []; for (i = 0; i + 8 <= buf.length; i += 8) out.push(Number(buf.readBigUInt64LE(i))); return out;
    case "FloatArray":
      out = []; for (i = 0; i + 4 <= buf.length; i += 4) out.push(buf.readFloatLE(i)); return out;
    case "DoubleArray":
      out = []; for (i = 0; i + 8 <= buf.length; i += 8) out.push(buf.readDoubleLE(i)); return out;
    case "BooleanArray": {
      if (buf.length < 4) return [];
      var count = buf.readUInt32LE(0);
      out = [];
      for (i = 0; i < count; i++) {
        var byteIndex = 4 + Math.floor(i / 8);
        var bitInByte = 7 - (i % 8);
        out.push(!!(buf[byteIndex] & (1 << bitInByte)));
      }
      return out;
    }
    case "StringArray": {
      out = [];
      var start = 0;
      for (i = 0; i < buf.length; i++) {
        if (buf[i] === 0) {
          out.push(buf.toString("utf8", start, i));
          start = i + 1;
        }
      }
      return out;
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------
// Shared "scalar oneof" encode/decode — used by DataSet.DataSetValue AND
// Template.Parameter, whose own oneofs (.proto lines 109-117, 82-90) are
// deliberately NARROWER than a top-level Metric's: only int/long/float/
// double/bool/string (no bytes/dataset/template nesting inside a DataSet
// cell or a Template parameter).
// ---------------------------------------------------------------------
function encodeScalarOneof(typeName, value) {
  switch (typeName) {
    case "Int8": case "Int16": case "Int32": case "UInt8": case "UInt16": case "UInt32":
      return { intValue: encodeFixedWidthInt(typeName, value) };
    case "Int64": case "UInt64": case "DateTime":
      return { longValue: encodeLongLikeValue(typeName, value) };
    case "Float":
      return { floatValue: Math.fround(Number(value) || 0) };
    case "Double":
      return { doubleValue: Number(value) || 0 };
    case "Boolean":
      return { booleanValue: !!value };
    default: // String, Text, UUID, and anything else not modeled here
      return { stringValue: value === undefined || value === null ? "" : String(value) };
  }
}

function decodeScalarOneof(typeName, raw) {
  switch (typeName) {
    case "Int8": case "Int16": case "Int32": case "UInt8": case "UInt16": case "UInt32":
      return decodeFixedWidthInt(typeName, raw.intValue);
    case "Int64": case "UInt64": case "DateTime":
      return decodeLongLikeValue(typeName, raw.longValue);
    case "Float":
      return raw.floatValue;
    case "Double":
      return raw.doubleValue;
    case "Boolean":
      return !!raw.booleanValue;
    default:
      return raw.stringValue;
  }
}

function sparkplugTypeNumber(typeName) {
  return Object.prototype.hasOwnProperty.call(DataType, typeName) ? DataType[typeName] : DataType.String;
}

// ---------------------------------------------------------------------
// DataSet (16) — a friendlier JS shape than the raw .proto message:
//   { columns: ["a","b"], types: ["Int32","String"], rows: [[1,"x"],[2,"y"]] }
// ---------------------------------------------------------------------
function encodeDataSet(value) {
  value = value || {};
  var columns = Array.isArray(value.columns) ? value.columns : [];
  var types = Array.isArray(value.types) ? value.types : [];
  var rows = Array.isArray(value.rows) ? value.rows : [];
  return {
    numOfColumns: columns.length,
    columns: columns,
    types: types.map(sparkplugTypeNumber),
    rows: rows.map(function (rowArr) {
      return { elements: (rowArr || []).map(function (cellVal, i) { return encodeScalarOneof(types[i] || "String", cellVal); }) };
    })
  };
}

function decodeDataSet(raw) {
  var columns = raw.columns || [];
  var typeNames = (raw.types || []).map(function (num) { return DATA_TYPE_NAME_BY_NUMBER[num] || "String"; });
  var rows = (raw.rows || []).map(function (row) {
    return (row.elements || []).map(function (el, i) { return decodeScalarOneof(typeNames[i] || "String", el); });
  });
  return { columns: columns, types: typeNames, rows: rows };
}

// ---------------------------------------------------------------------
// Template (19) — Template.metrics is `repeated Metric` (.proto line 98),
// literally the SAME message type as a top-level metric, so encoding/
// decoding it recurses straight back into encodeMetric/decodeMetric below
// rather than needing a second, parallel metric encoder.
// ---------------------------------------------------------------------
function encodeTemplate(value) {
  value = value || {};
  var out = { isDefinition: !!value.isDefinition };
  if (value.version !== undefined && value.version !== null) out.version = String(value.version);
  if (value.templateRef !== undefined && value.templateRef !== null) out.templateRef = String(value.templateRef);
  out.metrics = (value.metrics || []).map(encodeMetric);
  out.parameters = (value.parameters || []).map(function (p) {
    return Object.assign(
      { name: p.name, type: sparkplugTypeNumber(p.type || "String") },
      encodeScalarOneof(p.type || "String", p.value)
    );
  });
  return out;
}

function decodeTemplate(raw) {
  return {
    version: raw.version,
    templateRef: raw.templateRef,
    isDefinition: !!raw.isDefinition,
    metrics: (raw.metrics || []).map(decodeMetric),
    parameters: (raw.parameters || []).map(function (p) {
      var typeName = DATA_TYPE_NAME_BY_NUMBER[p.type] || "String";
      return { name: p.name, type: typeName, value: decodeScalarOneof(typeName, p) };
    })
  };
}

function encodeMetric(metric) {
  var typeName = metric.type || "String";
  var datatype = sparkplugTypeNumber(typeName);
  var raw = { name: metric.name, datatype: datatype };
  if (metric.timestamp !== undefined && metric.timestamp !== null) raw.timestamp = metric.timestamp;

  // [tck-id-operational-behavior-data-publish-nbirth-values] (and the
  // DBIRTH/NDATA/DDATA equivalents): a metric whose value is genuinely
  // null/missing MUST set isNull=true and MUST NOT have a value field at
  // all — NOT a fake ""/0/false standing in for "no value".
  if (metric.isNull) {
    raw.isNull = true;
    return raw;
  }

  // protobufjs auto-camelCases the .proto's snake_case field names
  // (double_value -> doubleValue) — Type.create() silently drops any key
  // that doesn't match, which is why every branch below uses the
  // camelCase spelling, not the .proto's own.
  switch (typeName) {
    case "Int8": case "Int16": case "Int32": case "UInt8": case "UInt16": case "UInt32":
      raw.intValue = encodeFixedWidthInt(typeName, metric.value);
      break;
    case "Int64": case "UInt64": case "DateTime":
      raw.longValue = encodeLongLikeValue(typeName, metric.value);
      break;
    case "Float":
      raw.floatValue = Math.fround(Number(metric.value) || 0);
      break;
    case "Double":
      raw.doubleValue = Number(metric.value) || 0;
      break;
    case "Boolean":
      raw.booleanValue = !!metric.value;
      break;
    case "UUID":
      raw.stringValue = metric.value === undefined || metric.value === null ? "" : String(metric.value);
      break;
    case "Bytes": case "File":
      raw.bytesValue = toBuffer(metric.value);
      break;
    case "Int8Array": case "Int16Array": case "Int32Array": case "Int64Array":
    case "UInt8Array": case "UInt16Array": case "UInt32Array": case "UInt64Array":
    case "FloatArray": case "DoubleArray": case "BooleanArray": case "StringArray": case "DateTimeArray":
      raw.bytesValue = packArray(typeName, metric.value);
      break;
    case "DataSet":
      raw.datasetValue = encodeDataSet(metric.value);
      break;
    case "Template":
      raw.templateValue = encodeTemplate(metric.value);
      break;
    case "PropertySet": case "PropertySetList":
      // [spec §6.4.16, p.79-80]: documented as "Additional PropertyValue
      // Types" — the Metric message's own `value` oneof (.proto lines
      // 200-211) has no propertyset_value/propertysets_value option at
      // all; those exist only inside PropertyValue (used for a metric's
      // `properties` field, which this codec doesn't populate). There is
      // no wire slot to put a value into here — failing loudly beats
      // silently producing a metric with a datatype tag and no value.
      throw new Error(
        "Sparkplug DataType \"" + typeName + "\" cannot be a metric's own top-level value " +
        "(no such field in the Payload.Metric oneof) — it is only valid inside a PropertyValue."
      );
    default: // String, Text, and anything else this codec doesn't model explicitly
      raw.stringValue = metric.value === undefined || metric.value === null ? "" : String(metric.value);
  }
  return raw;
}

function decodePropertyValue(valMsg) {
  if (!valMsg) return null;
  if (valMsg.isNull) return null;
  var typeNum = valMsg.type;
  var typeName = DATA_TYPE_NAME_BY_NUMBER[typeNum] || "String";

  if (valMsg.propertysetValue) {
    return decodePropertySet(valMsg.propertysetValue);
  }
  if (valMsg.propertysetsValue && Array.isArray(valMsg.propertysetsValue.propertyset)) {
    return valMsg.propertysetsValue.propertyset.map(decodePropertySet);
  }
  if (valMsg.booleanValue !== undefined) return !!valMsg.booleanValue;
  if (valMsg.intValue !== undefined) return decodeFixedWidthInt(typeName, valMsg.intValue);
  if (valMsg.longValue !== undefined) return decodeLongLikeValue(typeName, valMsg.longValue);
  if (valMsg.floatValue !== undefined) return valMsg.floatValue;
  if (valMsg.doubleValue !== undefined) return valMsg.doubleValue;
  if (valMsg.stringValue !== undefined) return valMsg.stringValue;
  return null;
}

function decodePropertySet(propSet) {
  if (!propSet) return null;
  var keys = propSet.keys || [];
  var values = propSet.values || [];
  var result = {};
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k !== undefined && k !== null) {
      result[k] = decodePropertyValue(values[i]);
    }
  }
  return result;
}

function decodeMetaData(meta) {
  if (!meta) return null;
  var out = {};
  if (meta.contentType !== undefined) out.contentType = meta.contentType;
  if (meta.size !== undefined) out.size = meta.size;
  if (meta.seq !== undefined) out.seq = meta.seq;
  if (meta.fileName !== undefined) out.fileName = meta.fileName;
  if (meta.fileType !== undefined) out.fileType = meta.fileType;
  if (meta.md5 !== undefined) out.md5 = meta.md5;
  if (meta.description !== undefined) out.description = meta.description;
  if (meta.isMultiPart !== undefined) out.isMultiPart = meta.isMultiPart;
  return Object.keys(out).length ? out : null;
}

// `rawLong`, when given, is the pre-toObject Long instance for THIS
// metric's own long_value field (see decodePayload) — used only for
// Int64/UInt64/DateTime, to get an exact sign reinterpretation instead of
// the lossy Number `raw.longValue` would otherwise be by this point.
function decodeMetric(raw, rawLong) {
  var datatype = raw.datatype;
  var typeName = DATA_TYPE_NAME_BY_NUMBER[datatype] || "String";
  var properties = decodePropertySet(raw.properties);
  var metadata = decodeMetaData(raw.metadata);
  var isNull = !!raw.isNull;
  var isHistorical = !!raw.isHistorical;
  var isTransient = !!raw.isTransient;

  var engUnit = null;
  if (properties) {
    engUnit = properties.EngUnit !== undefined ? properties.EngUnit :
             (properties.engUnit !== undefined ? properties.engUnit :
             (properties.EngineeringUnits !== undefined ? properties.EngineeringUnits :
             (properties.Unit !== undefined ? properties.Unit :
             (properties.Units !== undefined ? properties.Units : null))));
  }

  // `alias` (.proto field 2, "tied to name on birth") — an NDATA/DDATA
  // metric commonly carries ONLY this (no `name` at all) to save bandwidth,
  // per spec p.46: "Upon being defined in the NBIRTH or DBIRTH, subsequent
  // messages can supply only the alias instead of the metric friendly
  // name". Surfaced here so sparkplugTree.js can resolve it back to a name
  // via the alias table it builds from each Edge Node's own NBIRTH/DBIRTH.
  if (isNull) {
    return {
      name: raw.name, alias: raw.alias, type: typeName, value: null, isNull: true,
      timestamp: raw.timestamp, properties: properties, metadata: metadata, engUnit: engUnit,
      isHistorical: isHistorical, isTransient: isTransient
    };
  }
  var value;
  switch (typeName) {
    case "Int8": case "Int16": case "Int32": case "UInt8": case "UInt16": case "UInt32":
      value = decodeFixedWidthInt(typeName, raw.intValue);
      break;
    case "Int64": case "UInt64": case "DateTime":
      value = decodeLongLikeValue(typeName, rawLong !== undefined ? rawLong : raw.longValue);
      break;
    case "Float":
      value = raw.floatValue;
      break;
    case "Double":
      value = raw.doubleValue;
      break;
    case "Boolean":
      value = !!raw.booleanValue;
      break;
    case "UUID":
      value = raw.stringValue;
      break;
    case "Bytes": case "File":
      value = raw.bytesValue ? Buffer.from(raw.bytesValue) : Buffer.alloc(0);
      break;
    case "Int8Array": case "Int16Array": case "Int32Array": case "Int64Array":
    case "UInt8Array": case "UInt16Array": case "UInt32Array": case "UInt64Array":
    case "FloatArray": case "DoubleArray": case "BooleanArray": case "StringArray": case "DateTimeArray":
      value = unpackArray(typeName, raw.bytesValue ? Buffer.from(raw.bytesValue) : Buffer.alloc(0));
      break;
    case "DataSet":
      value = raw.datasetValue ? decodeDataSet(raw.datasetValue) : null;
      break;
    case "Template":
      value = raw.templateValue ? decodeTemplate(raw.templateValue) : null;
      break;
    default:
      // String, Text — and a graceful fallback for PropertySet/
      // PropertySetList or any other datatype number this codec doesn't
      // otherwise model: never throw on DECODE just because some other
      // Sparkplug participant sent something unusual.
      value = raw.stringValue;
  }
  return {
    name: raw.name, alias: raw.alias, type: typeName, value: value,
    isNull: false, timestamp: raw.timestamp, properties: properties,
    metadata: metadata, engUnit: engUnit, isHistorical: isHistorical, isTransient: isTransient
  };
}

// `payload`: { timestamp, seq?, metrics: [{name, value, type, timestamp?}] }
function encodePayload(payload) {
  var raw = {
    timestamp: payload.timestamp,
    metrics: (payload.metrics || []).map(encodeMetric)
  };
  if (payload.seq !== undefined && payload.seq !== null) raw.seq = payload.seq;
  var errMsg = PayloadType.verify(raw);
  if (errMsg) throw new Error("Invalid Sparkplug payload: " + errMsg);
  var message = PayloadType.create(raw);
  return PayloadType.encode(message).finish();
}

// Returns { timestamp, seq, metrics: [{name, value, type, timestamp}] }
function decodePayload(buffer) {
  var message = PayloadType.decode(buffer);
  // {longs: Number} converts every top-level int64/uint64 field (timestamp,
  // seq, and each metric's own long_value/bdSeq-style fields) straight to a
  // plain JS Number — see decodeLongLikeValue's own comment for the
  // precision boundary this implies. Deliberately NOT {defaults: true}: an
  // optional field that was never actually set (e.g. no per-metric
  // timestamp) should come back as undefined, not a fake zero-value default
  // indistinguishable from "really is 0".
  var obj = PayloadType.toObject(message, { longs: Number });
  // message.metrics[i].longValue (BEFORE the {longs:Number} conversion
  // above) is still a real Long instance for a TOP-LEVEL metric — passed
  // through so decodeMetric can get an exact Int64/UInt64/DateTime value
  // instead of the lossy Number toObject() would otherwise have produced.
  var rawMetrics = message.metrics || [];
  return {
    timestamp: obj.timestamp,
    seq: obj.seq,
    metrics: (obj.metrics || []).map(function (m, i) {
      return decodeMetric(m, rawMetrics[i] && rawMetrics[i].longValue);
    })
  };
}

module.exports = {
  encodePayload: encodePayload,
  decodePayload: decodePayload,
  DataType: DataType,
  packArray: packArray,
  unpackArray: unpackArray
};
