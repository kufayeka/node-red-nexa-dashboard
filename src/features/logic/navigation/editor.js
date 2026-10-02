// Navigation and Screen Flow nodes in the editor, with the flow-only rules.
import { defineLogicEditors } from "../registry.js";
import { state, getActiveScreen } from "../../../state.js";
import { hasIllegalRouteFanOut } from "../../../logic/logic-wires.js";
import { openNavigateNodeEditor } from "./navigate-dialog.js";
import { openOpenUrlNodeEditor } from "./open-url-dialog.js";
import { openRouteTriggerNodeEditor } from "./route-trigger-dialog.js";
import { openRouteNotFoundNodeEditor } from "./route-not-found-dialog.js";
import { openRenderScreenNodeEditor } from "./render-screen-dialog.js";
import { openSendToFlowNodeEditor } from "./send-to-flow-dialog.js";

function screenName(id) {
    const s = (state.screens || []).find(function (x) { return x.id === id; });
    return s ? s.name : (id || "?");
}

/** Only in a Screen Flow, and only one per flow. */
function onePerFlow(type, label) {
    return function (screen) {
        if (state.editingMode !== "flow") return label + " can only be used in a Screen Flow.";
        const taken = ((screen.logic && screen.logic.nodes) || []).some(function (n) { return n.type === type; });
        return taken ? "Only 1 " + label + " node is allowed per flow." : null;
    };
}

defineLogicEditors({
    "navigate": {
        label: function (node) {
            if (node.props.mode === "history") return "Goto (" + (node.props.historyAction === "forward" ? "Forward" : "Back") + ")";
            if (node.props.mode === "url") return "Goto Route" + (node.props.url ? " (" + node.props.url + ")" : "");
            return "Goto Screen (" + screenName(node.props.screenId) + ")";
        },
        edit: openNavigateNodeEditor,
        hint: "Double-click to configure navigation"
    },
    "open-url": {
        label: function (node) { return "Open URL" + (node.props.url ? " (" + node.props.url + ")" : ""); },
        edit: openOpenUrlNodeEditor,
        hint: "Double-click to configure"
    },
    "route-trigger": {
        label: function (node) {
            const flow = getActiveScreen();
            return "Route Trigger (" + ((flow && flow.endpoint) || node.props.path || "/") + ")";
        },
        edit: openRouteTriggerNodeEditor,
        hint: "Double-click to configure route trigger",
        canAdd: onePerFlow("route-trigger", "Route Trigger"),
        onAdd: function (node, screen) { node.props.path = screen.endpoint || "/"; },
        // a red "!" when the trigger fans out to several Render Screens on the same path
        decorate: function (box, node, screen) {
            if (state.editingMode !== "flow" || !screen || !screen.logic) return;
            if (!hasIllegalRouteFanOut(node.id, screen.logic.nodes, screen.logic.wires)) return;
            box.css("border", "2px solid #ef4444");
            window.$("<div>").css({
                position: "absolute", right: "-8px", top: "-8px", background: "#ef4444", color: "#fff",
                "border-radius": "50%", width: "18px", height: "18px", "font-size": "11px", "font-weight": "bold",
                display: "flex", "align-items": "center", "justify-content": "center", cursor: "help"
            }).text("!").attr("title", "Fan-out error: Route Trigger branches to multiple concurrent Render Screen nodes on the same path!").appendTo(box);
        }
    },
    "route-not-found": {
        label: function () { return "Route Not Found (404)"; },
        edit: openRouteNotFoundNodeEditor,
        hint: "Double-click to configure route not found",
        canAdd: onePerFlow("route-not-found", "Route Not Found")
    },
    "render-screen": {
        label: function (node) { return "Render Screen (" + screenName(node.props.screenId) + ")"; },
        edit: openRenderScreenNodeEditor,
        hint: "Double-click to choose screen to render"
    },
    "send-to-flow": {
        label: function (node) { return "Send to Flow" + (node.props.action ? " (" + node.props.action + ")" : ""); },
        edit: openSendToFlowNodeEditor,
        hint: "Double-click to configure message to flow"
    }
});
