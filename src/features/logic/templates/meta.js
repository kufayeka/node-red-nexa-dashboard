// Templates and lists: params in / out of an instance, the repeater (Populate -> Layout).
export default [
    // inside a template: the instance's params changed
    { type: "param-input", label: "On Params Change", color: "#4b7d4b", icon: "fa-play-circle-o", chipColor: "#e6e0f8", inputs: 0, outputs: 1 },
    // inside a template: send a message out to where it is used
    { type: "template-output", label: "Send to Host", color: "#9c6b9e", icon: "fa-sign-out", chipColor: "#e3d3ee", inputs: 1, outputs: 0 },
    // around a placed instance: what it sent out
    { type: "template-event", label: "On Template Output", color: "#4b7d4b", icon: "fa-sign-in", chipColor: "#e6e0f8", inputs: 0, outputs: 1 },
    { type: "set-template-param", label: "", color: "#9c6b9e", icon: "fa-pencil-square-o", chipColor: "#c0deed", inputs: 1, outputs: 0 },
    { type: "populate", label: "Populate", color: "#5b8a3a", icon: "fa-th-list", chipColor: "#d7ecc6", inputs: 1, outputs: 1 },
    // a container (frame) as a node: Populate -> [Layout] fills it; its output is what its copies send
    { type: "layout", label: "Layout", color: "#5b8a3a", icon: "fa-columns", chipColor: "#e8f3de", inputs: 1, outputs: 1 }
];
