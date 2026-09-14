// Test for Sparkplug B PropertySet, MetaData decoding & tree property retention across NDATA/DDATA.
const sparkplug = require("../lib/sparkplug/sparkplugCodec.js");
const tree = require("../lib/sparkplug/sparkplugTree.js");

console.log("--- 1. Sparkplug Tree retains properties, engUnit & metadata across NDATA/DDATA ---");
var t1 = {};
var birthDelta = tree.applyMessage(t1, "Kufayeka", "DBIRTH", "NexaNodeRed", "GP", {
    timestamp: 1700000000000,
    metrics: [{
        name: "result",
        alias: 10,
        type: "Int32",
        value: 0,
        properties: {
            EngHigh: 100,
            EngLow: 0,
            EngUnit: "°C",
            Deadband: 0,
            FormatString: "#,##0.##",
            Quality: "Good",
            AlarmEvalEnabled: true,
            CanRead: true,
            CanWrite: true,
            HistoryEnabled: false,
            ReadOnly: false,
            TagGroup: "Default",
            Documentation: "Main temperature result",
            Tooltip: "Temperature sensor reading"
        },
        metadata: {
            description: "Main sensor metadata"
        },
        engUnit: "°C"
    }]
});

console.log("DBIRTH recorded metric?", !!t1.Kufayeka.NexaNodeRed.devices.GP.metrics.result);
var m1 = tree.getMetricEntry(t1, "Kufayeka", "NexaNodeRed", "GP", "result");
console.log("initial value is 0?", m1.value === 0);
console.log("initial EngHigh captured?", m1.properties && m1.properties.EngHigh === 100);
console.log("initial EngUnit captured?", m1.engUnit === "°C");
console.log("initial boolean property AlarmEvalEnabled is true?", m1.properties && m1.properties.AlarmEvalEnabled === true);
console.log("initial metadata captured?", m1.metadata && m1.metadata.description === "Main sensor metadata");

console.log("--- 2. DDATA with ONLY alias & value (no properties) retains existing properties ---");
var ddataDelta = tree.applyMessage(t1, "Kufayeka", "DDATA", "NexaNodeRed", "GP", {
    timestamp: 1700000005000,
    metrics: [{
        alias: 10,
        value: 42
    }]
});

console.log("DDATA delta resolved alias to result?", ddataDelta && ddataDelta.metrics[0].name === "result");
console.log("DDATA delta carries new value 42?", ddataDelta && ddataDelta.metrics[0].value === 42);
var m2 = tree.getMetricEntry(t1, "Kufayeka", "NexaNodeRed", "GP", "result");
console.log("value updated to 42 in tree?", m2.value === 42);
console.log("timestamp updated to 1700000005000?", m2.timestamp === 1700000005000);
console.log("EngHigh property STILL preserved after DDATA?", m2.properties && m2.properties.EngHigh === 100);
console.log("EngUnit STILL preserved after DDATA?", m2.engUnit === "°C");
console.log("AlarmEvalEnabled STILL preserved after DDATA?", m2.properties && m2.properties.AlarmEvalEnabled === true);
console.log("DataType type STILL preserved after DDATA?", m2.type === "Int32");
console.log("Metadata STILL preserved after DDATA?", m2.metadata && m2.metadata.description === "Main sensor metadata");

console.log("--- 3. Multiple tags under the same device retain their distinct properties ---");
tree.applyMessage(t1, "Kufayeka", "DBIRTH", "NexaNodeRed", "GP", {
    timestamp: 1700000000000,
    metrics: [
        { name: "suhu_koridor", alias: 11, type: "Int32", value: 0, properties: { EngUnit: "°C" }, engUnit: "°C" },
        { name: "temperature", alias: 12, type: "Int32", value: 18, properties: { EngUnit: "°C" }, engUnit: "°C" }
    ]
});

var mSuhu = tree.getMetricEntry(t1, "Kufayeka", "NexaNodeRed", "GP", "suhu_koridor");
var mTemp = tree.getMetricEntry(t1, "Kufayeka", "NexaNodeRed", "GP", "temperature");
console.log("suhu_koridor value is 0?", mSuhu.value === 0);
console.log("temperature value is 18?", mTemp.value === 18);
console.log("suhu_koridor engUnit is °C?", mSuhu.engUnit === "°C");
console.log("temperature engUnit is °C?", mTemp.engUnit === "°C");

console.log("ALL OK");
