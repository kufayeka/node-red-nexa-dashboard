// The screen's components: their events, updating them, layers, teleport, dialogs / drawers.
export default [
    { type: "ui-event", label: "", color: "#3a6fb0", icon: "fa-play-circle-o", chipColor: "#e6e0f8", inputs: 0, outputs: 1 },
    { type: "ui-update", label: "", color: "#b0663a", icon: "fa-pencil-square-o", chipColor: "#c0deed", inputs: 1, outputs: 0 },
    { type: "layer-control", label: "Layer Control", color: "#c78a3a", icon: "fa-object-group", chipColor: "#f0dcb8", inputs: 1, outputs: 0 },
    // a node drawn in a teleport target / on the page, or back home
    { type: "teleport", label: "Teleport", color: "#8e44ad", icon: "fa-share", chipColor: "#e8d6f0", inputs: 1, outputs: 1 },
    // a dialog / drawer: Open (its output fires when it closes, with the result) / Close
    { type: "overlay-open", label: "Open", color: "#8a5a3a", icon: "fa-window-maximize", chipColor: "#f3dfcc", inputs: 1, outputs: 1 },
    { type: "overlay-close", label: "Close", color: "#8a5a3a", icon: "fa-window-close-o", chipColor: "#f3dfcc", inputs: 1, outputs: 0 }
];
