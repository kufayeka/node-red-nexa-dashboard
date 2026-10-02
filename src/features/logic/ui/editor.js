// Component nodes in the editor: labels name the component / overlay they act on.
import { defineLogicEditors } from "../registry.js";
import { getActiveScreen, findComponent, Tree } from "../../../state.js";
import { openUiUpdateNodeEditor } from "./ui-update-dialog.js";
import { openLayerControlNodeEditor } from "./layer-control-dialog.js";
import { openTeleportNodeEditor, teleportNodeLabel } from "./teleport-dialog.js";
import { openOverlayNodeEditor, overlayLabel } from "./overlay-dialog.js";

/** "Pump #a1b2", or the component's own name. */
function componentName(compId) {
    const comp = findComponent(compId);
    const def = comp && window.NEXA && window.NEXA.getComponent(comp.type);
    if (comp && comp.name) return { name: comp.name, def: def };
    const typeLabel = !comp ? "?" : comp.type === "@lit-component" ? "Lit Component" : comp.type === "@template" ? "Instance"
        : comp.type === "@frame" ? "Frame" : (def ? def.label : comp.type);
    return { name: typeLabel + " #" + (comp ? comp.id.slice(-4) : "?"), def: def };
}

function overlayNodeLabel(node) {
    const screen = getActiveScreen();
    const of = node.overlay && screen ? Tree.find(screen, node.overlay) : null;
    const verb = node.type === "overlay-open" ? "Open " : "Close ";
    return verb + (of ? overlayLabel(of) : node.type === "overlay-close" && !node.overlay ? "the top overlay" : "(missing overlay)");
}

defineLogicEditors({
    "ui-event": {
        label: function (node) {
            const c = componentName(node.compId);
            if (node.event === "sparkplug-change" || node.event === "sparkplug-update") return c.name + " on Sparkplug Update";
            if (node.event === "slide-change") return c.name + " on Slide Change";
            const evt = c.def && c.def.events && c.def.events.find(function (e) { return e.name === node.event; });
            return c.name + " " + (evt ? evt.label : "on " + node.event);
        }
    },
    "ui-update": {
        label: function (node) { return "Update " + componentName(node.compId).name; },
        edit: openUiUpdateNodeEditor,
        hint: "Double-click to configure"
    },
    "layer-control": {
        label: function (node) {
            const n = (node.states || []).length;
            return "Layer Control" + (n ? " (" + n + ")" : "");
        },
        edit: openLayerControlNodeEditor,
        hint: "Double-click to configure"
    },
    "teleport": {
        label: teleportNodeLabel,
        edit: openTeleportNodeEditor,
        hint: "Double-click to choose the node and where it goes"
    },
    "overlay-open": {
        label: overlayNodeLabel,
        edit: openOverlayNodeEditor,
        hint: "Double-click to choose the dialog / drawer. Its output fires when it closes (msg.payload = the result)."
    },
    "overlay-close": {
        label: overlayNodeLabel,
        edit: openOverlayNodeEditor,
        hint: "Double-click to choose what it closes and its result"
    }
});
