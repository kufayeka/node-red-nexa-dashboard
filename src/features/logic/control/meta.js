// Flow control: code, branching, timing, debug.
export default [
    { type: "function", label: "Function", color: "#7a5aa8", icon: "fa-code", chipColor: "#fdf0c2", inputs: 1, outputs: 1 },
    // one output per rule; exclusivePorts: its outputs are alternatives (the flow fan-out check counts one at a time)
    {
        type: "switch", label: "Switch", color: "#e2d96e", icon: "fa-filter", chipColor: "#e2d96e", inputs: 1, outputs: 1, exclusivePorts: true,
        ports: function (node) { return node.rules && node.rules.length ? node.rules.length : 1; }
    },
    { type: "delay", label: "Delay", color: "#c8b261", icon: "fa-hourglass-half", chipColor: "#fdf0c2", inputs: 1, outputs: 1 },
    // collects messages from several wires before it sends one. Editor only so far: the page passes each message on.
    { type: "join", label: "Join", color: "#c8a03a", icon: "fa-compress", chipColor: "#fce8b2", inputs: 1, outputs: 1 },
    { type: "debug", label: "Debug", color: "#777", icon: "fa-bug", chipColor: "#87a980", inputs: 1, outputs: 0 }
];
