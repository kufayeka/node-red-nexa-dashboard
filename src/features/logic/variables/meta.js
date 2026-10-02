// Variables (screen / group / frame / app, see src/model/scope.js).
export default [
    { type: "set-variable", label: "Set Variable", color: "#9c6b9e", icon: "fa-tag", chipColor: "#e3d3ee", inputs: 1, outputs: 1 },
    { type: "get-variable", label: "Get Variable", color: "#9c6b9e", icon: "fa-tag", chipColor: "#e3d3ee", inputs: 1, outputs: 1 },
    { type: "set-variable-multi", label: "Set Variables", color: "#9c6b9e", icon: "fa-tags", chipColor: "#dac8ee", inputs: 1, outputs: 1 },
    { type: "get-variable-multi", label: "Get Variables", color: "#9c6b9e", icon: "fa-tags", chipColor: "#dac8ee", inputs: 1, outputs: 1 },
    // a source: fires when a watched variable changes (payload = new, previous = old)
    { type: "on-variable-change", label: "Watch Variable", color: "#4b7d4b", icon: "fa-eye", chipColor: "#c7e9c0", inputs: 0, outputs: 1 }
];
