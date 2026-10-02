// Writes to live Sparkplug tags (a DCMD / NCMD); the output fires once the write is published.
export default [
    { type: "sparkplug-write", label: "Sparkplug Write", color: "#2f8f6f", icon: "fa-upload", chipColor: "#bfe8d8", inputs: 1, outputs: 1 },
    { type: "sparkplug-write-multi", label: "Sparkplug Write Multi", color: "#2f8f6f", icon: "fa-upload", chipColor: "#bfe8d8", inputs: 1, outputs: 1 }
];
