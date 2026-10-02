// Moving around: screens (SPA), URLs, and Screen Flows (route -> render screen).
export default [
    { type: "navigate", label: "Goto Screen", color: "#458296", icon: "fa-compass", chipColor: "#a6bbcf", inputs: 1, outputs: 1 },
    { type: "open-url", label: "Open URL", color: "#5a8f8f", icon: "fa-external-link", chipColor: "#a6bbcf", inputs: 1, outputs: 0 },
    { type: "reload", label: "Reload Page", color: "#8a8a8a", icon: "fa-refresh", chipColor: "#e2d96e", inputs: 1, outputs: 0 },
    // a flow's public entry point (one per flow)
    { type: "route-trigger", label: "Route Trigger", color: "#a370f7", icon: "fa-road", chipColor: "#e6e0f8", inputs: 0, outputs: 1 },
    // a sub-path under the flow matched no screen (one per flow)
    { type: "route-not-found", label: "Route Not Found", color: "#e11d48", icon: "fa-ban", chipColor: "#fde2e7", inputs: 0, outputs: 1 },
    { type: "render-screen", label: "Render Screen", color: "#0284c7", icon: "fa-desktop", chipColor: "#cde6f2", inputs: 1, outputs: 1 },
    // from a screen back to the active flow's Render Screen node
    { type: "send-to-flow", label: "Send to Flow", color: "#0ea5e9", icon: "fa-paper-plane", chipColor: "#e3d3ee", inputs: 1, outputs: 1 }
];
