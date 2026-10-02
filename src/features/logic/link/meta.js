// Nexa Link: a real Node-RED flow on the server ("from Nexa" / "to Nexa" nodes), docs/LINK.md.
export default [
    { type: "link-request", label: "Request", color: "#8f2f3a", icon: "fa-exchange", chipColor: "#f0d4d7", inputs: 1, outputs: 2, outputLabels: ["answer", "error"], exclusivePorts: true },
    { type: "link-send", label: "To Node-RED", color: "#8f2f3a", icon: "fa-sign-out", chipColor: "#f0d4d7", inputs: 1, outputs: 1 },
    { type: "link-receive", label: "From Node-RED", color: "#8f2f3a", icon: "fa-sign-in", chipColor: "#f0d4d7", inputs: 0, outputs: 1 }
];
