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

/** The action an Update node runs, its label. */
function actionLabel(node, def, item) {
    const list = item ? (item.target ? item.target.actions : []) : (def && def.actions) || [];
    const a = list.filter(function (x) { return x.name === node.props.action; })[0];
    return a ? a.label : node.props.action;
}

/** The item a node targets (node.props.item = { list, id }): { name, target def } or null. */
function itemOf(node, def) {
    const ref = node.props.item;
    if (!ref || !ref.list) return null;
    const comp = findComponent(node.props.compId);
    const t = def && (def.targets || []).filter(function (x) { return x.key === ref.list; })[0];
    const list = comp && comp.props && Array.isArray(comp.props[ref.list]) ? comp.props[ref.list] : [];
    const it = list.filter(function (x) { return x && x[(t && t.idField) || "id"] === ref.id; })[0];
    return { name: it ? (it.name || it.label || ref.id) : ref.id + " (removed)", target: t };
}

function overlayNodeLabel(node) {
    const screen = getActiveScreen();
    const of = node.props.overlay && screen ? Tree.find(screen, node.props.overlay) : null;
    const verb = node.type === "overlay-open" ? "Open " : "Close ";
    return verb + (of ? overlayLabel(of) : node.type === "overlay-close" && !node.props.overlay ? "the top overlay" : "(missing overlay)");
}

defineLogicEditors({
    "ui-event": {
        label: function (node) {
            const c = componentName(node.props.compId);
            if (node.props.event === "sparkplug-change" || node.props.event === "sparkplug-update") return c.name + " on Sparkplug Update";
            if (node.props.event === "slide-change") return c.name + " on Slide Change";
            const item = itemOf(node, c.def);
            const events = item ? (item.target ? item.target.events : []) : (c.def && c.def.events);
            const evt = events && events.find(function (e) { return e.name === node.props.event; });
            return c.name + (item ? " · " + item.name : "") + " " + (evt ? evt.label : "on " + node.props.event);
        }
    },
    "ui-update": {
        label: function (node) {
            const c = componentName(node.props.compId);
            const item = itemOf(node, c.def);
            const what = node.props.action ? actionLabel(node, c.def, item) : "";
            return (item ? "Update " + c.name + " · " + item.name : "Update " + c.name) + (what ? ": " + what : "");
        },
        edit: openUiUpdateNodeEditor,
        hint: "Double-click to configure"
    },
    "layer-control": {
        label: function (node) {
            const n = (node.props.states || []).length;
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
