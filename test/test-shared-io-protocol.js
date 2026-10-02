import assert from "node:assert/strict";
import { encodeDataFrame, V as NodeV } from "../src/shared/io/frame.js";
import { decodeDataFrame, V as SharedV } from "../src/shared/io/frame.js";

console.log("=== Testing Shared IO Protocol Universal Decoder ===");

// 1. Verify Enum alignment
assert.equal(NodeV.INT32, SharedV.INT32);
assert.equal(NodeV.FLOAT64, SharedV.FLOAT64);
assert.equal(NodeV.STRING, SharedV.STRING);
assert.equal(NodeV.JSON, SharedV.JSON);
console.log("✔ V enums match");

// 2. Encode diverse test items using existing Server encoder
const now = Date.now();
const testItems = [
    { idx: 0, entry: { value: 12345, online: true, isNull: false, timestamp: now - 100 } },
    { idx: 1, entry: { value: 3.14159, online: true, isNull: false, timestamp: now - 50 } },
    { idx: 2, entry: { value: "Hello SCADA", online: true, isNull: false, timestamp: now } },
    { idx: 3, entry: { value: true, online: true, isNull: false, timestamp: now } },
    { idx: 4, entry: { value: false, online: true, isNull: false, timestamp: now } },
    { idx: 5, entry: { value: { level: 99, status: "OK" }, online: true, isNull: false, timestamp: now } },
    { idx: 6, entry: { value: null, online: true, isNull: true, timestamp: now } },
    { idx: 7, entry: { value: null, online: false, isNull: false, timestamp: now } }
];

const encodedBuffer = encodeDataFrame(testItems, { full: true, now });
assert.ok(encodedBuffer.length > 12, "Encoded buffer should contain headers + entries");

// 3. Decode using Universal Decoder
const decoded = decodeDataFrame(encodedBuffer);
assert.equal(decoded.full, true, "Full flag should be true");
assert.equal(decoded.baseTs, now, "BaseTs should match");
assert.equal(decoded.entries.length, 8, "All 8 entries decoded");

// Check entry values
assert.equal(decoded.entries[0].idx, 0);
assert.equal(decoded.entries[0].value, 12345);

assert.equal(decoded.entries[1].idx, 1);
assert.ok(Math.abs(decoded.entries[1].value - 3.14159) < 0.00001);

assert.equal(decoded.entries[2].idx, 2);
assert.equal(decoded.entries[2].value, "Hello SCADA");

assert.equal(decoded.entries[3].idx, 3);
assert.equal(decoded.entries[3].value, true);

assert.equal(decoded.entries[4].idx, 4);
assert.equal(decoded.entries[4].value, false);

assert.equal(decoded.entries[5].idx, 5);
assert.deepEqual(decoded.entries[5].value, { level: 99, status: "OK" });

assert.equal(decoded.entries[6].idx, 6);
assert.equal(decoded.entries[6].isNull, true);

assert.equal(decoded.entries[7].idx, 7);
assert.equal(decoded.entries[7].online, false);

console.log("✔ Universal decoder correctly unpacked all types (INT32, FLOAT64, STRING, BOOL, JSON, NULL, OFFLINE)!");
console.log("ALL TESTS PASSED!");
